# frozen_string_literal: true

# PR2 / F1 / F20 / F28 (issue #6): gives the schema a way to say "not
# assessed" and "needs human review" instead of forcing every skill into a
# 1-5 number, plus columns to record what produced a score and why a
# generation failed.
#
# See docs/adr and issue #4 (parent spec) for the full rationale. This
# migration is additive and reversible; `ai_level` itself is never rewritten
# by the legacy backfill below, only flagged.
class AddAssessmentStatusAndProvenance < ActiveRecord::Migration[7.0]
  ASSESSMENT_STATUSES = %w[assessed not_assessed needs_review].freeze
  STATUS_REASONS = %w[omitted_by_model invalid_model_output legacy_unverified].freeze
  FAILURE_CODES = %w[upstream_error invalid_output timeout unknown].freeze

  ORIGINAL_AI_LEVEL_CHECK = "ai_level >= 1 AND ai_level <= 5"
  RELAXED_AI_LEVEL_CHECK = <<~SQL.squish
    (ai_level BETWEEN 1 AND 5) OR (ai_level IS NULL AND assessment_status <> 'assessed')
  SQL

  def up
    create_enum :assessment_status, ASSESSMENT_STATUSES
    create_enum :status_reason, STATUS_REASONS
    create_enum :failure_code, FAILURE_CODES

    add_column :portfolio_skills, :assessment_status, :enum,
               enum_type: "assessment_status", null: false, default: "assessed"
    add_column :portfolio_skills, :status_reason, :enum, enum_type: "status_reason"

    add_column :portfolios, :model_name, :string
    add_column :portfolios, :prompt_version, :string
    add_column :portfolios, :failure_code, :enum, enum_type: "failure_code"

    backfill_legacy_needs_review

    remove_check_constraint :portfolio_skills, name: "chk_portfolio_skills_ai_level"
    change_column_null :portfolio_skills, :ai_level, true
    add_check_constraint :portfolio_skills, RELAXED_AI_LEVEL_CHECK,
                          name: "chk_portfolio_skills_ai_level"
  end

  def down
    remove_check_constraint :portfolio_skills, name: "chk_portfolio_skills_ai_level"

    # Restore a value for any row a later phase left NULL, so the NOT NULL
    # constraint below can be reapplied without failing.
    execute "UPDATE portfolio_skills SET ai_level = 1 WHERE ai_level IS NULL"

    change_column_null :portfolio_skills, :ai_level, false
    add_check_constraint :portfolio_skills, ORIGINAL_AI_LEVEL_CHECK,
                          name: "chk_portfolio_skills_ai_level"

    remove_column :portfolios, :failure_code
    remove_column :portfolios, :prompt_version
    remove_column :portfolios, :model_name

    remove_column :portfolio_skills, :status_reason
    remove_column :portfolio_skills, :assessment_status

    execute "DROP TYPE IF EXISTS failure_code"
    execute "DROP TYPE IF EXISTS status_reason"
    execute "DROP TYPE IF EXISTS assessment_status"
  end

  private

  # Legacy backfill, run once as part of this migration, never repeated:
  # for every existing portfolio_skills row where ai_level = 1, join through
  # portfolio -> session -> coverage_maps (matched on session_id +
  # skill_label, since coverage_maps has no portfolio_skill_id) and flag it
  # needs_review/legacy_unverified wherever the matched coverage state was
  # not_yet. ai_level itself is never rewritten.
  def backfill_legacy_needs_review
    execute <<~SQL.squish
      UPDATE portfolio_skills ps
      SET assessment_status = 'needs_review', status_reason = 'legacy_unverified'
      FROM portfolios p, sessions s, coverage_maps cm
      WHERE ps.portfolio_id = p.id
        AND p.session_id = s.id
        AND cm.session_id = s.id
        AND cm.skill_label = ps.skill_label
        AND ps.ai_level = 1
        AND cm.state = 'not_yet'
    SQL
  end
end
