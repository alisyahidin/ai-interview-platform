# frozen_string_literal: true

FactoryBot.define do
  factory :vacancy do
    tenant_id { 1 }
    created_by { 1 }
    role_title { "Backend Engineer" }

    # `public_id` is a DB-generated default (`gen_random_uuid()`, #37) --
    # this Rails/adapter combination doesn't read generated column defaults
    # back via INSERT ... RETURNING, so the in-memory record needs an
    # explicit reload or specs asserting on `public_id` see `nil` (#40).
    after(:create, &:reload)
  end
end
