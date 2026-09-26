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

  class_methods do
    def find_by_public_id!(public_id)
      find_by!(public_id: public_id)
    end
  end
end
