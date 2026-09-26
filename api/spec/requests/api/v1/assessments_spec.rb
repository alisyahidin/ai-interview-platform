# frozen_string_literal: true

require "rails_helper"

# Code-review finding on #27/#29: connectivity_advisory_acknowledged was added
# to the sessions table and exposed on the candidate-facing session_json
# helper (sessions_controller.rb), but never surfaced on the assessor-facing
# assessments list -- so the assessor's session/monitor view had nothing to
# read to show the "small inline note" the parent spec (#27) describes. This
# spec proves the assessments index now round-trips that field through
# latest_session, purely additively alongside the pre-existing id/status/
# end_reason keys.
RSpec.describe "Api::V1::Assessments", type: :request do
  let(:tenant)  { create_tenant }
  let(:headers) { auth_headers_for(tenant) }

  def latest_session_for(id)
    response.parsed_body["assessments"].find { |a| a["id"] == id }["latest_session"]
  end

  describe "GET /api/v1/assessments" do
    context "when the latest session acknowledged a connectivity advisory" do
      let(:assessment) { create(:assessment, tenant_id: tenant.id) }
      let(:acknowledged_at) { Time.zone.parse("2026-09-26T10:00:00Z") }

      before do
        create(:session, tenant_id: tenant.id, assessment: assessment,
               status: "active", connectivity_advisory_acknowledged: acknowledged_at)
        get "/api/v1/assessments", headers: headers
      end

      it "returns 200" do
        expect(response).to have_http_status(:ok)
      end

      it "includes connectivity_advisory_acknowledged in latest_session alongside the existing keys" do
        expect(latest_session_for(assessment.id)).to include(
          "id" => be_present, "status" => "active", "end_reason" => nil,
          "connectivity_advisory_acknowledged" => "2026-09-26T10:00:00.000Z"
        )
      end
    end

    context "when the latest session never acknowledged a connectivity advisory" do
      let(:assessment) { create(:assessment, tenant_id: tenant.id) }

      before do
        create(:session, tenant_id: tenant.id, assessment: assessment, status: "ended")
        get "/api/v1/assessments", headers: headers
      end

      it "returns a nil connectivity_advisory_acknowledged (regression guard)" do
        expect(latest_session_for(assessment.id)).to include("connectivity_advisory_acknowledged" => nil)
      end
    end

    context "when the latest session failed despite the candidate acknowledging the advisory" do
      # #27's decision explicitly says the advisory note should surface
      # regardless of the session's eventual outcome -- not gated to only
      # the successful/active path.
      let(:assessment) { create(:assessment, tenant_id: tenant.id) }
      let(:acknowledged_at) { Time.zone.parse("2026-09-26T10:00:00Z") }

      before do
        create(:session, tenant_id: tenant.id, assessment: assessment,
               status: "ended", end_reason: "error", connectivity_advisory_acknowledged: acknowledged_at)
        get "/api/v1/assessments", headers: headers
      end

      it "still includes connectivity_advisory_acknowledged on a failed session" do
        expect(latest_session_for(assessment.id)).to include(
          "status" => "ended", "end_reason" => "error",
          "connectivity_advisory_acknowledged" => "2026-09-26T10:00:00.000Z"
        )
      end
    end
  end
end
