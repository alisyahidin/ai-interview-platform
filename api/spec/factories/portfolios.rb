# frozen_string_literal: true

FactoryBot.define do
  factory :portfolio do
    association :session
    tenant_id { session.tenant_id }
    candidate_id { 1 }
    generation_status { "complete" }
    generated_at { Time.current }

    # `public_id` is a DB-generated default (`gen_random_uuid()`, #37) --
    # this Rails/adapter combination doesn't read generated column defaults
    # back via INSERT ... RETURNING, so the in-memory record needs an
    # explicit reload or specs asserting on `public_id` see `nil` (#40/#41).
    after(:create, &:reload)
  end
end
