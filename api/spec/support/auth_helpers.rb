# frozen_string_literal: true

# Request-spec helper for building a real, end-to-end authenticated request:
# a genuine Organization row plus a JWT whose `scheme` claim resolves to it.
#
# TenantResolverMiddleware decodes the JWT's `scheme` claim to set
# Current.organization / Current.tenant_id for the request; AuthorizeApiRequest
# separately checks the JWT's `role` claim against the controller's required
# roles. Building both for real (rather than poking Current.tenant_id
# directly) exercises the actual resolution path tenant-isolation specs are
# meant to prove.
module AuthHelpers
  def create_tenant(scheme: "tenant-#{SecureRandom.hex(6)}")
    Organization.create!(
      name:       scheme,
      scheme:     scheme,
      identifier: scheme,
      host:       "#{scheme}.example.com"
    )
  end

  def auth_headers_for(organization, role: "assessor", user_id: 1)
    token = JsonWebToken.encode(user_id: user_id, role: role, scheme: organization.scheme)
    { "Authorization" => "Bearer #{token}" }
  end
end

RSpec.configure do |config|
  config.include AuthHelpers, type: :request
end
