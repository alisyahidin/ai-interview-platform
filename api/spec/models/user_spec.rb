# frozen_string_literal: true

require "rails_helper"

# Proves the test harness itself works end to end (RSpec + FactoryBot +
# transactional DB access, wired via rails_helper.rb). Feature coverage
# belongs in PR2-4, not here.
RSpec.describe User, type: :model do
  it "is valid with a factory-built default" do
    expect(build(:user)).to be_valid
  end

  it "downcases email on save" do
    user = create(:user, email: "Mixed.Case@Example.com")
    expect(user.reload.email).to eq("mixed.case@example.com")
  end

  it "rejects an invalid role" do
    expect(build(:user, role: "superadmin")).not_to be_valid
  end

  # Phase 5 / #36: organization_id is a plain, application-validated
  # attribute (no belongs_to / DB FK -- see User#organization), required
  # going forward even though the underlying column is nullable at the DB
  # level.
  describe "organization_id" do
    it "is invalid without an organization_id" do
      expect(build(:user, organization_id: nil)).not_to be_valid
    end

    it "reports the presence error on organization_id" do
      user = build(:user, organization_id: nil)
      user.valid?

      expect(user.errors[:organization_id]).to be_present
    end

    it "is valid with an organization_id" do
      expect(build(:user, organization_id: 1)).to be_valid
    end

    it "exposes the referenced Organization via #organization" do
      org = Organization.create!(name: "o", scheme: "o-#{SecureRandom.hex(4)}", identifier: "o", host: "o.example.com")

      expect(build(:user, organization_id: org.id).organization).to eq(org)
    end

    it "returns nil from #organization when no organization matches" do
      user = build(:user, organization_id: -1)

      expect(user.organization).to be_nil
    end
  end
end
