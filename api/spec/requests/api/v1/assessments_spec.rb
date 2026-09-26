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

  def latest_session_for(public_id)
    response.parsed_body["assessments"].find { |a| a["public_id"] == public_id }["latest_session"]
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
        expect(latest_session_for(assessment.public_id)).to include(
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
        expect(latest_session_for(assessment.public_id)).to include("connectivity_advisory_acknowledged" => nil)
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
        expect(latest_session_for(assessment.public_id)).to include(
          "status" => "ended", "end_reason" => "error",
          "connectivity_advisory_acknowledged" => "2026-09-26T10:00:00.000Z"
        )
      end
    end
  end

  # Issue #40 (Phase 5 #7, parent #35/F30/D11): assessments are addressed by
  # `public_id` end to end. Sequential `id` must never appear in an assessment
  # response body, and a request using the old sequential id -- where a route
  # used to accept one -- must 404, not silently coerce or fall back.
  describe "public_id addressing (#40)" do
    let(:assessment) { create(:assessment, tenant_id: tenant.id) }

    describe "GET /api/v1/assessments" do
      before do
        assessment
        get "/api/v1/assessments", headers: headers
      end

      it "keys each assessment on public_id" do
        expect(response.parsed_body["assessments"].first["public_id"]).to eq(assessment.public_id)
      end

      it "never includes the sequential id" do
        expect(response.parsed_body["assessments"].first).not_to have_key("id")
      end
    end

    describe "GET /api/v1/assessments/:public_id" do
      before { get "/api/v1/assessments/#{assessment.public_id}", headers: headers }

      it "returns 200" do
        expect(response).to have_http_status(:ok)
      end

      it "keys the response on public_id" do
        expect(response.parsed_body["assessment"]["public_id"]).to eq(assessment.public_id)
      end

      it "never includes the sequential id" do
        expect(response.parsed_body["assessment"]).not_to have_key("id")
      end
    end

    describe "GET /api/v1/assessments/:id using the old sequential id" do
      before { get "/api/v1/assessments/#{assessment.id}", headers: headers }

      it "returns 404, not a fallback lookup" do
        expect(response).to have_http_status(:not_found)
      end
    end

    describe "PUT /api/v1/assessments/:public_id" do
      before do
        put "/api/v1/assessments/#{assessment.public_id}",
            params: { assessment: { name: "Renamed" } },
            headers: headers
      end

      it "returns 200" do
        expect(response).to have_http_status(:ok)
      end

      it "keys the response on public_id" do
        expect(response.parsed_body["assessment"]["public_id"]).to eq(assessment.public_id)
      end
    end

    describe "PUT /api/v1/assessments/:id using the old sequential id" do
      before do
        put "/api/v1/assessments/#{assessment.id}",
            params: { assessment: { name: "Renamed" } },
            headers: headers
      end

      it "returns 404" do
        expect(response).to have_http_status(:not_found)
      end
    end

    describe "DELETE /api/v1/assessments/:id using the old sequential id" do
      before { delete "/api/v1/assessments/#{assessment.id}", headers: headers }

      it "returns 404" do
        expect(response).to have_http_status(:not_found)
      end

      it "leaves the record intact" do
        expect(Assessment.exists?(assessment.id)).to be true
      end
    end

    describe "POST /api/v1/assessments" do
      before do
        post "/api/v1/assessments",
             params: { assessment: { name: "New assessment", time_limit_min: 30, language: "en" } },
             headers: headers
      end

      it "returns 201" do
        expect(response).to have_http_status(:created)
      end

      it "keys the response on a present public_id" do
        expect(response.parsed_body["assessment"]["public_id"]).to be_present
      end

      it "never includes the sequential id" do
        expect(response.parsed_body["assessment"]).not_to have_key("id")
      end
    end

    describe "GET /api/v1/assessments/:assessment_public_id/sessions (nested)" do
      before do
        create(:session, tenant_id: tenant.id, assessment: assessment)
        get "/api/v1/assessments/#{assessment.public_id}/sessions", headers: headers
      end

      it "returns 200" do
        expect(response).to have_http_status(:ok)
      end

      it "returns the assessment's sessions" do
        expect(response.parsed_body["sessions"].size).to eq(1)
      end
    end

    describe "GET /api/v1/assessments/:assessment_id/sessions using the old sequential id" do
      before { get "/api/v1/assessments/#{assessment.id}/sessions", headers: headers }

      it "returns 404, not a fallback lookup" do
        expect(response).to have_http_status(:not_found)
      end
    end

    describe "GET /api/v1/sessions/:id (nested assessment sub-object)" do
      let(:session) { create(:session, tenant_id: tenant.id, assessment: assessment) }

      before { get "/api/v1/sessions/#{session.id}", headers: headers }

      it "keys the embedded assessment on public_id" do
        expect(response.parsed_body["session"]["assessment"]["public_id"]).to eq(assessment.public_id)
      end

      it "never includes the assessment's sequential id in the embedded object" do
        expect(response.parsed_body["session"]["assessment"]).not_to have_key("id")
      end
    end
  end
end
