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
end
