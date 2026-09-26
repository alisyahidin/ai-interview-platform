# frozen_string_literal: true

require 'rails_helper'

# Issue #38 (parent #35): registration gated by a single-use
# OrganizationInvitation token.
#
# This file is new -- no request spec previously existed for this
# controller. #39 (login gating) will add its own `describe "POST
# .../auth/login"` block here in parallel; everything below is scoped under
# its own top-level describe to keep that merge clean.
RSpec.describe 'Api::V1::Authentication', type: :request do
  describe 'POST /api/v1/auth/register' do
    let(:organization) { create_tenant }
    let(:invitation) { create(:organization_invitation, organization_id: organization.id) }

    def register(email: 'new.assessor@example.com', password: 'password123', token: invitation.token, **extra)
      post '/api/v1/auth/register',
           params: { email: email, password: password, invitation_token: token }.merge(extra)
    end

    context 'with a valid, unused, unexpired invitation token' do
      before { register }

      it 'returns 201 Created' do
        expect(response).to have_http_status(:created)
      end

      it 'creates a user scoped to the invitation organization' do
        user = User.find_by(email: 'new.assessor@example.com')
        expect(user.organization_id).to eq(organization.id)
      end

      it 'creates the user with role "user"' do
        user = User.find_by(email: 'new.assessor@example.com')
        expect(user.role).to eq('user')
      end

      it 'marks the invitation used' do
        expect(invitation.reload.used_at).to be_present
      end
    end

    context 'when the payload includes a role field' do
      before { register(role: 'admin') }

      it 'still creates the user with role "user", ignoring the submitted role' do
        user = User.find_by(email: 'new.assessor@example.com')
        expect(user.role).to eq('user')
      end
    end

    context 'with a token that does not exist' do
      before { register(token: 'not-a-real-token') }

      it 'returns 422' do
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it 'does not create a user' do
        expect(User.find_by(email: 'new.assessor@example.com')).to be_nil
      end
    end

    context 'with an expired token' do
      let(:invitation) { create(:organization_invitation, :expired, organization_id: organization.id) }

      before { register }

      it 'returns 422' do
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it 'does not create a user' do
        expect(User.find_by(email: 'new.assessor@example.com')).to be_nil
      end
    end

    context 'with an already-used token' do
      let(:invitation) { create(:organization_invitation, :used, organization_id: organization.id) }

      before { register }

      it 'returns 422' do
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it 'does not create a user' do
        expect(User.find_by(email: 'new.assessor@example.com')).to be_nil
      end
    end

    context 'when the invitation was already consumed by an earlier registration' do
      let(:reused_token_attempt) do
        register(email: 'first@example.com')
        first_status = response.status
        register(email: 'second@example.com', token: invitation.token)
        { first_status: first_status, second_status: response.status }
      end

      it 'accepts the first registration' do
        expect(reused_token_attempt[:first_status]).to eq(201)
      end

      it 'rejects the second attempt to reuse the same token' do
        expect(reused_token_attempt[:second_status]).to eq(422)
      end

      it 'does not create the second user' do
        reused_token_attempt
        expect(User.find_by(email: 'second@example.com')).to be_nil
      end
    end

    context 'with an email that is already registered' do
      before do
        create(:user, email: 'taken@example.com')
        register(email: 'taken@example.com')
      end

      it 'returns 422' do
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it 'does not consume the invitation' do
        expect(invitation.reload.used_at).to be_nil
      end
    end

    context 'when comparing duplicate-email and invalid-token rejections (AC5, no enumeration side channel)' do
      let(:duplicate_and_invalid_responses) do
        create(:user, email: 'taken@example.com')
        register(email: 'taken@example.com')
        duplicate_status = response.status
        duplicate_body = response.parsed_body

        register(email: 'someone.else@example.com', token: 'not-a-real-token')

        { duplicate_status: duplicate_status, duplicate_body: duplicate_body,
          invalid_status: response.status, invalid_body: response.parsed_body }
      end

      it 'returns the same HTTP status for both' do
        expect(duplicate_and_invalid_responses[:duplicate_status]).to eq(duplicate_and_invalid_responses[:invalid_status])
      end

      it 'returns the same response body shape for both' do
        expect(duplicate_and_invalid_responses[:duplicate_body]).to eq(duplicate_and_invalid_responses[:invalid_body])
      end
    end
  end
end
