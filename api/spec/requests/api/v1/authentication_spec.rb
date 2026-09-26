# frozen_string_literal: true

require "rails_helper"

# Issue #38 (registration, gated by a single-use OrganizationInvitation
# token) and Phase 5 #3 / issue #39 (login accepts both `admin` and `user`
# roles, the JWT no longer carries a `scheme` claim, and every authenticated
# request re-fetches the User from the database -- closing "a deleted user's
# token still works" and deriving tenant from the freshly-loaded user's own
# `organization_id` instead of trusting the token).
RSpec.describe "Api::V1::Authentication", type: :request do
  let(:organization) { create_tenant }

  describe "POST /api/v1/auth/register" do
    let(:invitation) { create(:organization_invitation, organization_id: organization.id) }

    def register(email: "new.assessor@example.com", password: "password123", token: invitation.token, **extra)
      post "/api/v1/auth/register",
           params: { email: email, password: password, invitation_token: token }.merge(extra)
    end

    context "with a valid, unused, unexpired invitation token" do
      before { register }

      it "returns 201 Created" do
        expect(response).to have_http_status(:created)
      end

      it "creates a user scoped to the invitation organization" do
        user = User.find_by(email: "new.assessor@example.com")
        expect(user.organization_id).to eq(organization.id)
      end

      it "creates the user with role \"user\"" do
        user = User.find_by(email: "new.assessor@example.com")
        expect(user.role).to eq("user")
      end

      it "marks the invitation used" do
        expect(invitation.reload.used_at).to be_present
      end
    end

    context "when the payload includes a role field" do
      before { register(role: "admin") }

      it "still creates the user with role \"user\", ignoring the submitted role" do
        user = User.find_by(email: "new.assessor@example.com")
        expect(user.role).to eq("user")
      end
    end

    context "with a token that does not exist" do
      before { register(token: "not-a-real-token") }

      it "returns 422" do
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "does not create a user" do
        expect(User.find_by(email: "new.assessor@example.com")).to be_nil
      end
    end

    context "with an expired token" do
      let(:invitation) { create(:organization_invitation, :expired, organization_id: organization.id) }

      before { register }

      it "returns 422" do
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "does not create a user" do
        expect(User.find_by(email: "new.assessor@example.com")).to be_nil
      end
    end

    context "with an already-used token" do
      let(:invitation) { create(:organization_invitation, :used, organization_id: organization.id) }

      before { register }

      it "returns 422" do
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "does not create a user" do
        expect(User.find_by(email: "new.assessor@example.com")).to be_nil
      end
    end

    context "when the invitation was already consumed by an earlier registration" do
      let(:reused_token_attempt) do
        register(email: "first@example.com")
        first_status = response.status
        register(email: "second@example.com", token: invitation.token)
        { first_status: first_status, second_status: response.status }
      end

      it "accepts the first registration" do
        expect(reused_token_attempt[:first_status]).to eq(201)
      end

      it "rejects the second attempt to reuse the same token" do
        expect(reused_token_attempt[:second_status]).to eq(422)
      end

      it "does not create the second user" do
        reused_token_attempt
        expect(User.find_by(email: "second@example.com")).to be_nil
      end
    end

    context "with an email that is already registered" do
      before do
        create(:user, email: "taken@example.com")
        register(email: "taken@example.com")
      end

      it "returns 422" do
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "does not consume the invitation" do
        expect(invitation.reload.used_at).to be_nil
      end
    end

    context "when comparing duplicate-email and invalid-token rejections (AC5, no enumeration side channel)" do
      let(:duplicate_and_invalid_responses) do
        create(:user, email: "taken@example.com")
        register(email: "taken@example.com")
        duplicate_status = response.status
        duplicate_body = response.parsed_body

        register(email: "someone.else@example.com", token: "not-a-real-token")

        { duplicate_status: duplicate_status, duplicate_body: duplicate_body,
          invalid_status: response.status, invalid_body: response.parsed_body }
      end

      it "returns the same HTTP status for both" do
        expect(duplicate_and_invalid_responses[:duplicate_status]).to eq(duplicate_and_invalid_responses[:invalid_status])
      end

      it "returns the same response body shape for both" do
        expect(duplicate_and_invalid_responses[:duplicate_body]).to eq(duplicate_and_invalid_responses[:invalid_body])
      end
    end
  end

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
