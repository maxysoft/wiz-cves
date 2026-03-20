# Wiz CVE Scraper

[![Built with Claude Sonnet](https://img.shields.io/badge/Built%20with-Claude%20Sonnet-6B4FBB?style=flat&logo=anthropic&logoColor=white)](https://www.anthropic.com)

A production-grade Node.js tool that extracts CVE data from the [Wiz vulnerability database](https://www.wiz.io/vulnerability-database/cve/search) via the Algolia API.  Results are persisted in a local **SQLite database** and exposed through a **REST API** and **CLI**.

## Features

- **SQLite storage** — all CVE data, checkpoints, and run history persisted in a local SQLite file (`better-sqlite3`)
- **Algolia API-based scraping** — no headless browser required
- **Comprehensive mode** — parallel queries across 100+ technology facets with deduplication
- **Gentle mode** — slower, sequential scraping to minimise load on the remote API (`--gentle` / `GENTLE_MODE=true`)
- **Cron scheduling** — define when the scraper runs using a standard cron expression (`SCRAPER_CRON` env var or `schedule` CLI command)
- **1-hour hard limiter** — prevents re-running the scraper within 1 hour of the last execution, regardless of scheduling
- **Circuit breaker + exponential back-off retry**
- **Configurable user-agent rotation** (`USER_AGENTS` env var)
- **Checkpoint / resume support** (stored in SQLite)
- **REST API** with rate-limited scheduling and CVE query endpoints
- **Analytics generation** computed from the database
- **Docker image** built automatically on every push that contains `build_image` in the commit message

## Quick start

### Without Docker

```bash
npm install --legacy-peer-deps
cp .env.example .env
node src/api.js              # REST API on http://localhost:3000
# or
node src/app.js scrape       # CLI: one-off scrape
node src/app.js schedule "0 */6 * * *"   # CLI: cron-scheduled scraping
node src/app.js scrape --gentle          # Gentle mode (reduced API load)
```

### With Docker

```bash
cp .env.example .env
docker compose up --build -d
curl http://localhost:3000/health
curl http://localhost:3000/api/cves        # Query stored CVEs
```

## CLI commands

| Command | Description |
|---|---|
| `scrape` | Run a one-off scrape and save results to the database |
| `scrape --gentle` | Scrape with longer delays and no parallelism |
| `scrape --resume` | Resume from the latest checkpoint |
| `scrape --force` | Bypass the 1-hour rate limiter |
| `schedule "<cron>"` | Run the scraper on a recurring cron schedule |
| `analytics` | Print analytics computed from the database |
| `validate` | Validate CVE records stored in the database |
| `resume` | Show the latest checkpoint details |

## Key REST API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/status` | Current scraper status |
| `POST` | `/api/scrape` | Start a scraping job |
| `POST` | `/api/scrape/stop` | Stop current job |
| `GET` | `/api/cves` | Query CVEs (supports `severity`, `search`, `limit`, `offset`) |
| `GET` | `/api/cves/:cveId` | Fetch a single CVE |
| `POST` | `/api/schedule` | Create a cron-scheduled job |
| `GET` | `/api/schedules` | List all scheduled jobs |
| `DELETE` | `/api/schedule/:id` | Remove a schedule |
| `GET` | `/api/runs` | Scrape run history |
| `POST` | `/api/analytics` | Generate analytics |
| `GET` | `/api/checkpoint` | Latest checkpoint info |

The `POST /api/scrape` endpoint enforces the 1-hour hard limiter and returns HTTP 429 when the limit has not elapsed.

## Key environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_PATH` | `data/cve_scraper.db` | Path to the SQLite file |
| `SCRAPER_CRON` | *(empty)* | Cron expression for auto-scheduling |
| `MIN_INTERVAL_HOURS` | `1` | Minimum hours between runs (hard lower bound) |
| `GENTLE_MODE` | `false` | Enable slow/sequential scraping |
| `GENTLE_DELAY_MS` | `5000` | Delay between requests in gentle mode |
| `DELAY_BETWEEN_REQUESTS` | `2000` | Delay in normal mode |
| `MAX_CONCURRENCY` | `3` | Parallel request limit |

See `.env.example` and `docs/configuration.md` for the full list.

## Documentation

| Document | Description |
|---|---|
| [docs/architecture.md](./docs/architecture.md) | Code structure, data flow, scraping strategies |
| [docs/api.md](./docs/api.md) | Full REST API endpoint reference |
| [docs/configuration.md](./docs/configuration.md) | All environment variables |
| [docs/docker.md](./docs/docker.md) | Dockerfile, Compose, production notes |
| [docs/development.md](./docs/development.md) | Local setup, testing, contributing |

## Testing

```bash
npm test        # run all 223 tests
npm run lint    # ESLint check
```

## Docker image build workflow

A GitHub Actions workflow (`.github/workflows/docker-build.yml`) builds and pushes a Docker image to the GitHub Container Registry (GHCR) whenever a commit message contains the string `build_image`.  Two tags are applied:

- `ghcr.io/<owner>/<repo>:latest`
- `ghcr.io/<owner>/<repo>:<short-sha>`

## License

MIT
