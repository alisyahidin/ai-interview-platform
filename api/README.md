# Local Setup

## Prerequisites

Run the root-level bootstrap first (see the [repo README](../README.md#running-it-locally)): `mise install` gets you the pinned Ruby, and `docker compose up -d` gets you Postgres and Redis. Nothing below assumes a system-wide Ruby, Postgres, or Redis install.

---

## 1. Environment variables

```bash
cp config/application.yml.sample config/application.yml
```

Fill in the required values in `config/application.yml`:

| Variable | Description |
|---|---|
| `SECRET_KEY_BASE` | Must match `rakamin-api` — JWT tokens are shared |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USERNAME` / `DB_PASSWORD` | Points at the `docker compose` Postgres container by default (`localhost:5432`) |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `GEMINI_LIVE_MODEL` | e.g. `gemini-3.1-flash-live-preview` (Live/bidi streaming only ships under v1beta upstream — see `Gemini::LiveClient`) |
| `GEMINI_FLASH_MODEL` | e.g. `gemini-2.5-flash` |
| `GEMINI_PRO_MODEL` | e.g. `gemini-2.5-flash` |
| `REDIS_URL` | Points at the `docker compose` Redis container by default (`redis://localhost:6379/1`) |
| `ALLOWED_ORIGINS` | CORS origin for the frontend, e.g. `http://localhost:5173` |
| `APP_BASE_URL` | **Frontend** origin, used to build invite links — e.g. `http://localhost:5173`, not this API's own origin |

---

## 2. Install dependencies

```bash
bundle install
```

---

## 3. Set up the database

```bash
rails db:create   # skip if DB already exists
rails db:migrate
rails db:seed
```

---

## 4. Start Sidekiq

```bash
bundle exec sidekiq -r ./config/environment.rb -C config/sidekiq.yml
```

---

## 5. Start the Rails server

```bash
bundle exec rails server
```

Runs on **port 3001** by default.

---

## 6. Start the frontend

```bash
cd ../web
pnpm install
pnpm dev
```

Runs on **port 5173** by default.

---

## All services at a glance

| Service | Command | Port |
|---|---|---|
| Postgres | `docker compose up -d` (from repo root) | 5432 |
| Redis | `docker compose up -d` (from repo root) | 6379 |
| Sidekiq | `bundle exec sidekiq -r ./config/environment.rb -C config/sidekiq.yml` | — |
| Rails API | `bundle exec rails server` | 3001 |
| Frontend | `pnpm dev` (in `web/`) | 5173 |

## Tests

```bash
bundle exec rspec       # unit / service / request specs
bundle exec rubocop     # lint
```

CI runs both against blank/dummy env values — no real `GEMINI_API_KEY` or other secret is needed to run the suite. Real network calls to Gemini are blocked in the test environment (WebMock); specs inject a fake Gemini client instead.
