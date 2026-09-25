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
    # NB: override preservation across regeneration (F7) is a separate,
    # blocked-by-this ticket -- it hooks in right here, between
    # `destroy_all` and creating the new skills, once it lands.
    def save_skills(portfolio, response, prompt)
      data = parse_model_response(response)

      entries = build_skill_entries(data['configured_skills'], discovered: false) +
                build_skill_entries(data['discovered_skills'], discovered: true)

      if entries.any? { |entry| entry[:normalized].invalid? }
        raise InvalidModelOutputError,
              "Gemini returned an unusable level for one or more skills (session #{@session.id})"
      end

      ActiveRecord::Base.transaction do
        portfolio.portfolio_skills.destroy_all

        entries.each { |entry| portfolio.portfolio_skills.create!(entry[:attributes]) }

        portfolio.update!(model_name: @model_name, prompt_version: Digest::SHA256.hexdigest(prompt))
      end
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
