# frozen_string_literal: true

module Api
  module V1
    class AuthenticationController < ApiController
      skip_before_action :require_tenant!

      # POST /api/v1/auth/login
      def authenticate
        user = User.find_by(email: params[:email].to_s.downcase)

        return json_error('Invalid email or password', :unauthorized) unless user&.authenticate(params[:password])

        return json_error('Invalid email or password', :unauthorized) unless user.role == 'admin'

        scheme = resolve_scheme
        token  = JsonWebToken.encode({ user_id: user.id, role: user.role, scheme: })

        json_response({ token:, user: { id: user.id, email: user.email, role: user.role } })
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

      private

      def resolve_scheme
        request.headers['X-Tenant-Scheme'].presence ||
          ActiveRecord::Base.connection.select_value(
            'SELECT scheme FROM organizations LIMIT 1'
          ) || 'test-corp'
      end
    end
  end
end
