# frozen_string_literal: true

FactoryBot.define do
  factory :vacancy_skill do
    association :vacancy
    skill_id { "skill-1" }
    skill_label { "Ruby on Rails" }
    expected_level { 4 }
  end
end
