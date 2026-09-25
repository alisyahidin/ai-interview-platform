# frozen_string_literal: true

FactoryBot.define do
  factory :assessment_skill do
    association :assessment
    sequence(:skill_id) { |n| "skill-#{n}" }
    skill_label { "Ruby on Rails" }
    is_custom { false }
    l1_anchor { "Executes with explicit guidance and close review." }
    l2_anchor { "Executes independently on routine scope." }
    l3_anchor { "Executes complex, ambiguous scope." }
    l4_anchor { "Defines standards and creates reusable systems." }
    l5_anchor { "Org-level authority." }
    display_order { 0 }
  end
end
