# frozen_string_literal: true

require "rails_helper"

# Ticket #5 (F2, part of #4): Portfolio now includes TenantScoped, so
# Portfolio.find/find_by are automatically tenant-scoped via default_scope
# everywhere in the app -- not just the 4 controller call sites the request
# specs (spec/requests/api/v1/portfolios_spec.rb) exercise over HTTP.
RSpec.describe Portfolio, type: :model do
  let(:tenant_a) { Organization.create!(name: "a", scheme: "a-#{SecureRandom.hex(4)}", identifier: "a", host: "a.example.com") }
  let(:tenant_b) { Organization.create!(name: "b", scheme: "b-#{SecureRandom.hex(4)}", identifier: "b", host: "b.example.com") }

  let(:session_a) { create(:session, tenant_id: tenant_a.id) }
  let!(:portfolio_a) { create(:portfolio, session: session_a) }

  it "denormalizes tenant_id from the owning session by default" do
    expect(portfolio_a.tenant_id).to eq(tenant_a.id)
  end

  # assign_tenant_id only falls back to Current.tenant_id when the key is
  # entirely absent from the store; setting it to nil here lets the
  # presence validation -- not the fallback's own "please set Current..."
  # guard -- be what actually fires.
  #
  # NB: `errors[:tenant_id]` (message-building) isn't usable here -- a
  # pre-existing quirk where Portfolio#model_name (PR2/#6) shadows
  # ActiveModel::Naming's instance-level `model_name`, which
  # ActiveModel::Error#generate_message calls to build `%{model}`. `added?`
  # checks the error's (attribute, type) directly and never builds a
  # message, so it isn't affected.
  it "requires tenant_id" do
    portfolio = build(:portfolio, session: session_a, tenant_id: nil)
    Current.using(tenant_id: nil) { portfolio.valid? }
    expect(portfolio.errors.added?(:tenant_id, :blank)).to be true
  end

  describe "default_scope" do
    it "hides other tenants' portfolios from .find" do
      Current.using(tenant_id: tenant_b.id) do
        expect { described_class.find(portfolio_a.id) }.to raise_error(ActiveRecord::RecordNotFound)
      end
    end

    it "hides other tenants' portfolios from .find_by" do
      Current.using(tenant_id: tenant_b.id) do
        expect(described_class.find_by(id: portfolio_a.id)).to be_nil
      end
    end

    it "still resolves the portfolio under its own tenant via .find" do
      Current.using(tenant_id: tenant_a.id) do
        expect(described_class.find(portfolio_a.id)).to eq(portfolio_a)
      end
    end

    it "still resolves the portfolio under its own tenant via .find_by" do
      Current.using(tenant_id: tenant_a.id) do
        expect(described_class.find_by(id: portfolio_a.id)).to eq(portfolio_a)
      end
    end

    it "does not scope when no tenant is set (non-request contexts)" do
      expect(described_class.find(portfolio_a.id)).to eq(portfolio_a)
    end
  end
end
