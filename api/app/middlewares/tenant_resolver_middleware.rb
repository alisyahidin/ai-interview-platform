# frozen_string_literal: true

# Extracted and adapted from rakamin-api.
#
# Resolves the current tenant (Organization) per request and sets:
#   Current.organization  → the Organization AR record
#   Current.tenant_id     → organization.id (used to scope all AI interview queries)
#
# Superseded for JWT-authenticated routes: as of Phase 5 #3, tenant for those
# requests is derived from the freshly-loaded User record's `organization_id`
# in ApplicationController#authenticate_with_roles! (see there), which runs
# after this middleware and overwrites whatever it sets. There is no longer a
# `scheme` JWT claim to decode — a bearer token no longer resolves a tenant
# here at all.
#
# What's left is only used by requests that never hit `authorize_auth_token!`
# (e.g. the candidate invite-token flow doesn't use Current.organization at
# all — it scopes explicitly by the session's own tenant_id instead), plus
# whatever still relies on the header/Referer fallback:
#   1. X-Tenant-Scheme request header
#   2. Referer host (fallback, same as rakamin-api HostService approach)
#
# If no tenant can be resolved, the request continues with no tenant set.
# Individual controllers can enforce tenant presence via before_action.
class TenantResolverMiddleware < ApplicationMiddleware
  def call(env)
    request = ActionDispatch::Request.new(env)

    scheme = resolve_scheme(request)
    organization = find_organization(scheme)

    if organization
      Current.organization = organization
      Current.tenant_id    = organization.id
    end

    super
  end

  private

  def resolve_scheme(request)
    request.headers['X-Tenant-Scheme'].presence ||
      scheme_from_referer(request)
  end

  def scheme_from_referer(request)
    referer = request.referer.to_s
    return if referer.blank?

    host = URI.parse(referer).host.to_s
    host.presence
  rescue URI::InvalidURIError
    nil
  end

  def find_organization(scheme)
    return if scheme.blank?

    Organization.identify(scheme)
  rescue StandardError
    nil
  end
end
