# frozen_string_literal: true

require "rails_helper"

# Issue #40 (Phase 5 #7, parent #35/F30/D11): vacancies are addressed by
# `public_id` end to end. Sequential `id` must never appear in a vacancy
# response body, and a request using the old sequential id -- where a route
# used to accept one -- must 404, not silently coerce or fall back.
RSpec.describe "Api::V1::Vacancies", type: :request do
  let(:tenant)  { create_tenant }
  let(:headers) { auth_headers_for(tenant) }
  let(:vacancy) { create(:vacancy, tenant_id: tenant.id) }

  describe "GET /api/v1/vacancies" do
    before do
      vacancy
      get "/api/v1/vacancies", headers: headers
    end

    it "returns 200" do
      expect(response).to have_http_status(:ok)
    end

    it "keys each vacancy on public_id" do
      expect(response.parsed_body["vacancies"].first["public_id"]).to eq(vacancy.public_id)
    end

    it "never includes the sequential id" do
      expect(response.parsed_body["vacancies"].first).not_to have_key("id")
    end
  end

  describe "GET /api/v1/vacancies/:public_id" do
    before { get "/api/v1/vacancies/#{vacancy.public_id}", headers: headers }

    it "returns 200" do
      expect(response).to have_http_status(:ok)
    end

    it "keys the response on public_id" do
      expect(response.parsed_body["vacancy"]["public_id"]).to eq(vacancy.public_id)
    end

    it "never includes the sequential id" do
      expect(response.parsed_body["vacancy"]).not_to have_key("id")
    end
  end

  describe "GET /api/v1/vacancies/:id using the old sequential id" do
    before { get "/api/v1/vacancies/#{vacancy.id}", headers: headers }

    it "returns 404, not a fallback lookup" do
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "PUT /api/v1/vacancies/:public_id" do
    before do
      put "/api/v1/vacancies/#{vacancy.public_id}",
          params: { vacancy: { role_title: "Senior Backend Engineer" } },
          headers: headers
    end

    it "returns 200" do
      expect(response).to have_http_status(:ok)
    end

    it "keys the response on public_id" do
      expect(response.parsed_body["vacancy"]["public_id"]).to eq(vacancy.public_id)
    end
  end

  describe "PUT /api/v1/vacancies/:id using the old sequential id" do
    before do
      put "/api/v1/vacancies/#{vacancy.id}",
          params: { vacancy: { role_title: "Senior Backend Engineer" } },
          headers: headers
    end

    it "returns 404" do
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "DELETE /api/v1/vacancies/:id using the old sequential id" do
    before { delete "/api/v1/vacancies/#{vacancy.id}", headers: headers }

    it "returns 404" do
      expect(response).to have_http_status(:not_found)
    end

    it "leaves the record intact" do
      expect(Vacancy.exists?(vacancy.id)).to be true
    end
  end

  describe "DELETE /api/v1/vacancies/:public_id" do
    before { delete "/api/v1/vacancies/#{vacancy.public_id}", headers: headers }

    it "returns 200" do
      expect(response).to have_http_status(:ok)
    end

    it "destroys the record" do
      expect(Vacancy.exists?(vacancy.id)).to be false
    end
  end

  describe "POST /api/v1/vacancies" do
    before do
      post "/api/v1/vacancies",
           params: { vacancy: { role_title: "New role" } },
           headers: headers
    end

    it "returns 201" do
      expect(response).to have_http_status(:created)
    end

    it "keys the response on a present public_id" do
      expect(response.parsed_body["vacancy"]["public_id"]).to be_present
    end

    it "never includes the sequential id" do
      expect(response.parsed_body["vacancy"]).not_to have_key("id")
    end
  end
end
