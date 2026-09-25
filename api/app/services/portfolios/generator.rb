# frozen_string_literal: true

module Portfolios
  # N10: Generates a structured skill portfolio from the full transcript
  # and final coverage map using Gemini Pro.
  # Runs post-session as a background job.
  class Generator
    # #8: raised when the model's response can't be turned into a valid
    # skill batch -- malformed JSON, or Portfolios::LevelNormalizer flagging
    # any skill in the batch `:invalid` (a value that parses as a number but
    # isn't a usable 1..5 level, e.g. 7 or 3.7). Deliberately kept small and
    # local rather than nested under Gemini::HttpClient: this is about the
    # *content* of an otherwise-successful response, not a transport/API
    # failure. Gemini::HttpClient::TimeoutError/RateLimitError/ApiError
    # already exist for the transport side and are reused as-is below.
    class InvalidModelOutputError < StandardError; end

    # Maps a rescued exception to the `portfolios.failure_code` enum value
    # (#6: upstream_error / invalid_output / timeout / unknown). Order
    # matters: TimeoutError and RateLimitError both subclass ApiError, so
    # the more specific class must be checked first.
    FAILURE_CODES = {
      Gemini::HttpClient::TimeoutError => 'timeout',
      InvalidModelOutputError          => 'invalid_output',
      Gemini::HttpClient::ApiError     => 'upstream_error'
    }.freeze

    def initialize(session:, gemini_client: nil)
      @session = session
      @model_name = ENV.fetch('GEMINI_PRO_MODEL', 'gemini-2.5-flash')
      @gemini_client = gemini_client || Gemini::HttpClient.new(
        model:   @model_name,
        timeout: 180  # up to 3 minutes for large transcripts
      )
    end

    # Returns the Portfolio record with skills populated.
    def call
      portfolio = @session.portfolio || @session.create_portfolio!(
        candidate_id:      @session.candidate_id,
        generation_status: 'pending',
        tenant_id:         @session.tenant_id
      )

      portfolio.update!(generation_status: 'generating')

      prompt   = build_prompt
      response = @gemini_client.generate_content(prompt, temperature: 0.2)

      save_skills(portfolio, response, prompt)
      portfolio.update!(
        generation_status: 'complete',
        generated_at:      Time.current,
        failure_code:      nil,
        generation_error:  nil
      )

      Rails.logger.info("[N10] Portfolio generated for session #{@session.id}")
      portfolio
    rescue => e
      fail_portfolio!(portfolio, e)
      raise
    end

    private

    def fail_portfolio!(portfolio, error)
      failure_code = classify_failure(error)
      portfolio&.update!(generation_status: 'failed', generation_error: error.message, failure_code: failure_code)
      Rails.logger.error("[N10] Portfolio generation failed for session #{@session.id}: #{error.class} #{error.message}")
    end

    # Returns the `failure_code` enum value for a rescued exception: the
    # first entry in FAILURE_CODES whose class the exception is an instance
    # of, or 'unknown' for anything unclassified (a generic StandardError,
    # a validation failure, a programming bug -- not a case this generator
    # can confidently say "retry" or "contact administrator" about).
    def classify_failure(error)
      FAILURE_CODES.each do |klass, code|
        return code if error.is_a?(klass)
      end
      'unknown'
    end

    def build_prompt
      assessment       = @session.assessment
      configured_skills = assessment.assessment_skills.order(:display_order)
      coverage_maps     = @session.coverage_maps.order(:id)
      turns             = @session.transcript_turns.ordered

      skills_text = configured_skills.map { |s| skill_definition_block(s) }.join("\n\n")

      coverage_json = {
        skills:     coverage_maps.reject(&:is_discovered).map { |m| coverage_json(m) },
        discovered: coverage_maps.select(&:is_discovered).map { |m| coverage_json(m) }
      }.to_json

      transcript_text = turns.map { |t| "[#{t.speaker.upcase}]: #{t.text}" }.join("\n")

      <<~PROMPT
        You are evaluating a completed skills assessment interview to produce a structured skill portfolio.

        ROLE BEING ASSESSED: #{assessment.name}

        SKILL DEFINITIONS AND BEHAVIORAL ANCHORS:
        #{skills_text}

        UNIVERSAL L1-L5 ANCHORS (use for discovered skills):
        L1 — Executes with explicit guidance and close review. Understands conceptually but cannot apply independently.
        L2 — Executes independently on routine scope. Uses known patterns. Handles common cases but not edge cases.
        L3 — Executes complex, ambiguous scope. Makes tradeoffs. Handles edge cases. Can teach L1-L2.
        L4 — Defines standards and creates reusable systems. Resolves systemic problems. Cross-team impact.
        L5 — Org-level authority. Shapes how the skill is practiced. Rare.

        FINAL COVERAGE MAP:
        #{coverage_json}

        FULL INTERVIEW TRANSCRIPT:
        #{transcript_text}

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        TASK
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        For EACH skill in the coverage map (both configured and discovered):

        1. FIND THE EVIDENCE
           Read all transcript turns where this skill was discussed.
           Identify the 2-3 most revealing quotes from the CANDIDATE (not the AI).
           A quote is revealing if it shows HOW they think, not just WHAT they know.

        2. ASSIGN A LEVEL
           Compare the candidate's actual behavior to the L1-L5 anchors.
           Assign the highest level where you see CONSISTENT evidence, not just one strong moment.
           If evidence is mixed (mostly L2 with one L3 moment), assign L2.

        3. WRITE THE COMPETENCY SUMMARY
           2-3 sentences. Focus on patterns, not individual answers.
           What does this person reliably do at this skill? What's the ceiling? What's missing?

        4. ASSIGN CONFIDENCE
           high — probe_count >= 3 AND state = covered
           medium — probe_count = 2 OR state = partial
           low — probe_count <= 1 OR state = initiated

        OUTPUT (JSON only, no prose):
        {
          "configured_skills": [
            {
              "skill_id": "sk-eng-001",
              "skill_label": "React / Frontend Development",
              "level": 3,
              "confidence": "high",
              "evidence": ["quote 1", "quote 2", "quote 3"],
              "competency_summary": "2-3 sentence summary"
            }
          ],
          "discovered_skills": [
            {
              "skill_label": "Micro-frontend Architecture",
              "level": 2,
              "confidence": "low",
              "evidence": ["quote 1"],
              "competency_summary": "2-3 sentence summary"
            }
          ]
        }
      PROMPT
    end

    def skill_definition_block(skill)
      lines = ["━━━━━━━━━━━━━━━"]
      lines << "SKILL: #{skill.skill_label} (#{skill.skill_id || 'custom'})"
      lines << "SCOPE: #{skill.scope_include}" if skill.scope_include.present?
      lines << ""
      lines << "L1 — #{skill.l1_anchor}"
      lines << "L2 — #{skill.l2_anchor}"
      lines << "L3 — #{skill.l3_anchor}"
      lines << "L4 — #{skill.l4_anchor}"
      lines << "L5 — #{skill.l5_anchor}"
      lines.join("\n")
    end

    def coverage_json(map)
      {
        id:          map.skill_id || map.skill_label.downcase.gsub(/\s+/, '-'),
        label:       map.skill_label,
        state:       map.state,
        probe_count: map.probe_count,
        is_discovered: map.is_discovered
      }
    end

    # #8: rewritten around Portfolios::LevelNormalizer (#7) and the
    # assessment-truth schema (#6).
    #
    # Every raw skill in the model's response is run through the normalizer
    # first (pure, no DB writes). If *any* skill comes back `:invalid` --
    # a value that parses as a number but isn't a usable 1..5 level -- the
    # whole batch is rejected before anything is touched, and the caller's
    # rescue in #call turns that into `failure_code: invalid_output` with
    # the portfolio left exactly as it was. Otherwise, destroying the old
    # skills, creating the new ones, and recording model/prompt provenance
    # all happen inside one transaction, so a failure partway through
    # (e.g. an unexpected validation error) can never leave a partial
    # portfolio visible.
    #
    # #9: override preservation across regeneration (F7).
    #
    # `AssessorOverride` is a strict 1:1 on `portfolio_skill_id` (unique,
    # NOT NULL FK) -- it has no independent "which skill is this really
    # about" identity of its own. Before anything is destroyed, every
    # existing override for this portfolio is snapshotted and keyed by its
    # *skill's* identity (`skill_id` for configured skills, `skill_label`
    # for discovered ones, whose `skill_id` is always nil -- accepting the
    # documented rare-collision risk of two same-labeled discovered skills
    # sharing a key, same as #7/#8's treatment of that edge case).
    #
    # A snapshot entry is "reattachable" when the new batch has an entry
    # with the same key *and* that entry actually carries a numeric
    # `ai_level` (a plain `:assessed`/`:needs_review` outcome). A skill that
    # regenerates as `:not_assessed` (nil `ai_level`) can't host a reattached
    # override -- `AssessorOverride#ai_level` is a NOT NULL, 1..5-validated
    # column representing what the AI actually scored, and there is no
    # honest value to put there for "the model didn't measure this
    # this time." That case is treated the same as "no longer in the batch."
    #
    # Design choice for "preserved but unlinked" (schema-consistent, no new
    # migration -- `assessor_overrides.portfolio_skill_id` stays NOT NULL):
    # the OLD `portfolio_skill` row backing a non-reattachable override is
    # simply *not* destroyed. `destroy_all` only runs against the skills
    # that don't need to stay around for this reason, so the override's FK
    # never dangles and the override row itself is never touched -- it goes
    # on pointing at the real (now-superseded) skill record it always did,
    # fully intact and fully queryable via `override.portfolio_skill`,
    # instead of being deleted or silently reassigned to an unrelated skill.
    # The tradeoff, deliberately accepted: that superseded row keeps
    # showing up in `portfolio.portfolio_skills` (it's real history, not a
    # tombstone) even though it's no longer part of the latest generation's
    # skill set -- callers that want "only this generation's skills" can
    # already tell the two apart by checking `assessor_override.present?`
    # combined with whether the skill's key reappears elsewhere in the
    # association; a dedicated "current batch" marker would need a real
    # migration and is out of scope here.
    def save_skills(portfolio, response, prompt)
      data = parse_model_response(response)

      entries = build_skill_entries(data['configured_skills'], discovered: false) +
                build_skill_entries(data['discovered_skills'], discovered: true)

      if entries.any? { |entry| entry[:normalized].invalid? }
        raise InvalidModelOutputError,
              "Gemini returned an unusable level for one or more skills (session #{@session.id})"
      end

      ActiveRecord::Base.transaction do
        override_snapshot = snapshot_overrides(portfolio)
        orphaned_skill_ids = orphaned_skill_ids_for(override_snapshot, entries)

        portfolio.portfolio_skills.where.not(id: orphaned_skill_ids).destroy_all

        entries.each do |entry|
          new_skill = portfolio.portfolio_skills.create!(entry[:attributes])
          reattach_override(override_snapshot, entry, new_skill)
        end

        portfolio.update!(model_name: @model_name, prompt_version: Digest::SHA256.hexdigest(prompt))
      end
    end

    # Keyed snapshot of every override currently attached to this
    # portfolio's skills, taken before anything is destroyed. Must run
    # first: once `destroy_all` fires, `has_one :assessor_override,
    # dependent: :destroy` on `PortfolioSkill` would take any non-preserved
    # override down with its skill.
    def snapshot_overrides(portfolio)
      portfolio.portfolio_skills.includes(:assessor_override).each_with_object({}) do |skill, memo|
        override = skill.assessor_override
        next unless override

        memo[override_key(skill.skill_id, skill.skill_label)] = override
      end
    end

    # The old portfolio_skill ids that must survive `destroy_all` because
    # their override has nowhere reattachable to go this generation.
    def orphaned_skill_ids_for(override_snapshot, entries)
      reattachable_keys = entries.filter_map do |entry|
        attrs = entry[:attributes]
        override_key(attrs[:skill_id], attrs[:skill_label]) if attrs[:ai_level].present?
      end

      override_snapshot.filter_map do |key, override|
        override.portfolio_skill_id unless reattachable_keys.include?(key)
      end
    end

    # Re-creates a preserved override against the freshly-created skill row
    # that matches its key, carrying forward everything about the human
    # judgment (`override_level`, `assessor_notes`, `overridden_by`,
    # `overridden_at`) while refreshing `ai_level` to the new skill's own
    # (freshly re-measured) level. A no-op when there's no snapshot entry
    # for this key, or when the new skill has no `ai_level` to reattach
    # against (see the design note above `#save_skills`).
    def reattach_override(override_snapshot, entry, new_skill)
      return if new_skill.ai_level.nil?

      attrs = entry[:attributes]
      old_override = override_snapshot[override_key(attrs[:skill_id], attrs[:skill_label])]
      return unless old_override

      AssessorOverride.create!(
        portfolio_skill_id: new_skill.id,
        ai_level:           new_skill.ai_level,
        override_level:     old_override.override_level,
        assessor_notes:     old_override.assessor_notes,
        overridden_by:      old_override.overridden_by,
        overridden_at:      old_override.overridden_at
      )
    end

    # Configured skills are keyed by their stable `skill_id`; discovered
    # skills (whose `skill_id` is always nil) fall back to `skill_label` --
    # the only identity they have, per #9's accepted collision risk.
    def override_key(skill_id, skill_label)
      skill_id.presence || "label:#{skill_label}"
    end

    def parse_model_response(response)
      return response if response.is_a?(Hash)

      JSON.parse(response)
    rescue JSON::ParserError => e
      raise InvalidModelOutputError, "Gemini response was not valid JSON: #{e.message}"
    end

    def build_skill_entries(skill_list, discovered:)
      Array(skill_list).map do |skill_data|
        normalized = Portfolios::LevelNormalizer.call(
          level:          skill_data['level'],
          confidence:     skill_data['confidence'],
          coverage_state: coverage_state_for(skill_data['skill_label'])
        )

        { normalized: normalized, attributes: skill_attributes(skill_data, normalized, discovered: discovered) }
      end
    end

    def coverage_state_for(skill_label)
      coverage_states_by_label[skill_label]
    end

    def coverage_states_by_label
      @coverage_states_by_label ||= @session.coverage_maps.each_with_object({}) do |map, memo|
        memo[map.skill_label] = map.state
      end
    end

    def skill_attributes(skill_data, normalized, discovered:)
      {
        skill_id:           discovered ? nil : skill_data['skill_id'],
        skill_label:        skill_data['skill_label'],
        is_discovered:      discovered,
        ai_level:           normalized.level,
        ai_confidence:      normalized.confidence.to_s,
        evidence:           Array(skill_data['evidence']).first(3),
        competency_summary: skill_data['competency_summary'],
        assessment_status:  normalized.assessment_status.to_s,
        status_reason:      normalized.status_reason&.to_s
      }
    end
  end
end
