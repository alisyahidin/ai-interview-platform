# frozen_string_literal: true

FactoryBot.define do
  factory :session do
    tenant_id { 1 }
    association :assessment
    candidate_id { 1 }
    candidate_name { "Test Candidate" }
    status { "ended" }
  end
end
