# frozen_string_literal: true

# Phase 5 / #36: schema for invitation-token-gated registration (built out in
# #38). `organization_id` follows the same application-level-only reference
# as `users.organization_id` (see 20260926010000) -- `organizations` is a
# read-only, cross-schema table owned by `rakamin-api`, so no DB-level FK.
#
# `token` mirrors Session#invite_token's pattern (SecureRandom.hex(32),
# unique-indexed) for consistency with the codebase's existing single-use,
# unguessable-token convention. `used_at` is nullable; null means unused, and
# it's set on consumption to make the token single-use.
class CreateOrganizationInvitations < ActiveRecord::Migration[7.0]
  def change
    create_table :organization_invitations do |t|
      t.bigint   :organization_id, null: false
      t.string   :token,           null: false
      t.datetime :expires_at,      null: false
      t.datetime :used_at

      t.timestamps
    end

    add_index :organization_invitations, :token, unique: true
    add_index :organization_invitations, :organization_id
  end
end
