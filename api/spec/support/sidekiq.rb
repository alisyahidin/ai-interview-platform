# frozen_string_literal: true

require "sidekiq/testing"

# Fake mode: `perform_async` appends to an in-memory array instead of
# round-tripping through real Redis. This lets specs assert "no background
# job was enqueued" (e.g. a rejected cross-tenant request) deterministically.
Sidekiq::Testing.fake!

RSpec.configure do |config|
  config.before do
    Sidekiq::Worker.clear_all
  end
end
