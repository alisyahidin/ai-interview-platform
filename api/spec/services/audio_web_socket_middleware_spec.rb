# frozen_string_literal: true

require "rails_helper"

# Issue #29 (parent #27): re-invite depends on "the old invite token stops
# working" once a fresh session/token exists for the candidate. That guard
# lives in AudioWebSocketMiddleware#authenticate_and_load -- the only place a
# candidate's invite token is exchanged to actually *start* a session (via the
# audio WebSocket, not plain HTTP). This spec confirms the guard already
# existed and already rejects any ended session (regardless of end_reason)
# before this ticket added anything -- see Session#failed? and the sessions
# controller changes in this same ticket for the rest of the contract.
#
# authenticate_and_load is a private method with no external dependencies
# beyond ActiveRecord and JsonWebToken, so it is exercised directly here
# rather than through a real WebSocket handshake.
RSpec.describe AudioWebSocketMiddleware do
  subject(:middleware) { described_class.new(->(_env) { [200, {}, []] }) }

  let(:tenant) { Organization.create!(name: "t", scheme: "scheme-#{SecureRandom.hex(4)}", identifier: "t", host: "t.example.com") }
  let(:assessment) { create(:assessment, tenant_id: tenant.id) }

  def env_for(token:)
    Rack::MockRequest.env_for("/ws/sessions/1/audio?token=#{token}")
  end

  def authenticate(session)
    middleware.send(:authenticate_and_load, env_for(token: session.invite_token), session.id.to_s)
  end

  def result_for(session)
    authenticate(session).first
  end

  def error_for(session)
    authenticate(session).second
  end

  context "when the session has already ended (any end_reason)" do
    Session::END_REASONS.each do |reason|
      it "returns no session for end_reason=#{reason}" do
        session = create(:session, tenant_id: tenant.id, assessment: assessment, status: "ended", end_reason: reason)
        expect(result_for(session)).to be_nil
      end

      it "returns 'Session has ended' for end_reason=#{reason}" do
        session = create(:session, tenant_id: tenant.id, assessment: assessment, status: "ended", end_reason: reason)
        expect(error_for(session)).to eq("Session has ended")
      end
    end

    context "with no end_reason recorded" do
      let(:session) { create(:session, tenant_id: tenant.id, assessment: assessment, status: "ended", end_reason: nil) }

      it "returns no session" do
        expect(result_for(session)).to be_nil
      end

      it "returns 'Session has ended'" do
        expect(error_for(session)).to eq("Session has ended")
      end
    end
  end

  context "when the session is pending" do
    let(:session) { create(:session, tenant_id: tenant.id, assessment: assessment, status: "pending") }

    it "returns the session" do
      expect(result_for(session)).to eq(session)
    end

    it "returns no error" do
      expect(error_for(session)).to be_nil
    end
  end

  context "when the session is active" do
    let(:session) { create(:session, tenant_id: tenant.id, assessment: assessment, status: "active") }

    it "returns the session" do
      expect(result_for(session)).to eq(session)
    end

    it "returns no error" do
      expect(error_for(session)).to be_nil
    end
  end

  context "when the invite token does not resolve to any session" do
    def authenticate_unknown_token
      middleware.send(:authenticate_and_load, env_for(token: "nonexistent"), "1")
    end

    it "returns no session" do
      expect(authenticate_unknown_token.first).to be_nil
    end

    it "returns 'Session not found'" do
      expect(authenticate_unknown_token.second).to eq("Session not found")
    end
  end
end
