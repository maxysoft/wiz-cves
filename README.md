# Wiz CVE Scraper

A production-grade Node.js tool that extracts CVE data from the [Wiz vulnerability database](https://www.wiz.io/vulnerability-database/cve/search) via the Algolia API.  It provides both a **CLI** and a **REST API**, with checkpointing, analytics generation, and per-request user-agent rotation.

## Features

- Algolia API-based scraping (no headless browser required)
- Comprehensive mode: parallel queries across 100+ technology facets with deduplication
- Circuit breaker + exponential back-off retry
- Configurable user-agent rotation (`USER_AGENTS` env var)
- Checkpoint / resume support
- REST API with cron scheduling
- Analytics generation
- Production-ready Docker setup

## Quick start

### Without Docker

```bash
npm install --legacy-peer-deps
cp .env.example .env
node src/api.js          # REST API on http://localhost:3000
# or
node src/app.js scrape   # CLI scrape
```

### With Docker

```bash
cp .env.example .env
docker compose up --build -d
curl http://localhost:3000/health
```

## Documentation

Detailed documentation lives in the [`docs/`](./docs/) folder:

| Document | Description |
|---|---|
| [docs/architecture.md](./docs/architecture.md) | Code structure, data flow, scraping strategies |
| [docs/api.md](./docs/api.md) | Full REST API endpoint reference |
| [docs/configuration.md](./docs/configuration.md) | All environment variables |
| [docs/docker.md](./docs/docker.md) | Dockerfile, Compose, production notes |
| [docs/development.md](./docs/development.md) | Local setup, testing, contributing |

## Testing

```bash
npm test        # run all 177 tests
npm run lint    # ESLint check
```

## License

MIT
