# frozen_string_literal: true

module Portfolios
  # N?: Pure, DB-free normalizer for a single skill's raw model output.
  #
  # Given the model's raw `level`/`confidence` for one skill, plus a couple of
  # bits of context (was the skill omitted entirely? what was its prior
  # coverage state?), decides what should actually be persisted:
  #
  #   - `:assessed`     — a clean integer level 1..5
  #   - `:not_assessed` — no measurement (nil, "N/A", 0, or anything else
  #                       that doesn't parse as a meaningful score)
  #   - `:needs_review` — a level was returned, but the skill's coverage was
  #                       still `not_yet` when the model scored it. The level
  #                       is kept (not discarded), just flagged for a human.
  #   - `:invalid`      — the raw value parses to a number but is out of the
  #                       1..5 range, or is non-integer (e.g. 7, 3.7). This is
  #                       a sentinel, not a real `portfolio_skills.assessment_status`
  #                       value: callers (see #8) treat it as a signal to fail
  #                       the whole batch rather than something to persist.
  #
  # No ActiveRecord, no I/O — just data in, a `Result` out.
  class LevelNormalizer
    VALID_LEVEL_RANGE = (1..5).freeze
    CONFIDENCE_VALUES = %w[high medium low].freeze
    DEFAULT_CONFIDENCE = :low
    NOT_YET_COVERAGE_STATE = 'not_yet'

    # @!attribute assessment_status [Symbol] :assessed / :not_assessed / :needs_review / :invalid
    # @!attribute level [Integer, nil] the normalized 1..5 level, or nil when not assessed/invalid
    # @!attribute status_reason [Symbol, nil] :omitted_by_model / :invalid_model_output / nil
    # @!attribute confidence [Symbol] :high / :medium / :low
    Result = Struct.new(:assessment_status, :level, :status_reason, :confidence, keyword_init: true) do
      def assessed?
        assessment_status == :assessed
      end

      def not_assessed?
        assessment_status == :not_assessed
      end

      def needs_review?
        assessment_status == :needs_review
      end

      def invalid?
        assessment_status == :invalid
      end
    end

    # @param level [Object] the raw value the model returned for this skill's level
    # @param confidence [Object] the raw value the model returned for confidence
    # @param coverage_state [Object, nil] the skill's coverage state prior to scoring
    #   (from `coverage_maps`, keyed by session_id + skill_label), or nil if unknown
    # @param omitted [Boolean] true when the configured skill was entirely absent
    #   from the model's response (as opposed to present with a null/empty level)
    # @return [Result]
    def self.call(level: nil, confidence: nil, coverage_state: nil, omitted: false)
      new(level: level, confidence: confidence, coverage_state: coverage_state, omitted: omitted).call
    end

    def initialize(level:, confidence:, coverage_state:, omitted:)
      @level = level
      @confidence = confidence
      @coverage_state = coverage_state
      @omitted = omitted
    end

    def call
      confidence = normalize_confidence(@confidence)

      return result(:not_assessed, level: nil, reason: :omitted_by_model, confidence: confidence) if @omitted

      classified = classify_level(@level)

      case classified
      when :not_assessed
        result(:not_assessed, level: nil, reason: nil, confidence: confidence)
      when :invalid
        result(:invalid, level: nil, reason: :invalid_model_output, confidence: confidence)
      else
        status = not_yet_coverage? ? :needs_review : :assessed
        result(status, level: classified, reason: nil, confidence: confidence)
      end
    end

    private

    def result(status, level:, reason:, confidence:)
      Result.new(assessment_status: status, level: level, status_reason: reason, confidence: confidence)
    end

    def not_yet_coverage?
      @coverage_state.to_s == NOT_YET_COVERAGE_STATE
    end

    # Returns :not_assessed, :invalid, or a valid Integer in 1..5.
    def classify_level(raw)
      return :not_assessed if raw.nil?
      return :not_assessed if raw.is_a?(String) && no_measurement_string?(raw)

      numeric = parse_numeric(raw)
      return :not_assessed if numeric.nil?
      return :not_assessed if numeric.zero?

      integer_level?(numeric) ? classify_integer(numeric.to_i) : :invalid
    end

    def no_measurement_string?(str)
      str.strip.casecmp('N/A').zero? || str.strip.empty?
    end

    def classify_integer(int)
      VALID_LEVEL_RANGE.cover?(int) ? int : :invalid
    end

    def integer_level?(numeric)
      numeric.is_a?(Integer) || numeric == numeric.to_i
    end

    # Parses Integers/Floats as-is; parses strict numeric strings ("3", "3.7",
    # "-1"); returns nil for anything else (including non-numeric strings,
    # which are treated as "no measurement" rather than raising).
    def parse_numeric(raw)
      return raw if raw.is_a?(Integer) || raw.is_a?(Float)
      return nil unless raw.is_a?(String)

      str = raw.strip
      return nil if str.empty?
      return str.to_i if str.match?(/\A-?\d+\z/)
      return str.to_f if str.match?(/\A-?\d+\.\d+\z/)

      nil
    end

    def normalize_confidence(raw)
      return DEFAULT_CONFIDENCE if raw.nil?

      normalized = raw.to_s.strip.downcase
      CONFIDENCE_VALUES.include?(normalized) ? normalized.to_sym : DEFAULT_CONFIDENCE
    end
  end
end
