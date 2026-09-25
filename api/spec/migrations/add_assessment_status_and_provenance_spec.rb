# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("db/migrate/20260925010000_add_assessment_status_and_provenance.rb")

# Proves the legacy-backfill predicate from issue #6: it must flag a
# portfolio_skill needs_review/legacy_unverified only when BOTH ai_level = 1
# AND the matched coverage_maps row (joined on session_id + skill_label) was
# not_yet -- never every ai_level = 1 row, and never a row whose ai_level
# happens to be something else.
#
# The up -> down -> up reversibility of the full migration (schema creation,
# column add/remove, check-constraint swap) is proven separately by running
# the migration commands directly against a seeded copy of the DB, per this
# ticket's acceptance criteria -- that terminal output accompanies the PR.
# This spec exercises the migration's own backfill method directly (it is
# not duplicated here) so the join/predicate logic has a real, repeatable
# assertion instead of only manual inspection.
RSpec.describe AddAssessmentStatusAndProvenance do
  subject(:migration) { described_class.new }

  let(:session) { create(:session) }
  let(:portfolio) { create(:portfolio, session: session) }

  let!(:flagged) do
    create(:coverage_map, session: session, skill_label: "Flagged Skill", state: "not_yet")
    create(:portfolio_skill, portfolio: portfolio, skill_label: "Flagged Skill", ai_level: 1)
  end

  # Same ai_level = 1, but coverage was NOT not_yet -- must be left alone.
  let!(:covered) do
    create(:coverage_map, session: session, skill_label: "Covered Skill", state: "covered")
    create(:portfolio_skill, portfolio: portfolio, skill_label: "Covered Skill", ai_level: 1)
  end

  # Coverage was not_yet, but ai_level is not 1 -- must be left alone.
  let!(:higher_level) do
    create(:coverage_map, session: session, skill_label: "Higher Level Skill", state: "not_yet")
    create(:portfolio_skill, portfolio: portfolio, skill_label: "Higher Level Skill", ai_level: 2)
  end

  def run_backfill
    migration.send(:backfill_legacy_needs_review)
  end

  it "flags the row where ai_level = 1 AND the matched coverage state was not_yet" do
    run_backfill

    expect(flagged.reload).to have_attributes(
      ai_level: 1, assessment_status: "needs_review", status_reason: "legacy_unverified"
    )
  end

  it "leaves an ai_level = 1 row alone when its matched coverage was not not_yet" do
    run_backfill

    expect(covered.reload).to have_attributes(assessment_status: "assessed", status_reason: nil)
  end

  it "leaves a not_yet-covered row alone when its ai_level is not 1" do
    run_backfill

    expect(higher_level.reload).to have_attributes(assessment_status: "assessed", status_reason: nil)
  end

  it "never rewrites ai_level itself, even on a flagged row" do
    expect { run_backfill }.not_to(change { flagged.reload.ai_level })
  end
end
