# frozen_string_literal: true

FactoryBot.define do
  factory :coverage_map do
    association :session
    sequence(:skill_id) { |n| "skill-#{n}" }
    skill_label { "Ruby on Rails" }
    is_discovered { false }
    state { "not_yet" }
  end
end
