# frozen_string_literal: true

# Issue #37 (Phase 5 #6, F30/D11): additive, non-enumerable `public_id`
# (UUID) on the four resource types an assessor's browser ever addresses
# directly -- sessions, portfolios, assessments, vacancies. Existing bigint
# primary keys and every foreign key relationship are completely untouched;
# this is schema-only groundwork for #40/#41, which will switch routes and
# response bodies over to `public_id` in a later ticket.
#
# `gen_random_uuid()` (pgcrypto, already enabled -- see
# 20240101000000_create_ai_interview_schema.rb) is a VOLATILE function, so
# PostgreSQL cannot apply the "no rewrite, resolve lazily" fast path it uses
# for a constant/IMMUTABLE/STABLE default. Adding a volatile-default column
# forces Postgres to rewrite the table immediately and evaluate the default
# once per existing row -- so `add_column ... null: false, default: ->
# { "gen_random_uuid()" }` backfills every pre-existing row with its own
# distinct UUID in the same statement, with no separate UPDATE needed. This
# was verified manually against a seeded copy of rakamin_test (PostgreSQL
# 16.2): pre-existing rows in all four tables ended up with distinct,
# non-null public_id values immediately after `up`, with no explicit
# backfill step required.
class AddPublicIdToSessionsPortfoliosAssessmentsVacancies < ActiveRecord::Migration[7.0]
  TABLES = %i[sessions portfolios assessments vacancies].freeze

  def up
    TABLES.each do |table|
      add_column table, :public_id, :uuid, null: false, default: -> { "gen_random_uuid()" }
      add_index table, :public_id, unique: true
    end
  end

  def down
    TABLES.each do |table|
      remove_index table, :public_id
      remove_column table, :public_id
    end
  end
end
