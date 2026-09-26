# frozen_string_literal: true

# Postgres sequence values (id columns) are NOT rolled back with the
# transaction, and Time.current differs on every run — so without
# normalization, re-running this export would change output on every run
# even when nothing about the payload shape actually changed, which would
# make the CI staleness check (see .github/workflows/api.yml) flag false
# drift. Every id-like and timestamp-like field is pinned to a fixed
# placeholder before writing, so only real shape changes show up in git diff.
STABLE_TIMESTAMP = "2026-01-01T00:00:00.000Z"

# #41: public_id (and any nested `*_public_id`, e.g. portfolio_json's
# session_public_id) is a DB-side gen_random_uuid() default -- a fresh
# random value every time this task runs, same underlying issue the id/_at
# normalization above already solves for sequential ids and timestamps.
STABLE_PUBLIC_ID = "00000000-0000-0000-0000-000000000001"

def normalize_fixture(value)
  case value
  when Hash
    value.each_with_object({}) do |(k, v), acc|
      key = k.to_s
      acc[k] = if v.is_a?(Integer) && (key == "id" || key.end_with?("_id"))
                 1
               elsif key.end_with?("_at") && (v.is_a?(String) || v.respond_to?(:iso8601))
                 STABLE_TIMESTAMP
               elsif v.is_a?(String) && (key == "public_id" || key.end_with?("_public_id"))
                 STABLE_PUBLIC_ID
               else
                 normalize_fixture(v)
               end
    end
  when Array
    value.map { |v| normalize_fixture(v) }
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

      # .reload -- public_id (#37) is a DB-side gen_random_uuid() default;
      # the in-memory record (and its `session` association) doesn't have it
      # without reloading, which would otherwise export a null public_id/
      # session_public_id into the committed fixture.
      portfolio = FactoryBot.create(:portfolio).reload
      portfolio.session.reload
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

      raise ActiveRecord::Rollback
    end
  end
end
