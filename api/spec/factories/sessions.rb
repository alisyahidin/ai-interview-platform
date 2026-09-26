# frozen_string_literal: true

FactoryBot.define do
  factory :session do
    tenant_id { 1 }
    association :assessment
    candidate_id { 1 }
    candidate_name { "Test Candidate" }
    status { "ended" }

    # `public_id` is a DB-generated default (`gen_random_uuid()`, #37) --
    # this Rails/adapter combination doesn't read generated column defaults
    # back via INSERT ... RETURNING, so the in-memory record needs an
    # explicit reload or specs asserting on `public_id` see `nil` (#40/#41).
    after(:create, &:reload)
  end
end
