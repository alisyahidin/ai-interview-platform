# frozen_string_literal: true

# Extracted and simplified from rakamin-api.
# Bearer token only (no basic auth — AI interview has no whitelist-key consumers).
#
# Re-fetches the User record from the JWT's `user_id` claim on every request,
# rather than trusting the token's own claims. This is what makes a
# since-deleted user's previously-issued token stop working immediately, and
# it's why `role` (and tenant, derived from `organization_id` by the caller)
# are always read fresh from the database instead of from a claim that could
# be stale.
class AuthorizeApiRequest
  # Roles that map to "assessor" permission in the AI interview context.
  # The real, persisted User#role enum is %w[admin user] (see User::ROLES) --
  # "assessor" is prose from the strategy doc describing the role, never a
  # value actually stored in the database.
  ASSESSOR_ROLES = %w[admin user].freeze

  def initialize(headers = {}, required_roles = [])
    @headers = headers
    @required_roles = Array(required_roles)
  end

  # Returns { user: } where `user` is the freshly-loaded User record.
  # Raises ExceptionHandler::InvalidToken (401) when the token is malformed,
  # expired, or names a user that no longer exists.
  def call
    user = load_user!

    check_role!(user) if @required_roles.any?

    { user: user }
  end

  private

  attr_reader :headers

  def load_user!
    claims = decoded_auth_token
    user = User.find_by(id: claims[:user_id])

    raise(ExceptionHandler::InvalidToken, Message.invalid_token) unless user

    user
  end

  def check_role!(user)
    allowed = @required_roles.map(&:to_s)

    # :any means no role restriction
    return if allowed.include?('any')

    # Support logical grouping: :assessor_or_admin
    effective_role = user.role
    if allowed.include?('assessor')
      # Allow anyone whose role is in ASSESSOR_ROLES
      return if ASSESSOR_ROLES.include?(effective_role)
    end

    return if allowed.include?(effective_role)

    raise(ExceptionHandler::Unauthorized, Message.unauthorized)
  end

  def decoded_auth_token
    JsonWebToken.decode(http_auth_header)
  rescue ExceptionHandler::InvalidToken => e
    raise(ExceptionHandler::InvalidToken, e.message)
  end

  def http_auth_header
    return headers['Authorization'].split(' ').last if headers['Authorization'].present?

    raise(ExceptionHandler::MissingToken, Message.missing_token)
  end
end
