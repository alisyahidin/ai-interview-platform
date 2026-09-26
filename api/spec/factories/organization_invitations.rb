# frozen_string_literal: true

FactoryBot.define do
  factory :organization_invitation do
    organization_id { 1 }
    expires_at { 7.days.from_now }

    trait :expired do
      expires_at { 1.day.ago }
    end

    trait :used do
      used_at { 1.hour.ago }
    end
  end
end
