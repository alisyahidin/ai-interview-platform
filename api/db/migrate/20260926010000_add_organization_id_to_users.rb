# frozen_string_literal: true

# Phase 5 / #36: gives `users` an `organization_id` so tenancy can be a
# modeled fact on the account itself (read at request time from the user's
# own record) instead of an unverified JWT/header/Referer claim.
#
# `organizations` is a read-only, cross-schema table owned by the sibling
# `rakamin-api` service (see app/models/organization.rb) -- this app doesn't
# manage its migrations or ordering, so `organization_id` is deliberately a
# plain column with application-level validation only (see User#organization
# and its presence/existence validations). No DB-level foreign key is added.
#
# The column is added nullable at the DB level (existing rows are backfilled
# below, but nothing here promises every *future* row is written through a
# path that sets it before the DB sees it) -- required-ness going forward is
# enforced by User's `validates :organization_id, presence: true`.
class AddOrganizationIdToUsers < ActiveRecord::Migration[7.0]
  def up
    add_column :users, :organization_id, :bigint
    add_index :users, :organization_id

    backfill_organization_id
  end

  def down
    remove_index :users, :organization_id
    remove_column :users, :organization_id
  end

  private

  # Every existing `users` row is backfilled to the sole/first organization
  # present in the dataset, per the ticket's intent: don't leave existing
  # accounts orphaned by a newly-added required-going-forward field. This is
  # a single-tenant dev/test dataset today (verified: exactly one row in
  # `organizations` in both the dev and test databases at the time this
  # migration was written), so "first by id" and "the sole org" coincide;
  # if a given environment somehow has more than one, the lowest id is used
  # as the least-surprising default rather than raising mid-migration.
  def backfill_organization_id
    org_id = select_value("SELECT id FROM organizations ORDER BY id ASC LIMIT 1")
    return if org_id.nil?

    execute <<~SQL.squish
      UPDATE users SET organization_id = #{org_id} WHERE organization_id IS NULL
    SQL
  end
end
