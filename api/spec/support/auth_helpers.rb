# frozen_string_literal: true

# Request-spec helper for building a real, end-to-end authenticated request:
# a genuine Organization row, a genuine User row scoped to it, and a JWT
# carrying only that user's id.
#
# Phase 5 #3: tenant and role are no longer asserted by the JWT (there's no
# `scheme`/`role` claim to trust) -- AuthorizeApiRequest re-fetches the User
# from `user_id` on every request, and ApplicationController derives tenant
# from that user's own `organization_id`. Building a real User (rather than
# poking Current.tenant_id/Current.user directly) exercises the actual
# resolution path tenant-isolation specs are meant to prove.
module AuthHelpers
  def create_tenant(scheme: "tenant-#{SecureRandom.hex(6)}")
    Organization.create!(
      name:       scheme,
      scheme:     scheme,
      identifier: scheme,
      host:       "#{scheme}.example.com"
    )
  end

  def create_auth_user(organization, role: "user", email: nil)
    create(:user,
           email:           email || "user-#{SecureRandom.hex(6)}@example.com",
           role:            role,
           organization_id: organization.id)
  end

  def auth_headers_for(organization, role: "user", user: nil)
    user ||= create_auth_user(organization, role: role)
    token = JsonWebToken.encode(user_id: user.id)
    { "Authorization" => "Bearer #{token}" }
  end
end

RSpec.configure do |config|
  config.include AuthHelpers, type: :request
end
