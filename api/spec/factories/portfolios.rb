# frozen_string_literal: true

FactoryBot.define do
  factory :portfolio do
    association :session
    # portfolios.tenant_id landed as a concurrent, out-of-band migration
    # (ticket #5, applied directly to this shared DB) that isn't in this
    # branch's db/migrate yet -- the live column is NOT NULL with no
    # default. Denormalize it from the associated session here (same
    # source #5's own model-level change will use) so any spec creating a
    # :portfolio keeps working regardless of merge order.
    tenant_id { session.tenant_id }
    candidate_id { 1 }
    generation_status { "complete" }
    generated_at { Time.current }
  end
end
