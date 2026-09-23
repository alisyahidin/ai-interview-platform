# The Product
Please refer to https://github.com/rakamindev/ai-interview-platform/wiki for initial product specification

# The Platform

A two-service application used for the Product Engineer case study. It is provided as a single repository so the whole thing clones, runs, and releases as one unit.

```
.
├── api/    # Backend service (Ruby on Rails, PostgreSQL, Redis/Sidekiq)
└── web/    # Frontend web app (React 18 + TypeScript, Vite, Tailwind)
```

The two services run together: the web app talks to the API over REST and WebSocket.

## Running it locally

**0. Bootstrap once per machine** (works the same on macOS, Linux, or CI):

```bash
# Language runtimes (Ruby + Node + pnpm), pinned in mise.toml
curl https://mise.run | sh   # skip if you already have mise
mise install

# Stateful infra (Postgres + Redis) — disposable, reset anytime with `docker compose down -v`
docker compose up -d
```

Then follow each service's own setup guide. Run the API first, then the web app pointed at it.

1. **API** — see [`api/README.md`](api/README.md). Rails app against the Postgres/Redis containers above. It serves on `http://localhost:3001`.
2. **Web** — see [`web/README.md`](web/README.md). Vite app; `pnpm install`, copy `.env.example` to `.env`, point `VITE_API_BASE_URL` at the API, then `pnpm dev`. It serves on `http://localhost:5173`.

## Notes for the case study

- This is the codebase you assess, harden, and release. Treat it as a version about to ship to a client.
- Work in the `/assessment` folder at the repo root for your written deliverables; code changes go in `api/` or `web/`.
- See the case-study brief you were given for what to produce and how it is evaluated.
