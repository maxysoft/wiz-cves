# Architecture

This document describes the internal structure of the Wiz CVE Scraper and how the pieces fit together at runtime.

## Overview

The project is a Node.js application with two entry points:

| Entry point | Purpose |
|---|---|
| `src/app.js` | CLI application (Commander-based) |
| `src/api.js` | REST API server (Express-based) |

Both share the same core building blocks: a configuration module, the `WizCVEScraper` class, a helpers library, and a logger.

```
src/
├── app.js                 CLI – Commander, orchestrates scrape / analytics / validate / resume
├── api.js                 REST API – Express, wraps the scraper for HTTP access
├── config/
│   └── index.js           Centralised env-driven configuration + user-agent rotation
├── scraper/
│   └── WizCVEScraper.js   Core scraping engine (Algolia API + circuit breaker)
└── utils/
    ├── helpers.js         File I/O, data transforms, analytics, validation
    └── logger.js          Winston-based structured logger
```

---

## Configuration (`src/config/index.js`)

All runtime options are controlled via environment variables, parsed once at startup and exposed as a single `config` object throughout the app.

Key sections:

| Section | Key settings |
|---|---|
| `algolia` | Base URL, API key, application ID, hits per page, max pages, timeout |
| `scraping` | Delay between requests, retry attempts, circuit-breaker thresholds, concurrency |
| `output` | Output directory, filename prefix, checkpoint interval |
| `api` | HTTP port and host |
| `logging` | Level, log-file path |
| `dataTransform` | Include/exclude description, affected software, max description length |
| `browser` | `userAgents` list (populated from `USER_AGENTS` env var) |

The module also exports a `getRandomUserAgent()` function used by the scraper to rotate user-agents on every request.

See [configuration.md](./configuration.md) for the full list of environment variables.

---

## Scraper (`src/scraper/WizCVEScraper.js`)

The scraper talks to the Wiz CVE database through the **Algolia API** (not a headless browser). Each request is an `axios.post` to `https://hdr4182jve-dsn.algolia.net/1/indexes/*/queries`.

### Two scraping strategies

| Strategy | When used | Description |
|---|---|---|
| Standard | `useComprehensiveScraping: false` | Pages through the global result set |
| Comprehensive | `useComprehensiveScraping: true` (default) | Issues parallel requests filtered by ~100+ technology facets, then deduplicates results |

The comprehensive strategy overcomes the Algolia 1 000-hit-per-index limit by issuing separate queries for every technology filter and merging the results with deduplication.

### Circuit breaker

A simple three-state (CLOSED → OPEN → HALF_OPEN) circuit breaker prevents cascade failures when the upstream API is degraded:

- Opens after `circuitBreakerThreshold` consecutive failures (default 5).
- Transitions to HALF_OPEN after `circuitBreakerTimeout` ms (default 60 s).
- Closes again on the first successful request in HALF_OPEN state.

### Retry / back-off

Every Algolia call is wrapped in a retry loop (`retryAttempts`, default 5) with exponential back-off (1 s, 2 s, 4 s, …) plus random jitter capped at 30 s.

### User-agent rotation

`getRandomUserAgent()` is called once per `makeAlgoliaRequest` invocation and its result is set as the HTTP `User-Agent` header. The list of candidate strings is parsed from the `USER_AGENTS` environment variable at startup.

---

## Helpers (`src/utils/helpers.js`)

Stateless utility functions used by both the CLI and the API:

| Function | Description |
|---|---|
| `sleep(ms)` | Promise-based delay |
| `retryWithBackoff(fn, max, delay)` | Generic retry with exponential back-off |
| `saveToJson(name, data, dir, timestamped)` | Atomically write a JSON file (optional timestamped subfolder) |
| `loadFromJson(filePath)` | Read and parse a JSON file |
| `saveCheckpoint(data, count)` | Write a checkpoint file to the checkpoints directory |
| `loadLatestCheckpoint()` | Load the most recent checkpoint |
| `validateCVEData(cve)` | Joi-based schema validation for a single CVE object |
| `generateAnalytics(cveData)` | Aggregate severity / score / technology statistics |
| `extractBaseUrls(cveData)` | Pull unique base URLs from all `additionalResources` |
| `cleanText(str)` | Normalise whitespace in scraped strings |
| `saveToTextFile(text, name, dir, timestamped)` | Write a plain-text file |

---

## CLI (`src/app.js`)

Built with [Commander](https://github.com/tj/commander.js). Available sub-commands:

| Command | Description |
|---|---|
| `scrape` | Run a full scrape (supports `--delay`, `--retry`, `--max-cves`, `--output`, `--resume`) |
| `analytics <file>` | Generate analytics from a previously saved JSON file |
| `validate <file>` | Check the structure of a JSON data file |
| `resume` | Show checkpoint info and optionally continue a previous run |

Graceful shutdown (`SIGTERM` / `SIGINT`) saves a checkpoint and partial results before exit.

---

## REST API (`src/api.js`)

Built with Express 5. See [api.md](./api.md) for the full endpoint reference.

Key design decisions:

- **Scraping runs in the background** – `POST /api/scrape` returns a job ID immediately; the actual work happens asynchronously.
- **Single active job** – only one scraping job can run at a time (returns 409 if a second is attempted).
- **Cron scheduling** – `POST /api/schedule` stores a `node-cron` task and starts it immediately; scheduled tasks are skipped if a job is already running.

---

## Data flow

```
             ┌──────────────────────────────────────────────────┐
             │              Runtime entry points                 │
             │                                                   │
             │   CLI (app.js)            REST API (api.js)       │
             └──────────┬────────────────────────┬──────────────┘
                        │                        │
                        ▼                        ▼
                 WizCVEScraper.scrapeAllCVEs()
                        │
          ┌─────────────┴────────────────┐
          │                              │
          ▼                              ▼
 loadCVEsStandard()          loadCVEsComprehensive()
          │                              │
          └─────────────┬────────────────┘
                        │
                        ▼
          makeAlgoliaRequest()  ←─ rotating User-Agent header
                        │
                        ▼
           Algolia API (axios.post)
                        │
                        ▼
          transformAlgoliaHit()  → normalised CVE object
                        │
                        ▼
    helpers: saveToJson / saveCheckpoint / generateAnalytics
```
