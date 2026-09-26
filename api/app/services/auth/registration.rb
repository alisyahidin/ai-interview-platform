# frozen_string_literal: true

module Auth
  # #38: registration gated by a single-use OrganizationInvitation token.
  #
  # Three distinct rejection causes -- a missing, expired, or already-used
  # invitation token, and an email that's already registered -- are
  # deliberately folded into one generic failure: same message, same status
  # (the controller maps both to the same HTTP status), and the same amount
  # of DB work regardless of which one a given call actually hits. `call`
  # always resolves the invitation *and* looks up the existing user before
  # deciding anything, so neither lookup is skipped on the other's account --
  # that's what keeps a caller from using timing or response shape to learn
  # "wrong/expired/used token" apart from "this email already has an
  # account" (account enumeration, per #35's AC5).
  #
  # Any `role` field a caller submits is never read here, anywhere -- every
  # user this service creates is hardcoded to role: "user".
  class Registration
    GENERIC_ERROR = 'Registration could not be completed. Check your invitation link, or log in if you ' \
                    'already have an account.'

    Result = Struct.new(:success?, :user, :error, keyword_init: true)

    def self.call(email:, password:, invitation_token:)
      new(email: email, password: password, invitation_token: invitation_token).call
    end

    def initialize(email:, password:, invitation_token:)
      @email = email.to_s.strip.downcase
      @password = password
      @invitation_token = invitation_token.to_s
    end

    def call
      invitation = OrganizationInvitation.find_by(token: @invitation_token)
      invitation_ok = invitation&.valid_for_use? || false
      existing_user = User.find_by(email: @email)

      return failure unless invitation_ok && existing_user.nil?

      Result.new(success?: true, user: create_user!(invitation), error: nil)
    rescue ActiveRecord::RecordInvalid
      # Any other validation failure (bad email format, blank password, ...)
      # collapses into the same generic rejection -- this service's job is
      # narrow (valid invitation + free email -> account), not field-level
      # form validation.
      failure
    end

    private

    def create_user!(invitation)
      user = nil

      ActiveRecord::Base.transaction do
        user = User.create!(
          email: @email,
          password: @password,
          role: 'user',
          organization_id: invitation.organization_id
        )
        invitation.use!
      end

      user
    end

    def failure
      Result.new(success?: false, user: nil, error: GENERIC_ERROR)
    end
  end
end
