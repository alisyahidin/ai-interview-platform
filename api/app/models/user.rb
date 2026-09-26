# frozen_string_literal: true

class User < ApplicationRecord
  has_secure_password

  ROLES = %w[admin user].freeze

  validates :email, presence: true,
                    uniqueness: { case_sensitive: false },
                    format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :role, inclusion: { in: ROLES }

  # `organizations` is a read-only, cross-schema table owned by the sibling
  # rakamin-api service (see Organization) -- Rails can't manage a relational
  # `belongs_to` across that boundary the way it would for a table this app
  # owns, so `organization_id` is a plain, application-validated attribute,
  # following the same pattern already established by Current.organization /
  # TenantScoped (plain id + presence validation, no AR association).
  validates :organization_id, presence: true

  before_save :downcase_email

  # Looked up on demand rather than via `belongs_to`, matching how
  # Current.organization resolves the tenant elsewhere in this app.
  def organization
    Organization.find_by(id: organization_id)
  end

  private

  def downcase_email
    self.email = email.downcase
  end
end
