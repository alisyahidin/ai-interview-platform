# frozen_string_literal: true

require "rails_helper"

# Proves the WebMock safety net (Q10, Phase 1 grilling) actually blocks real
# outbound HTTP in the test environment, rather than trusting it silently.
RSpec.describe "test harness safety net" do
  it "blocks a real outbound HTTP request" do
    expect { Net::HTTP.get(URI("https://generativelanguage.googleapis.com/")) }
      .to raise_error(WebMock::NetConnectNotAllowedError)
  end
end
