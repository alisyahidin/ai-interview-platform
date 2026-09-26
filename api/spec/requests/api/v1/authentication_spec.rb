# frozen_string_literal: true

require "rails_helper"

# Phase 5 #3: login accepts both `admin` and `user` roles (previously
# hard-gated to `role: "admin"` only, via Auth::Authentication), the JWT no
# longer carries a `scheme` claim, and every authenticated request re-fetches
# the User from the database -- closing "a deleted user's token still works"
# and deriving tenant from the freshly-loaded user's own `organization_id`
# instead of trusting the token.
#
# Ticket #38 (registration) may add its own describe blocks to this same
# file -- additions here are kept scoped under "POST /api/v1/auth/login" and
# clearly-named sibling describes so a merge stays clean.
RSpec.describe "Api::V1::Authentication", type: :request do
  let(:organization) { create_tenant }

  describe "POST /api/v1/auth/login" do
    def login(email:, password: "password123")
      post "/api/v1/auth/login", params: { email: email, password: password }
    end

    %w[admin user].each do |role|
      context "with a role: \"#{role}\" account" do
        let!(:user) do
          create(:user, email: "#{role}-#{SecureRandom.hex(4)}@example.com",
                        password: "password123", role: role, organization_id: organization.id)
        end
        let!(:own_assessment)   { create(:assessment, tenant_id: organization.id) }
        let!(:other_org)        { create_tenant }
        let!(:other_assessment) { create(:assessment, tenant_id: other_org.id) }

        before { login(email: user.email) }

        it "returns 200" do
          expect(response).to have_http_status(:ok)
        end

        it "returns a token" do
          expect(response.parsed_body["token"]).to be_present
        end

        it "returns the user's own identity" do
          expect(response.parsed_body["user"]).to include(
            "id" => user.id, "email" => user.email, "role" => role, "organization_id" => organization.id
          )
        end

        it "does not include a scheme claim in the issued JWT" do
          token  = response.parsed_body["token"]
          claims = JsonWebToken.decode(token)

          expect(claims).not_to have_key("scheme")
        end

        it "scopes a subsequent request to that user's own organization's data" do
          expect(scoped_assessment_ids).to include(own_assessment.id)
        end

        it "excludes another organization's data from that subsequent request" do
          expect(scoped_assessment_ids).not_to include(other_assessment.id)
        end

        def scoped_assessment_ids
          token = response.parsed_body["token"]
          get "/api/v1/assessments", headers: { "Authorization" => "Bearer #{token}" }
          response.parsed_body["assessments"].pluck("id")
        end
      end
    end

    context "with an incorrect password" do
      let!(:user) do
        create(:user, email: "badpass@example.com", password: "password123",
                      role: "user", organization_id: organization.id)
      end

      before { login(email: user.email, password: "wrong-password") }

      it "returns 401" do
        expect(response).to have_http_status(:unauthorized)
      end
    end

    context "with an email that has no account" do
      before { login(email: "nobody@example.com") }

      it "returns 401" do
        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "a JWT for a since-deleted user" do
    it "is rejected (401) on the next authenticated request" do
      user  = create_auth_user(organization)
      token = JsonWebToken.encode(user_id: user.id)
      user.destroy!

      get "/api/v1/assessments", headers: { "Authorization" => "Bearer #{token}" }

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "candidate-facing invite-token endpoints (regression guard)" do
    it "GET /api/v1/sessions/:token/candidate still works with no Authorization header" do
      assessment = create(:assessment, tenant_id: organization.id)
      session    = create(:session, tenant_id: organization.id, assessment: assessment, status: "pending")

      get "/api/v1/sessions/#{session.invite_token}/candidate"

      expect(response).to have_http_status(:ok)
    end

    it "POST /api/v1/sessions/:token/audio_complete still works with no Authorization header" do
      assessment = create(:assessment, tenant_id: organization.id)
      session    = create(:session, tenant_id: organization.id, assessment: assessment, status: "active")

      post "/api/v1/sessions/#{session.invite_token}/audio_complete"

      expect(response).to have_http_status(:ok)
    end
  end
end
