# frozen_string_literal: true

require "rails_helper"
require "ostruct"

# Ticket #5 (F2, part of #4): Portfolio gets a real tenant_id + TenantScoped,
# so Portfolio.find/find_by is automatically tenant-scoped everywhere -- no
# controller call site has to remember it individually.
#
# AC48: tenant B requesting tenant A's portfolio via show/export/fitgap/
#       regenerate_fitgap/show_fitgap gets a 404, no portfolio data leaks,
#       and no write happens.
# AC49: tenant A requesting its own portfolio keeps its pre-existing 200/202
#       response shape (regression guard).
#
# NB: Sidekiq::Testing.fake! jobs are cleared before every example (see
# spec/support/sidekiq.rb), so "no job enqueued" is simply asserting the
# jobs array is still empty after the request under test.
RSpec.describe "Api::V1::Portfolios", type: :request do
  let(:tenant_a) { create_tenant }
  let(:tenant_b) { create_tenant }
  let(:headers_a) { auth_headers_for(tenant_a) }
  let(:headers_b) { auth_headers_for(tenant_b) }
  let(:world) { build_world }

  def build_world
    assessment_a = create(:assessment, tenant_id: tenant_a.id)
    session_a    = create(:session, tenant_id: tenant_a.id, assessment: assessment_a)
    portfolio_a  = create(:portfolio, session: session_a)
    skill_a      = create(:portfolio_skill, portfolio: portfolio_a)
    vacancy_a    = create(:vacancy, tenant_id: tenant_a.id)

    skill_comparisons = [{ "skill_id" => skill_a.skill_id, "result" => "match" }]
    fit_gap_report_a = FitGapReport.create!(
      portfolio:          portfolio_a,
      vacancy:            vacancy_a,
      skill_comparisons:  skill_comparisons,
      culture_narrative:  "Good culture fit.",
      overall_narrative:  "Strong overall match."
    ).tap(&:reload) # generated_at has a DB-side default (now())

    OpenStruct.new(
      session_a: session_a, portfolio_a: portfolio_a, skill_a: skill_a, vacancy_a: vacancy_a,
      skill_comparisons: skill_comparisons, fit_gap_report_a: fit_gap_report_a
    )
  end

  def expected_portfolio_json(portfolio)
    {
      "id"                => portfolio.id,
      "session_id"        => portfolio.session_id,
      "candidate_id"      => portfolio.candidate_id,
      "generation_status" => portfolio.generation_status,
      "generated_at"      => portfolio.generated_at&.iso8601(3),
      "generation_error"  => portfolio.generation_error,
      "skills"            => portfolio.portfolio_skills.map { |skill| expected_skill_json(skill) },
      "overrides"         => []
    }
  end

  def expected_skill_json(skill)
    {
      "id"                 => skill.id,
      "skill_id"           => skill.skill_id,
      "skill_label"        => skill.skill_label,
      "is_discovered"      => skill.is_discovered,
      "ai_level"           => skill.ai_level,
      "ai_confidence"      => skill.ai_confidence,
      "evidence"           => skill.evidence_quotes,
      "competency_summary" => skill.competency_summary
    }
  end

  def expected_fit_gap_json(report)
    {
      "id"                => report.id,
      "portfolio_id"      => report.portfolio_id,
      "vacancy_id"        => report.vacancy_id,
      "skill_comparisons" => report.skill_comparisons,
      "culture_narrative" => report.culture_narrative,
      "overall_narrative" => report.overall_narrative,
      "generated_at"      => report.generated_at&.iso8601(3)
    }
  end

  describe "GET /api/v1/sessions/:id/portfolio (show)" do
    context "when requested by the owning tenant" do
      before { get "/api/v1/sessions/#{world.session_a.id}/portfolio", headers: headers_a }

      it "returns 200 (AC49)" do
        expect(response).to have_http_status(:ok)
      end

      it "returns the existing portfolio payload shape (AC49)" do
        expect(response.parsed_body["portfolio"]).to eq(expected_portfolio_json(world.portfolio_a.reload))
      end
    end

    context "when requested by another tenant" do
      before { get "/api/v1/sessions/#{world.session_a.id}/portfolio", headers: headers_b }

      it "returns 404 (AC48)" do
        expect(response).to have_http_status(:not_found)
      end

      it "leaks no portfolio data (AC48)" do
        expect(response.parsed_body).not_to have_key("portfolio")
      end
    end
  end

  describe "GET /api/v1/portfolios/:id/export" do
    context "when requested by the owning tenant" do
      before { get "/api/v1/portfolios/#{world.portfolio_a.id}/export", headers: headers_a }

      it "returns 200 (AC49)" do
        expect(response).to have_http_status(:ok)
      end

      it "returns the existing portfolio payload shape (AC49)" do
        expect(response.parsed_body["portfolio"]).to eq(expected_portfolio_json(world.portfolio_a.reload))
      end
    end

    context "when requested by another tenant" do
      before { get "/api/v1/portfolios/#{world.portfolio_a.id}/export", headers: headers_b }

      it "returns 404 (AC48)" do
        expect(response).to have_http_status(:not_found)
      end

      it "leaks no portfolio data (AC48)" do
        expect(response.parsed_body).not_to have_key("portfolio")
      end
    end
  end

  describe "POST /api/v1/portfolios/:id/fitgap" do
    context "when requested by the owning tenant" do
      before do
        post "/api/v1/portfolios/#{world.portfolio_a.id}/fitgap",
             params: { vacancy_id: world.vacancy_a.id }, headers: headers_a
      end

      it "returns 200 (AC49)" do
        expect(response).to have_http_status(:ok)
      end

      it "returns the existing cached fit/gap report payload shape (AC49)" do
        expect(response.parsed_body["report"]).to eq(expected_fit_gap_json(world.fit_gap_report_a))
      end
    end

    context "when requested by another tenant" do
      before do
        post "/api/v1/portfolios/#{world.portfolio_a.id}/fitgap",
             params: { vacancy_id: world.vacancy_a.id }, headers: headers_b
      end

      it "returns 404 (AC48)" do
        expect(response).to have_http_status(:not_found)
      end

      it "leaks no report data (AC48)" do
        expect(response.parsed_body).not_to have_key("report")
      end

      it "enqueues no job (AC48)" do
        expect(FitGapGeneratorWorker.jobs).to be_empty
      end
    end
  end

  describe "POST /api/v1/portfolios/:id/regenerate_fitgap" do
    context "when requested by the owning tenant" do
      before do
        post "/api/v1/portfolios/#{world.portfolio_a.id}/regenerate_fitgap",
             params: { vacancy_id: world.vacancy_a.id }, headers: headers_a
      end

      it "returns 202 (AC49)" do
        expect(response).to have_http_status(:accepted)
      end

      it "returns the existing queued-regeneration payload shape (AC49)" do
        expect(response.parsed_body).to eq(
          { "status" => "generating", "message" => "Fit/gap report regeneration queued" }
        )
      end

      it "queues a regeneration job" do
        expect(FitGapGeneratorWorker.jobs.size).to eq(1)
      end
    end

    context "when requested by another tenant" do
      before do
        post "/api/v1/portfolios/#{world.portfolio_a.id}/regenerate_fitgap",
             params: { vacancy_id: world.vacancy_a.id }, headers: headers_b
      end

      it "returns 404 (AC48)" do
        expect(response).to have_http_status(:not_found)
      end

      it "destroys no fit/gap report (AC48)" do
        expect(FitGapReport.exists?(world.fit_gap_report_a.id)).to be true
      end

      it "enqueues no job (AC48)" do
        expect(FitGapGeneratorWorker.jobs).to be_empty
      end
    end
  end

  describe "GET /api/v1/portfolios/:id/fitgap/:vacancy_id (show_fitgap)" do
    context "when requested by the owning tenant" do
      before { get "/api/v1/portfolios/#{world.portfolio_a.id}/fitgap/#{world.vacancy_a.id}", headers: headers_a }

      it "returns 200 (AC49)" do
        expect(response).to have_http_status(:ok)
      end

      it "returns the existing fit/gap report payload shape (AC49)" do
        expect(response.parsed_body["report"]).to eq(expected_fit_gap_json(world.fit_gap_report_a))
      end
    end

    context "when requested by another tenant" do
      before { get "/api/v1/portfolios/#{world.portfolio_a.id}/fitgap/#{world.vacancy_a.id}", headers: headers_b }

      it "returns 404 (AC48)" do
        expect(response).to have_http_status(:not_found)
      end

      it "leaks no report data (AC48)" do
        expect(response.parsed_body).not_to have_key("report")
      end
    end
  end
end
