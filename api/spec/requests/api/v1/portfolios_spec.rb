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
      "failure_code"      => portfolio.failure_code,
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
      "competency_summary" => skill.competency_summary,
      "assessment_status"  => skill.assessment_status,
      "status_reason"      => skill.status_reason
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

  # #22 (Phase 3b #1): the frontend can't tell "not assessed" from "weak"
  # from "uncertain" until assessment_status/status_reason/failure_code/
  # is_override/original_level are actually in the response -- these
  # columns have existed since PR2 (#11) but were never exposed. These
  # specs prove each new key round-trips through the real endpoints with
  # the right value, on top of the pre-existing eq()-based shape guards
  # above (which now also cover the new keys via the expected_*_json
  # helpers).
  describe "GET /api/v1/sessions/:id/portfolio -- portfolio-skill assessment fields (#22)" do
    before do
      tenant     = create_tenant
      headers    = auth_headers_for(tenant)
      assessment = create(:assessment, tenant_id: tenant.id)
      session    = create(:session, tenant_id: tenant.id, assessment: assessment)
      portfolio  = create(:portfolio, session: session)

      create(:portfolio_skill, portfolio: portfolio, skill_label: "Assessed Skill")
      create(:portfolio_skill, :not_assessed, portfolio: portfolio, skill_label: "Not Assessed Skill")
      create(:portfolio_skill, :needs_review, portfolio: portfolio, skill_label: "Needs Review Skill")
      create(:portfolio_skill, :not_assessed, portfolio: portfolio,
             skill_label: "Invalid Output Skill", status_reason: "invalid_model_output")

      get "/api/v1/sessions/#{session.id}/portfolio", headers: headers
    end

    def skill_json_for(label)
      response.parsed_body["portfolio"]["skills"].find { |s| s["skill_label"] == label }
    end

    it "exposes assessment_status/status_reason for a normally-assessed skill" do
      expect(skill_json_for("Assessed Skill")).to include(
        "assessment_status" => "assessed", "status_reason" => nil
      )
    end

    it "exposes assessment_status/status_reason for a not-assessed (omitted_by_model) skill" do
      expect(skill_json_for("Not Assessed Skill")).to include(
        "assessment_status" => "not_assessed", "status_reason" => "omitted_by_model"
      )
    end

    it "exposes assessment_status/status_reason for a needs-review skill" do
      expect(skill_json_for("Needs Review Skill")).to include(
        "assessment_status" => "needs_review", "status_reason" => nil
      )
    end

    it "exposes status_reason invalid_model_output for a not-assessed skill flagged that way" do
      expect(skill_json_for("Invalid Output Skill")).to include(
        "assessment_status" => "not_assessed", "status_reason" => "invalid_model_output"
      )
    end
  end

  describe "GET /api/v1/sessions/:id/portfolio -- portfolio failure_code (#22)" do
    def session_for(tenant)
      assessment = create(:assessment, tenant_id: tenant.id)
      create(:session, tenant_id: tenant.id, assessment: assessment)
    end

    %w[upstream_error invalid_output timeout unknown].each do |code|
      context "when generation failed with failure_code=#{code}" do
        before do
          tenant  = create_tenant
          headers = auth_headers_for(tenant)
          session = session_for(tenant)
          create(:portfolio, session: session, generation_status: "failed",
                 generation_error: "boom", failure_code: code)

          get "/api/v1/sessions/#{session.id}/portfolio", headers: headers
        end

        it "returns the failure_code in the portfolio payload" do
          expect(response.parsed_body["portfolio"]).to include("failure_code" => code)
        end

        it "still returns the generation_error alongside it" do
          expect(response.parsed_body["error"]).to eq("boom")
        end
      end
    end

    context "when generation succeeded (regression guard: failure_code stays nil)" do
      before do
        tenant  = create_tenant
        headers = auth_headers_for(tenant)
        session = session_for(tenant)
        create(:portfolio, session: session)

        get "/api/v1/sessions/#{session.id}/portfolio", headers: headers
      end

      it "returns a nil failure_code" do
        expect(response.parsed_body["portfolio"]).to include("failure_code" => nil)
      end
    end
  end

  describe "GET /api/v1/portfolios/:id/fitgap/:vacancy_id -- fit/gap row override/assessment fields (#22)" do
    before do
      tenant  = create_tenant
      headers = auth_headers_for(tenant)
      gemini_client = instance_double(Gemini::HttpClient,
                                       generate_content: { "culture_narrative" => "c", "overall_narrative" => "o" })

      assessment = create(:assessment, tenant_id: tenant.id)
      session    = create(:session, tenant_id: tenant.id, assessment: assessment)
      portfolio  = create(:portfolio, session: session)
      vacancy    = create(:vacancy, tenant_id: tenant.id)

      overridden_skill = create(:portfolio_skill, portfolio: portfolio, skill_label: "Overridden Skill",
                                                   skill_id: "ov-1", ai_level: 3)
      create(:assessor_override, portfolio_skill: overridden_skill, override_level: 5)
      create(:portfolio_skill, :not_assessed, portfolio: portfolio, skill_label: "Not Assessed Skill", skill_id: "na-1")
      create(:portfolio_skill, :needs_review, portfolio: portfolio,
             skill_label: "Needs Review Skill", skill_id: "nr-1", ai_level: 4)
      create(:portfolio_skill, portfolio: portfolio, skill_label: "Plain Skill", skill_id: "pl-1", ai_level: 3)

      create(:vacancy_skill, vacancy: vacancy, skill_label: "Overridden Skill", skill_id: "ov-1", expected_level: 3)
      create(:vacancy_skill, vacancy: vacancy, skill_label: "Not Assessed Skill", skill_id: "na-1", expected_level: 4)
      create(:vacancy_skill, vacancy: vacancy, skill_label: "Needs Review Skill", skill_id: "nr-1", expected_level: 3)
      create(:vacancy_skill, vacancy: vacancy, skill_label: "Plain Skill", skill_id: "pl-1", expected_level: 3)

      FitGap::Engine.new(portfolio: portfolio, vacancy: vacancy, gemini_client: gemini_client).call

      get "/api/v1/portfolios/#{portfolio.id}/fitgap/#{vacancy.id}", headers: headers
    end

    def row_for(label)
      response.parsed_body["report"]["skill_comparisons"].find { |c| c["skill_label"] == label }
    end

    it "flags an overridden skill with is_override true and the pre-override original_level" do
      expect(row_for("Overridden Skill")).to include(
        "is_override" => true, "original_level" => 3, "assessment_status" => "assessed",
        "candidate_level" => 5, "result" => "exceed"
      )
    end

    it "reports assessment_status not_assessed with no override for an unmeasured skill" do
      expect(row_for("Not Assessed Skill")).to include(
        "is_override" => false, "original_level" => nil, "assessment_status" => "not_assessed"
      )
    end

    it "reports assessment_status needs_review with no override for a disputed skill" do
      expect(row_for("Needs Review Skill")).to include(
        "is_override" => false, "original_level" => nil, "assessment_status" => "needs_review"
      )
    end

    it "reports assessment_status assessed with no override for a normal skill" do
      expect(row_for("Plain Skill")).to include(
        "is_override" => false, "original_level" => nil, "assessment_status" => "assessed",
        "result" => "match"
      )
    end
  end
end
