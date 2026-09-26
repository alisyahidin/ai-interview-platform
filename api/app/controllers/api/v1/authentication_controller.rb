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
        result = Auth::Authentication.call(email: params[:email], password: params[:password])

        return json_error(result.error, :unauthorized) unless result.success?

        user  = result.user
        token = JsonWebToken.encode({ user_id: user.id })

        json_response({ token:, user: { id: user.id, email: user.email, role: user.role, organization_id: user.organization_id } })
      end

      # POST /api/v1/auth/register
      #
      # #38: creates an account from an invitation token. Does not log the
      # new user in -- on success the frontend sends them to the login page
      # separately, matching the login page's "who this is for" framing
      # rather than blurring registration and login into one endpoint.
      #
      # Any `role` the caller submits is ignored entirely -- see
      # Auth::Registration, which never reads it.
      def register
        result = Auth::Registration.call(
          email:            params[:email],
          password:         params[:password],
          invitation_token: params[:invitation_token]
        )

        return json_error(result.error, :unprocessable_entity) unless result.success?

        json_response({ message: 'Registration successful. You can now log in.' }, :created)
      end
    end
  end
end
