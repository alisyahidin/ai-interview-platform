# frozen_string_literal: true

# Without this, Zeitwerk's default inflector expects
# app/channels/audio_websocket_middleware.rb to define `AudioWebsocketMiddleware`
# (lowercase s), but the file defines `AudioWebSocketMiddleware` (capital S,
# matching the WebSocket protocol's own capitalization). This mismatch is
# latent until eager loading actually walks the app/channels directory —
# which only happens where config.eager_load is true (CI sets eager_load
# via ENV["CI"], not local dev) — hence never surfacing locally.
ActiveSupport::Inflector.inflections(:en) do |inflect|
  inflect.acronym "WebSocket"
end
