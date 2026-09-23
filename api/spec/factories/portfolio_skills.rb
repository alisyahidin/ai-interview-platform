# frozen_string_literal: true

FactoryBot.define do
  factory :portfolio_skill do
    association :portfolio
    sequence(:skill_id) { |n| "skill-#{n}" }
    skill_label { "Ruby on Rails" }
    is_discovered { false }
    ai_level { 3 }
    ai_confidence { "medium" }
    evidence { ["Discussed background job design under load."] }
    competency_summary { "Solid working knowledge, some gaps under scale." }
  end
end
