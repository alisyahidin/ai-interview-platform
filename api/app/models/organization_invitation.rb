# frozen_string_literal: true

# Phase 5 / #36: schema/model foundation for invitation-token-gated
# registration. The registration flow that actually consumes this (looking
# up by token, rejecting invalid/expired/used, marking it used) is #38 --
# this model only carries the data shape and validations.
#
# `organization_id` is a plain, application-validated column, not a
# `belongs_to` -- `organizations` is a read-only, cross-schema table owned by
# rakamin-api (see Organization), so no DB-level FK is assumed here, matching
# the same pattern used by User#organization_id.
class OrganizationInvitation < ApplicationRecord
  validates :organization_id, presence: true
  validates :token, presence: true, uniqueness: true
  validates :expires_at, presence: true

  before_validation :generate_token, on: :create

  scope :unused, -> { where(used_at: nil) }
  scope :unexpired, -> { where(arel_table[:expires_at].gt(Time.current)) }
  scope :valid_for_use, -> { unused.unexpired }

  def organization
    Organization.find_by(id: organization_id)
  end

  def used?
    used_at.present?
  end

  def expired?
    expires_at.present? && expires_at <= Time.current
  end

  # Not expired and not yet consumed -- the shape #38's registration lookup
  # needs to decide whether a submitted token may be used.
  def valid_for_use?
    !used? && !expired?
  end

  def use!
    update!(used_at: Time.current)
  end

  private

  def generate_token
    self.token ||= SecureRandom.hex(32)
  end
end
