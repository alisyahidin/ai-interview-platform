# frozen_string_literal: true

class ApplicationController < ActionController::API
  include Response
  include ExceptionHandler

  before_action :require_tenant!

  # Declarative auth helper — mirrors rakamin-api's authorize_auth_token! pattern.
  # Usage:
  #   authorize_auth_token! :admin
  #   authorize_auth_token! :assessor      # allows admin or assessor
  #   authorize_auth_token! :any           # any authenticated user
  #
  # `prepend: true` so this runs *before* the `require_tenant!` before_action
  # declared below (inherited from this class, so it would otherwise always
  # run first) — tenant is now resolved from the freshly-loaded User record
  # inside `authenticate_with_roles!`, so authentication must happen first.
  def self.authorize_auth_token!(*roles, **options)
    before_action(options.merge(prepend: true)) { authenticate_with_roles!(roles) }
  end

  private

  # ── Tenant ──────────────────────────────────────────────────────────────────

  # Raises TenantNotFound if tenant resolution failed (i.e. the authenticated
  # user has no valid organization). Override in controllers that don't
  # require a tenant (e.g. health check, login, candidate invite-token routes).
  def require_tenant!
    return if tenant_resolved?

    raise ExceptionHandler::TenantNotFound, Message.tenant_not_found
  end

  def tenant_resolved?
    RequestStore.store.key?(:organization) && Current.organization.present?
  rescue StandardError
    false
  end

  def current_tenant_id
    Current.tenant_id
  end

  def current_organization
    Current.organization
  rescue StandardError
    nil
  end

  # ── Auth ────────────────────────────────────────────────────────────────────

  def current_user
    Current.user
  rescue StandardError
    nil
  end

  def authenticate_with_roles!(roles)
    roles = roles.flatten.map(&:to_s)
    result = AuthorizeApiRequest.new(request.headers, roles).call
    Current.user = result[:user]

    resolve_tenant_from_user!
  end

  # Tenant comes from the just-loaded User record, not from the JWT's
  # (removed) `scheme` claim, the `X-Tenant-Scheme` header, or the Referer
  # host. Overwrites whatever TenantResolverMiddleware may have already set
  # from those other sources for this request.
  def resolve_tenant_from_user!
    organization = Current.user&.organization

    Current.organization = organization
    Current.tenant_id    = organization&.id
  end

  # ── Params ──────────────────────────────────────────────────────────────────

  def query_params
    @query_params ||= request.query_parameters.with_indifferent_access
  end

  def path_params
    @path_params ||= request.path_parameters
                             .except(:controller, :action)
                             .with_indifferent_access
  end

  def request_body
    @request_body ||= request.request_parameters.with_indifferent_access
  end

  def paginate(scope)
    page     = (query_params[:page] || 1).to_i
    per_page = [(query_params[:per_page] || 20).to_i, 100].min
    scope.page(page).per(per_page)
  end
end
