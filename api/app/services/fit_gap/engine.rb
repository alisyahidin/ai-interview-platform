# frozen_string_literal: true

module FitGap
  # N13: Generates a fit/gap report comparing a portfolio against a vacancy.
  # Uses rule-based comparison for skill levels + Gemini Flash for culture narrative.
  class Engine
    def initialize(portfolio:, vacancy:, gemini_client: nil)
      @portfolio = portfolio
      @vacancy   = vacancy
      @gemini_client = gemini_client || Gemini::HttpClient.new(
        model:   ENV.fetch('GEMINI_FLASH_MODEL', 'gemini-2.5-flash'),
        timeout: 30
      )
    end

    # Returns the FitGapReport record.
    def call
      skill_comparisons = build_skill_comparisons
      narratives        = generate_narratives(skill_comparisons)

      report = FitGapReport.find_or_initialize_by(
        portfolio_id: @portfolio.id,
        vacancy_id:   @vacancy.id
      )

      report.update!(
        skill_comparisons: skill_comparisons,
        culture_narrative: narratives[:culture],
        overall_narrative: narratives[:overall],
        generated_at:      Time.current
      )

      Rails.logger.info("[N13] Fit/gap report generated: portfolio=#{@portfolio.id} vacancy=#{@vacancy.id}")
      report
    end

    private

    def build_skill_comparisons
      vacancy_skills = @vacancy.vacancy_skills.index_by(&:skill_label)
      portfolio_skills = effective_portfolio_skills  # includes overrides

      comparisons = vacancy_skills.map do |label, vacancy_skill|
        portfolio_skill = find_portfolio_skill(portfolio_skills, label, vacancy_skill.skill_id)

        if portfolio_skill && assessed?(portfolio_skill)
          candidate_level  = portfolio_skill[:effective_level]
          expected_level   = vacancy_skill.expected_level
          delta            = candidate_level - expected_level
          result           = delta == 0 ? 'match' : (delta > 0 ? 'exceed' : 'gap')
          confidence       = portfolio_skill[:confidence]
        else
          # No matching portfolio_skill at all, or one that exists but was
          # never actually assessed (assessment_status not_assessed/needs_review,
          # ai_level nil) — neither case has a usable candidate_level to diff
          # against expected_level, so both collapse to the same shape.
          candidate_level = nil
          expected_level  = vacancy_skill.expected_level
          delta           = nil
          result          = 'not_assessed'
          confidence      = nil
        end

        # #22: thread the override state effective_portfolio_skills already
        # computed through to the row instead of discarding it. `is_override`
        # and `assessment_status` are reported regardless of whether a usable
        # level was found; `original_level` (the pre-override ai_level) is
        # only meaningful -- and only present -- when an override exists.
        is_override       = portfolio_skill ? portfolio_skill[:overridden] : false
        original_level    = is_override ? portfolio_skill[:ai_level] : nil
        assessment_status = portfolio_skill ? portfolio_skill[:assessment_status] : 'not_assessed'

        {
          skill_label:       label,
          skill_id:          vacancy_skill.skill_id,
          candidate_level:   candidate_level,
          expected_level:    expected_level,
          result:            result,
          delta:             delta,
          confidence:        confidence,
          is_override:       is_override,
          original_level:    original_level,
          assessment_status: assessment_status
        }
      end

      comparisons
    end

    # Returns portfolio skills with overrides applied.
    def effective_portfolio_skills
      @portfolio.portfolio_skills.includes(:assessor_override).map do |skill|
        override = skill.assessor_override
        {
          id:                skill.id,
          skill_id:          skill.skill_id,
          skill_label:       skill.skill_label,
          ai_level:          skill.ai_level,
          effective_level:   override ? override.override_level : skill.ai_level,
          confidence:        skill.ai_confidence,
          overridden:        override.present?,
          assessment_status: skill.assessment_status
        }
      end
    end

    # A matched portfolio_skill has a usable level whenever the underlying
    # ai_level is real. `not_assessed` (never measured) is the only status
    # without one -- `needs_review` (coverage said not_yet but the model
    # scored it anyway) always carries a real ai_level (see
    # `effective_portfolio_skills` above), so it must be diffed against the
    # expected level just like `assessed`. `assessment_status` itself stays
    # 'needs_review' on the resulting row (untouched by this method) so the
    # frontend can still render the orthogonal review flag on top of
    # whatever result/confidence gets computed here.
    #
    # No `.nil?` branch here: `portfolio_skills.assessment_status` is
    # NOT NULL with a DB default of 'assessed', so a real record can never
    # produce a nil value here.
    def assessed?(portfolio_skill)
      %w[assessed needs_review].include?(portfolio_skill[:assessment_status])
    end

    def find_portfolio_skill(portfolio_skills, label, skill_id)
      portfolio_skills.find { |s| s[:skill_id] == skill_id && skill_id.present? } ||
        portfolio_skills.find { |s| s[:skill_label].downcase == label.downcase }
    end

    def generate_narratives(skill_comparisons)
      gaps    = skill_comparisons.select { |c| c[:result] == 'gap' }
      matches = skill_comparisons.select { |c| c[:result] == 'match' }
      exceeds = skill_comparisons.select { |c| c[:result] == 'exceed' }
      not_assessed = skill_comparisons.select { |c| c[:result] == 'not_assessed' }

      prompt = build_narrative_prompt(gaps, matches, exceeds, not_assessed)

      begin
        response = @gemini_client.generate_content(prompt, temperature: 0.4)
        data = response.is_a?(Hash) ? response : JSON.parse(response)
        { culture: data['culture_narrative'], overall: data['overall_narrative'] }
      rescue => e
        Rails.logger.error("[N13] Narrative generation failed: #{e.message}")
        { culture: nil, overall: generate_fallback_narrative(skill_comparisons) }
      end
    end

    def build_narrative_prompt(gaps, matches, exceeds, not_assessed)
      vacancy = @vacancy
      portfolio_session = @portfolio.session
      portfolio_session.assessment

      <<~PROMPT
        You are writing a fit/gap analysis narrative for a candidate evaluation.

        ROLE: #{vacancy.role_title}
        #{vacancy.culture_dimensions.present? ? "CULTURE EXPECTATIONS:\n#{vacancy.culture_dimensions}\n" : ""}
        #{vacancy.competency_expectations.present? ? "COMPETENCY EXPECTATIONS:\n#{vacancy.competency_expectations}\n" : ""}

        SKILL COMPARISON RESULTS:
        - Matches (#{matches.count}): #{matches.map { |c| "#{c[:skill_label]} (L#{c[:candidate_level]})" }.join(', ')}
        - Gaps (#{gaps.count}): #{gaps.map { |c| "#{c[:skill_label]}: candidate L#{c[:candidate_level]} vs expected L#{c[:expected_level]} (delta #{c[:delta]})" }.join(', ')}
        - Exceeds (#{exceeds.count}): #{exceeds.map { |c| "#{c[:skill_label]}: candidate L#{c[:candidate_level]} vs expected L#{c[:expected_level]} (+#{c[:delta]})" }.join(', ')}
        - Not assessed (#{not_assessed.count}): #{not_assessed.pluck(:skill_label).join(', ')}

        Write two short narrative paragraphs:
        1. culture_narrative: 2-3 sentences on culture/competency fit based on the comparison patterns.
        2. overall_narrative: 2-3 sentence overall hiring recommendation summary.

        OUTPUT (JSON only):
        {
          "culture_narrative": "...",
          "overall_narrative": "..."
        }
      PROMPT
    end

    def generate_fallback_narrative(comparisons)
      gaps         = comparisons.count { |c| c[:result] == 'gap' }
      matches      = comparisons.count { |c| c[:result] == 'match' }
      exceeds      = comparisons.count { |c| c[:result] == 'exceed' }
      not_assessed = comparisons.count { |c| c[:result] == 'not_assessed' }

      "Candidate shows #{matches} skill matches, #{exceeds} exceeds, and #{gaps} gaps against role " \
        "requirements, with #{not_assessed} skill#{'s' unless not_assessed == 1} not assessed in this interview."
    end
  end
end
