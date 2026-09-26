# frozen_string_literal: true

module Auth
  # Verifies email/password and hands back the authenticated User.
  #
  # Replaces the old inline `user.role == 'admin'` login gate: any user whose
  # password matches succeeds here regardless of role (`admin` or `user`) --
  # the role/permission distinction is enforced at the existing
  # `authorize_auth_token!` call sites on each controller, not at login.
  class Authentication
    Result = Struct.new(:success?, :user, :error, keyword_init: true)

    def self.call(email:, password:)
      new(email: email, password: password).call
    end

    def initialize(email:, password:)
      @email    = email.to_s.strip.downcase
      @password = password.to_s
    end

    def call
      user = User.find_by(email: @email)

      return failure unless user&.authenticate(@password)

      Result.new(success?: true, user: user, error: nil)
    end

    private

    def failure
      Result.new(success?: false, user: nil, error: 'Invalid email or password')
    end
  end
end
