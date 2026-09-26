# frozen_string_literal: true

class Session < ApplicationRecord
  include TenantScoped
  include HasPublicId

  STATUSES   = %w[pending active ended failed].freeze
  END_REASONS = %w[manual_candidate manual_assessor all_covered time_ceiling error].freeze

  belongs_to :assessment
  has_many :transcript_turns, dependent: :destroy
  has_many :coverage_maps, dependent: :destroy
  has_one  :portfolio, dependent: :destroy

  validates :invite_token, presence: true, uniqueness: true
  validates :status, inclusion: { in: STATUSES }
  validates :end_reason, inclusion: { in: END_REASONS }, allow_nil: true

  before_validation :generate_invite_token, on: :create

  scope :active,  -> { where(status: 'active') }
  scope :pending, -> { where(status: 'pending') }
  scope :ended,   -> { where(status: 'ended') }

  def active?  = status == 'active'
  def ended?   = status == 'ended'
  def pending? = status == 'pending'

  # The terminal "failed" state re-invite (#29) cares about: the session ended
  # because of a platform/system error rather than a normal candidate/assessor
  # close or a natural finish. NOTE: STATUSES includes a 'failed' value, but
  # nothing in this codebase ever transitions status into it -- errors are
  # recorded as status: 'ended', end_reason: 'error' (see Sessions::EndHandler).
  def failed? = ended? && end_reason == 'error'

  def invite_url
    base = ENV.fetch('APP_BASE_URL', 'http://localhost:3001')
    "#{base}/interview/#{invite_token}"
  end

  private

  def generate_invite_token
    self.invite_token ||= SecureRandom.hex(32)
  end
end
