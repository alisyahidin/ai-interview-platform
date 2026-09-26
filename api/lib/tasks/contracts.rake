# frozen_string_literal: true

# Postgres sequence values (id columns) are NOT rolled back with the
# transaction, and Time.current differs on every run — so without
# normalization, re-running this export would change output on every run
# even when nothing about the payload shape actually changed, which would
# make the CI staleness check (see .github/workflows/api.yml) flag false
# drift. Every id-like and timestamp-like field is pinned to a fixed
# placeholder before writing, so only real shape changes show up in git diff.
STABLE_TIMESTAMP = "2026-01-01T00:00:00.000Z"

# A Session's invite URL is built from APP_BASE_URL and its own random invite
# token, so it differs per machine and per run. The token is pinned by the
# export that creates the Session; the host is pinned here, and the URL is
# rebuilt from the token so each row still carries a URL of its own.
STABLE_INVITE_BASE = "http://localhost:5173"

# `position` is the 1-based index of this value within its collection, and it is
# what a row's own `id` is pinned to: a constant 1 everywhere would make a
# collection fixture carry the same id on every row, which is a shape no API
# returns and which no frontend can key a list by. Foreign keys stay at 1 —
# which row one points at is not part of the shape being pinned, and numbering
# them by position would make each row claim a parent that does not exist.
def normalize_fixture(value, position = 1)
  case value
  when Hash
    invite_token = value[:invite_token] || value["invite_token"]
    value.each_with_object({}) do |(k, v), acc|
      key = k.to_s
      acc[k] = if v.is_a?(Integer) && key == "id"
                 position
               elsif v.is_a?(Integer) && key.end_with?("_id")
                 1
               elsif key.end_with?("_at") && (v.is_a?(String) || v.respond_to?(:iso8601))
                 STABLE_TIMESTAMP
               elsif key == "invite_url" && invite_token
                 "#{STABLE_INVITE_BASE}/interview/#{invite_token}"
               else
                 normalize_fixture(v)
               end
    end
  when Array
    value.each_with_index.map { |v, i| normalize_fixture(v, i + 1) }
  else
    value
  end
end

namespace :contracts do
  desc "Export representative API payloads as web/ MSW fixtures (docs/adr/0002-generated-contract-fixtures.md). Run with RAILS_ENV=test."
  task export: :environment do
    abort "contracts:export must run with RAILS_ENV=test (it uses FactoryBot and rolls back its own writes)." unless Rails.env.test?

    FactoryBot.definition_file_paths = [Rails.root.join("spec/factories")]
    FactoryBot.reload

    fake_gemini_client = Class.new do
      def generate_content(_prompt, temperature: 0.2) # rubocop:disable Lint/UnusedMethodArgument -- keyword name must match real Gemini::HttpClient#generate_content
        { "culture_narrative" => "Sample culture narrative.", "overall_narrative" => "Sample overall narrative." }
      end
    end.new

    out_dir = Rails.root.join("../web/src/mocks/fixtures/generated")
    FileUtils.mkdir_p(out_dir)
    controller = Api::V1::PortfoliosController.new

    ActiveRecord::Base.transaction do
      vacancy = FactoryBot.create(:vacancy, role_title: "Backend Engineer")
      FactoryBot.create(:vacancy_skill, vacancy: vacancy, skill_id: "ruby-on-rails", skill_label: "Ruby on Rails", expected_level: 4)
      FactoryBot.create(:vacancy_skill, vacancy: vacancy, skill_id: "system-design", skill_label: "System Design", expected_level: 3)

      portfolio = FactoryBot.create(:portfolio)
      FactoryBot.create(:portfolio_skill, portfolio: portfolio, skill_id: "ruby-on-rails", skill_label: "Ruby on Rails",
                                           ai_level: 3, ai_confidence: "medium")
      FactoryBot.create(:portfolio_skill, portfolio: portfolio, skill_id: "communication", skill_label: "Communication",
                                           is_discovered: true, ai_level: 4, ai_confidence: "high")

      portfolio_payload = normalize_fixture(controller.send(:portfolio_json, portfolio))
      File.write(out_dir.join("portfolio_show.json"), "#{JSON.pretty_generate({ data: { portfolio: portfolio_payload } })}\n")
      puts "Wrote #{out_dir.join('portfolio_show.json')}"

      report = FitGap::Engine.new(portfolio: portfolio, vacancy: vacancy, gemini_client: fake_gemini_client).call
      fitgap_payload = normalize_fixture(controller.send(:fit_gap_json, report))
      File.write(out_dir.join("fitgap_report.json"), "#{JSON.pretty_generate({ data: { report: fitgap_payload } })}\n")
      puts "Wrote #{out_dir.join('fitgap_report.json')}"

      # The sessions-index response — one Assessment's whole cohort, in the order
      # `SessionsController#index` returns it. Every state a Session can be in
      # appears, and the columns a row can honestly leave empty are empty on
      # some of them, so a web test reading this fixture cannot assert a shape
      # the API never sends.
      #
      # `created_at` is set explicitly at distinct offsets because the index
      # orders by it: left to the column default every row would share one
      # timestamp, and the returned order would be whichever one the database
      # picked rather than the one a caller can rely on. The invite token is set
      # for the same reason the ids are pinned: it is random, and it is in the
      # payload.
      sessions_controller = Api::V1::SessionsController.new
      cohort_noon = Time.utc(2026, 1, 1, 12, 0, 0)
      cohort_rows = [
        { invite_token: "fixture-awaiting-named", candidate_name: "Wati Nur", status: "pending" },
        { invite_token: "fixture-awaiting-unnamed", candidate_name: nil, status: "pending" },
        { invite_token: "fixture-live", candidate_name: "Rina Sari", status: "active", started_at: cohort_noon - 300 },
        { invite_token: "fixture-completed", candidate_name: "Doni Prasetyo", status: "ended", end_reason: "all_covered",
          started_at: cohort_noon - 172_800, ended_at: cohort_noon - 172_800 + 1110, duration_seconds: 1110 },
        { invite_token: "fixture-failed", candidate_name: "Agus Setiawan", status: "ended", end_reason: "error",
          started_at: cohort_noon - 259_200, ended_at: cohort_noon - 259_200 + 240, duration_seconds: 240 }
      ]
      cohort_assessment = FactoryBot.create(:assessment, name: "Backend Engineer")
      cohort_rows.each_with_index do |attrs, i|
        FactoryBot.create(:session, assessment: cohort_assessment, created_at: cohort_noon - (i * 3600), **attrs)
      end
      cohort = cohort_assessment.sessions.order(created_at: :desc)
      sessions_payload = normalize_fixture(cohort.map { |s| sessions_controller.send(:session_json, s) })
      File.write(out_dir.join("sessions_index.json"), "#{JSON.pretty_generate({ data: { sessions: sessions_payload } })}\n")
      puts "Wrote #{out_dir.join('sessions_index.json')}"

      raise ActiveRecord::Rollback
    end
  end
end
