# frozen_string_literal: true

# PR2 / F2 (issue #5): gives `portfolios` its own `tenant_id`, denormalized
# from `session.tenant_id` at creation time (not derived through a join at
# read time), so `Portfolio` can `include TenantScoped` and get automatic
# tenant scoping on every query -- closing the cross-tenant read gap on the
# export/fitgap/regenerate_fitgap/show_fitgap/show actions (see issue #4).
#
# The table is already populated, so this adds the column nullable, backfills
# it from the owning session, then tightens it to NOT NULL -- all in one
# migration, per the ticket's migration note.
class AddTenantIdToPortfolios < ActiveRecord::Migration[7.0]
  def up
    add_column :portfolios, :tenant_id, :bigint

    backfill_tenant_id_from_session

    change_column_null :portfolios, :tenant_id, false
    add_index :portfolios, :tenant_id
  end

  def down
    remove_index :portfolios, :tenant_id
    remove_column :portfolios, :tenant_id
  end

  private

  def backfill_tenant_id_from_session
    execute <<~SQL.squish
      UPDATE portfolios p
      SET tenant_id = s.tenant_id
      FROM sessions s
      WHERE p.session_id = s.id
    SQL
  end
end
