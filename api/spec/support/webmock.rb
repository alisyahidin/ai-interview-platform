# frozen_string_literal: true

require "webmock/rspec"

# Q10 (Phase 1 grilling): hard-block all real outbound HTTP in the test
# environment. Specs that exercise Gemini-calling code must inject a fake
# gemini_client: — that's the sanctioned pattern (see
# Portfolios::Generator.new(session:, gemini_client:)) — rather than relying
# on nobody forgetting to stub a real request.
WebMock.disable_net_connect!(allow_localhost: true)
