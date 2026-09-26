# frozen_string_literal: true

# Issue #37 (Phase 5 #6, F30/D11): shared lookup-by-`public_id` shape for the
# four resource types an assessor's browser is ever meant to address
# directly (sessions, portfolios, assessments, vacancies). The column
# itself, its uniqueness, and its `gen_random_uuid()` default all live in
# the DB (see the public_id migration) -- this concern only adds the one
# thing that isn't already free from the schema: a single, consistent way
# to look a record up by it, so #40/#41 don't each reinvent
# `find_by!(public_id: ...)` slightly differently across four controllers.
#
# Include in any model whose table has a `public_id` column:
#   class Session < ApplicationRecord
#     include HasPublicId
#   end
module HasPublicId
  extend ActiveSupport::Concern

  # A well-formed UUID, matching the column's own `gen_random_uuid()` shape.
  # Guarding on this before hitting the DB means a lookup by anything else --
  # in particular, a request built with the model's old sequential integer
  # id -- raises the same RecordNotFound a valid-but-unknown UUID would,
  # instead of a 500 (Postgres raises `PG::InvalidTextRepresentation` for a
  # non-UUID string compared against a `uuid` column, which the app's generic
  # exception handler would otherwise surface as an unhandled 500, not a 404).
  UUID_FORMAT = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i

  class_methods do
    def find_by_public_id!(public_id)
      raise ActiveRecord::RecordNotFound, "Couldn't find #{name} with public_id=#{public_id.inspect}" unless
        public_id.to_s.match?(UUID_FORMAT)

      find_by!(public_id: public_id)
    end
  end
end
