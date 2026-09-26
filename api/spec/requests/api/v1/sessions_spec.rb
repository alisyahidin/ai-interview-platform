# frozen_string_literal: true

require "rails_helper"

# Issue #29 (parent #27): candidate-facing session contract additions --
# end_reason/language exposure, consent + connectivity-advisory acknowledgment,
# and assessor-triggered re-invite from a terminal failed session.
#
# "Terminal failed state" here means status: 'ended', end_reason: 'error'.
# Session::STATUSES has an unused 'failed' value that nothing in the app ever
# actually sets (see Session#failed?) -- Sessions::EndHandler always leaves
# status at 'ended' and records the failure via end_reason instead.
#
# Candidate-facing actions (candidate_info/consent/connectivity_advisory) are
# authenticated by invite token in the URL, not JWT -- same pattern as the
# pre-existing candidate_info/audio_complete actions, so these specs hit them
# with no Authorization header. The re-invite action is assessor-authenticated
# (JWT + tenant scoping), following portfolios_spec.rb's conventions.
#
# Session-building helpers below are plain methods (not `let`) memoized on an
# ivar, deliberately, to stay under RSpec/MultipleMemoizedHelpers alongside
# the five tenant/header/assessment lets shared by every example group here.
RSpec.describe "Api::V1::Sessions", type: :request do
  let(:tenant_a) { create_tenant }
  let(:tenant_b) { create_tenant }
  let(:headers_a) { auth_headers_for(tenant_a) }
  let(:headers_b) { auth_headers_for(tenant_b) }
  let(:assessment_a) { create(:assessment, tenant_id: tenant_a.id, language: "id") }

  describe "GET /sessions/:token/candidate (candidate_info)" do
    def ended_session
      @ended_session ||= create(:session, tenant_id: tenant_a.id, assessment: assessment_a,
                                           status: "ended", end_reason: "error")
    end

    context "with a valid invite token" do
      before { get "/api/v1/sessions/#{ended_session.invite_token}/candidate" }

      it "returns 200" do
        expect(response).to have_http_status(:ok)
      end

      it "includes end_reason" do
        expect(response.parsed_body["end_reason"]).to eq("error")
      end

      it "includes the assessment's language" do
        expect(response.parsed_body["language"]).to eq("id")
      end

      it "keeps returning session_id" do
        expect(response.parsed_body["session_id"]).to eq(ended_session.id)
      end

      it "keeps returning role_title" do
        expect(response.parsed_body["role_title"]).to eq(assessment_a.name)
      end

      it "keeps returning time_limit_min" do
        expect(response.parsed_body["time_limit_min"]).to eq(assessment_a.time_limit_min)
      end

      it "keeps returning session_status" do
        expect(response.parsed_body["session_status"]).to eq("ended")
      end
    end

    context "when the session has not ended (end_reason is nil)" do
      def pending_session
        @pending_session ||= create(:session, tenant_id: tenant_a.id, assessment: assessment_a, status: "pending")
      end

      before { get "/api/v1/sessions/#{pending_session.invite_token}/candidate" }

      it "returns end_reason as a present key" do
        expect(response.parsed_body).to have_key("end_reason")
      end

      it "returns a nil end_reason" do
        expect(response.parsed_body["end_reason"]).to be_nil
      end
    end

    context "with an invalid invite token" do
      before { get "/api/v1/sessions/does-not-exist/candidate" }

      it "returns 404" do
        expect(response).to have_http_status(:not_found)
      end
    end
  end

  describe "POST /sessions/:token/consent (acknowledge_consent)" do
    def pending_session
      @pending_session ||= create(:session, tenant_id: tenant_a.id, assessment: assessment_a, status: "pending")
    end

    context "with a valid invite token" do
      before { post "/api/v1/sessions/#{pending_session.invite_token}/consent" }

      it "returns 200" do
        expect(response).to have_http_status(:ok)
      end

      it "persists consent_given_at" do
        expect(pending_session.reload.consent_given_at).to be_present
      end

      it "persists a current timestamp" do
        expect(pending_session.reload.consent_given_at).to be_within(5.seconds).of(Time.current)
      end

      it "returns the session_id in the response" do
        expect(response.parsed_body["session_id"]).to eq(pending_session.id)
      end

      it "returns the timestamp in the response" do
        expect(response.parsed_body["consent_given_at"]).to be_present
      end

      it "does not touch connectivity_advisory_acknowledged" do
        expect(pending_session.reload.connectivity_advisory_acknowledged).to be_nil
      end
    end

    context "with an invalid invite token" do
      before { post "/api/v1/sessions/does-not-exist/consent" }

      it "returns 404" do
        expect(response).to have_http_status(:not_found)
      end
    end
  end

  describe "POST /sessions/:token/connectivity_advisory (acknowledge_connectivity_advisory)" do
    def pending_session
      @pending_session ||= create(:session, tenant_id: tenant_a.id, assessment: assessment_a, status: "pending")
    end

    context "with a valid invite token" do
      before { post "/api/v1/sessions/#{pending_session.invite_token}/connectivity_advisory" }

      it "returns 200" do
        expect(response).to have_http_status(:ok)
      end

      it "persists connectivity_advisory_acknowledged" do
        expect(pending_session.reload.connectivity_advisory_acknowledged).to be_present
      end

      it "persists a current timestamp" do
        expect(pending_session.reload.connectivity_advisory_acknowledged).to be_within(5.seconds).of(Time.current)
      end

      it "returns the timestamp in the response body" do
        expect(response.parsed_body["connectivity_advisory_acknowledged"]).to be_present
      end

      it "does not touch consent_given_at" do
        expect(pending_session.reload.consent_given_at).to be_nil
      end
    end

    context "with an invalid invite token" do
      before { post "/api/v1/sessions/does-not-exist/connectivity_advisory" }

      it "returns 404" do
        expect(response).to have_http_status(:not_found)
      end
    end
  end

  describe "POST /api/v1/sessions/:id/reinvite" do
    # Session.count/.order(:id).last assertions below use relative deltas
    # (`change`), not absolute counts -- other spec files under spec/services/
    # create Session rows outside of a `type: :request` group (no directory-
    # inferred spec type there, so no transactional rollback), so the test
    # database can carry rows left over from earlier runs of this same suite.
    context "when the session is in a terminal failed state (ended, end_reason: error)" do
      def failed_session
        @failed_session ||= create(:session, tenant_id: tenant_a.id, assessment: assessment_a, status: "ended",
                                              end_reason: "error", candidate_id: 42, candidate_name: "Ada Lovelace")
      end

      def original_attrs
        # .reload here (not just .attributes right after create) because
        # public_id (#37) is a DB-side gen_random_uuid() default -- like
        # this schema's other function-defaulted columns, Rails doesn't
        # read it back onto the in-memory object until a reload. Without
        # this, "unmodified" would spuriously fail comparing a pre-reload
        # nil public_id against the real value on the post-reinvite reload.
        @original_attrs ||= failed_session.reload.attributes
      end

      def reinvite!
        post "/api/v1/sessions/#{failed_session.id}/reinvite", headers: headers_a
      end

      def new_session
        Session.order(:id).last
      end

      before do
        original_attrs
        reinvite!
      end

      it "returns 201" do
        expect(response).to have_http_status(:created)
      end

      it "creates exactly one new session row" do
        failed_session
        expect { reinvite! }.to change(Session, :count).by(1)
      end

      it "assigns the new session to the same assessment" do
        expect(new_session.assessment_id).to eq(failed_session.assessment_id)
      end

      it "assigns the new session to the same candidate_id" do
        expect(new_session.candidate_id).to eq(42)
      end

      it "assigns the new session the same candidate_name" do
        expect(new_session.candidate_name).to eq("Ada Lovelace")
      end

      it "assigns the new session the same tenant_id" do
        expect(new_session.tenant_id).to eq(failed_session.tenant_id)
      end

      it "starts the new session as pending" do
        expect(new_session.status).to eq("pending")
      end

      it "issues a fresh invite token distinct from the original" do
        expect(new_session.invite_token).not_to eq(failed_session.invite_token)
      end

      it "returns an invite_url built from the new token" do
        body = response.parsed_body
        expect(body["invite_url"]).to include(body["session"]["invite_token"])
      end

      it "leaves the original failed session completely unmodified" do
        expect(failed_session.reload.attributes).to eq(original_attrs)
      end
    end

    context "when the session is pending (not terminal)" do
      def pending_session
        @pending_session ||= create(:session, tenant_id: tenant_a.id, assessment: assessment_a, status: "pending")
      end

      def reinvite!
        post "/api/v1/sessions/#{pending_session.id}/reinvite", headers: headers_a
      end

      before { reinvite! }

      it "returns 422" do
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "creates no new session" do
        pending_session
        expect { reinvite! }.not_to change(Session, :count)
      end
    end

    context "when the session is active (not terminal)" do
      def active_session
        @active_session ||= create(:session, tenant_id: tenant_a.id, assessment: assessment_a, status: "active")
      end

      def reinvite!
        post "/api/v1/sessions/#{active_session.id}/reinvite", headers: headers_a
      end

      before { reinvite! }

      it "returns 422" do
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "creates no new session" do
        active_session
        expect { reinvite! }.not_to change(Session, :count)
      end
    end

    context "when the session ended successfully (all_covered, not a failure)" do
      def completed_session
        @completed_session ||= create(:session, tenant_id: tenant_a.id, assessment: assessment_a,
                                                 status: "ended", end_reason: "all_covered")
      end

      def reinvite!
        post "/api/v1/sessions/#{completed_session.id}/reinvite", headers: headers_a
      end

      before { reinvite! }

      it "returns 422" do
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "creates no new session" do
        completed_session
        expect { reinvite! }.not_to change(Session, :count)
      end
    end

    context "when the session ended manually (candidate/assessor closed it, not a failure)" do
      def manual_session
        @manual_session ||= create(:session, tenant_id: tenant_a.id, assessment: assessment_a,
                                              status: "ended", end_reason: "manual_candidate")
      end

      def reinvite!
        post "/api/v1/sessions/#{manual_session.id}/reinvite", headers: headers_a
      end

      before { reinvite! }

      it "returns 422" do
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "creates no new session" do
        manual_session
        expect { reinvite! }.not_to change(Session, :count)
      end
    end

    context "when the session ended at the time ceiling (not an error)" do
      def ceiling_session
        @ceiling_session ||= create(:session, tenant_id: tenant_a.id, assessment: assessment_a,
                                               status: "ended", end_reason: "time_ceiling")
      end

      def reinvite!
        post "/api/v1/sessions/#{ceiling_session.id}/reinvite", headers: headers_a
      end

      before { reinvite! }

      it "returns 422" do
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "creates no new session" do
        ceiling_session
        expect { reinvite! }.not_to change(Session, :count)
      end
    end

    context "when requested by another tenant" do
      def failed_session
        @failed_session ||= create(:session, tenant_id: tenant_a.id, assessment: assessment_a,
                                              status: "ended", end_reason: "error")
      end

      def reinvite!
        post "/api/v1/sessions/#{failed_session.id}/reinvite", headers: headers_b
      end

      before { reinvite! }

      it "returns 404" do
        expect(response).to have_http_status(:not_found)
      end

      it "creates no new session" do
        failed_session
        expect { reinvite! }.not_to change(Session, :count)
      end
    end

    context "when the session does not exist" do
      before { post "/api/v1/sessions/999999/reinvite", headers: headers_a }

      it "returns 404" do
        expect(response).to have_http_status(:not_found)
      end
    end

    context "when requested without assessor auth" do
      def failed_session
        @failed_session ||= create(:session, tenant_id: tenant_a.id, assessment: assessment_a,
                                              status: "ended", end_reason: "error")
      end

      def reinvite!
        post "/api/v1/sessions/#{failed_session.id}/reinvite"
      end

      before { reinvite! }

      it "does not authorize the request" do
        expect(response.status).to be_in([401, 403])
      end

      it "creates no new session" do
        failed_session
        expect { reinvite! }.not_to change(Session, :count)
      end
    end
  end

  describe "the old invite token stays dead after re-invite (start-guard confirmation)" do
    # A candidate never "starts" a session over plain HTTP -- Sessions::StartHandler is
    # only invoked from AudioWebSocketMiddleware#connect_to_gemini when the audio
    # WebSocket opens. That guard already existed before this ticket:
    # AudioWebSocketMiddleware#authenticate_and_load returns [nil, "Session has ended"]
    # for *any* ended session (regardless of end_reason), which already covers "the old
    # token stops working" once re-invite creates a new session -- exercised directly
    # in spec/services/audio_web_socket_middleware_spec.rb.
    #
    # This spec confirms the one HTTP surface a stale link actually hits --
    # candidate_info -- keeps reporting the old session as ended, never silently
    # resurrected or reassigned, after a re-invite happens.
    def failed_session
      @failed_session ||= create(:session, tenant_id: tenant_a.id, assessment: assessment_a,
                                            status: "ended", end_reason: "error")
    end

    before do
      post "/api/v1/sessions/#{failed_session.id}/reinvite", headers: headers_a
      get "/api/v1/sessions/#{failed_session.invite_token}/candidate"
    end

    it "still returns 200 for the old token" do
      expect(response).to have_http_status(:ok)
    end

    it "still reports the old session's id" do
      expect(response.parsed_body["session_id"]).to eq(failed_session.id)
    end

    it "still reports the old session as ended" do
      expect(response.parsed_body["session_status"]).to eq("ended")
    end

    it "still reports the original end_reason" do
      expect(response.parsed_body["end_reason"]).to eq("error")
    end
  end
end
