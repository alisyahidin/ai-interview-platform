# frozen_string_literal: true

require "rails_helper"

# Phase 5 / #36: schema/model-only coverage. The registration flow that
# actually consumes an invitation (#38) is out of scope here.
RSpec.describe OrganizationInvitation, type: :model do
  it "is valid with a factory-built default" do
    expect(build(:organization_invitation)).to be_valid
  end

  it "requires an organization_id" do
    expect(build(:organization_invitation, organization_id: nil)).not_to be_valid
  end

  it "requires an expires_at" do
    expect(build(:organization_invitation, expires_at: nil)).not_to be_valid
  end

  it "generates a token automatically on create" do
    invitation = create(:organization_invitation, token: nil)

    expect(invitation.token).to be_present
  end

  it "does not overwrite an explicitly assigned token" do
    invitation = create(:organization_invitation, token: "explicit-token-value")

    expect(invitation.token).to eq("explicit-token-value")
  end

  it "rejects a duplicate token" do
    create(:organization_invitation, token: "dupe-token")

    expect(build(:organization_invitation, token: "dupe-token")).not_to be_valid
  end

  describe "#organization" do
    let(:org) { Organization.create!(name: "o", scheme: "o-#{SecureRandom.hex(4)}", identifier: "o", host: "o.example.com") }

    it "exposes the referenced Organization" do
      invitation = build(:organization_invitation, organization_id: org.id)

      expect(invitation.organization).to eq(org)
    end
  end

  describe "#used? / #expired? / #valid_for_use?" do
    context "with a fresh, unused, unexpired invitation" do
      subject(:invitation) { build(:organization_invitation) }

      it { is_expected.not_to be_used }
      it { is_expected.not_to be_expired }
      it { is_expected.to be_valid_for_use }
    end

    context "when past expires_at" do
      subject(:invitation) { build(:organization_invitation, :expired) }

      it { is_expected.to be_expired }
      it { is_expected.not_to be_valid_for_use }
    end

    context "when used_at is set" do
      subject(:invitation) { build(:organization_invitation, :used) }

      it { is_expected.to be_used }
      it { is_expected.not_to be_valid_for_use }
    end
  end

  describe "#use!" do
    it "sets used_at, marking the invitation as consumed" do
      invitation = create(:organization_invitation)

      expect { invitation.use! }.to change { invitation.reload.used_at }.from(nil)
    end

    it "flips used? to true" do
      invitation = create(:organization_invitation)
      invitation.use!

      expect(invitation).to be_used
    end
  end

  describe "scopes" do
    it ".unused includes an unused invitation" do
      unused = create(:organization_invitation)

      expect(described_class.unused).to include(unused)
    end

    it ".unused excludes a used invitation" do
      used = create(:organization_invitation, :used)

      expect(described_class.unused).not_to include(used)
    end

    it ".unexpired includes a fresh invitation" do
      fresh = create(:organization_invitation)

      expect(described_class.unexpired).to include(fresh)
    end

    it ".unexpired excludes an expired invitation" do
      expired = create(:organization_invitation, :expired)

      expect(described_class.unexpired).not_to include(expired)
    end

    it ".valid_for_use includes a fresh, unused, unexpired invitation" do
      valid = create(:organization_invitation)

      expect(described_class.valid_for_use).to include(valid)
    end

    it ".valid_for_use excludes a used invitation" do
      used = create(:organization_invitation, :used)

      expect(described_class.valid_for_use).not_to include(used)
    end

    it ".valid_for_use excludes an expired invitation" do
      expired = create(:organization_invitation, :expired)

      expect(described_class.valid_for_use).not_to include(expired)
    end
  end
end
