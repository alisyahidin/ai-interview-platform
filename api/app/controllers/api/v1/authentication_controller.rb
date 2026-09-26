# frozen_string_literal: true

module Api
  module V1
    class AuthenticationController < ApiController
      skip_before_action :require_tenant!

      # POST /api/v1/auth/login
      #
      # Both `admin` and `user` roles may authenticate here -- see
      # Auth::Authentication. The role/permission distinction is enforced at
      # each controller's `authorize_auth_token!` call site, not at login.
      def authenticate
        result = Auth::Authentication.new(email: params[:email], password: params[:password]).call

        return json_error(result.error, :unauthorized) unless result.success?

        user  = result.user
        token = JsonWebToken.encode({ user_id: user.id })

        json_response({ token:, user: { id: user.id, email: user.email, role: user.role, organization_id: user.organization_id } })
      end
    end
  end
end
