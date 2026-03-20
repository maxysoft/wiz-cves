# Configuration Reference

All configuration is controlled through environment variables.  Copy `.env.example` to `.env` and edit as needed.

---

## Database

| Variable | Default | Description |
|---|---|---|
| `DATABASE_PATH` | `data/cve_scraper.db` | Path to the SQLite database file (relative to project root or absolute). The parent directory is created automatically. |

---

## Scheduling

| Variable | Default | Description |
|---|---|---|
| `SCRAPER_CRON` | *(empty)* | Standard cron expression for automatic scraping. Leave empty to disable auto-scheduling. Examples: `"0 */6 * * *"` (every 6 h), `"0 2 * * *"` (daily at 02:00). |
| `MIN_INTERVAL_HOURS` | `1` | Minimum number of hours that must elapse between scrape runs. The hard lower bound is **1 hour** — values below 1 are silently raised to 1. This applies to both API-triggered and cron-triggered runs. |

---

## Scraping

| Variable | Default | Description |
|---|---|---|
| `DELAY_BETWEEN_REQUESTS` | `2000` | Milliseconds to wait between Algolia API requests (normal mode). |
| `RETRY_ATTEMPTS` | `5` | Maximum number of retry attempts per failed request. |
| `MAX_CONCURRENT_REQUESTS` | `3` | Maximum number of parallel Algolia queries (comprehensive mode). |
| `CIRCUIT_BREAKER_THRESHOLD` | `5` | Consecutive failures before the circuit breaker opens. |
| `CIRCUIT_BREAKER_TIMEOUT` | `60000` | Milliseconds before the circuit breaker moves to HALF_OPEN. |
| `MAX_CVES` | *(unlimited)* | Stop scraping after this many CVEs. |
| `API_TIMEOUT` | `60000` | HTTP request timeout in milliseconds. |

### Gentle mode

Gentle mode is designed to scrape all CVEs while placing minimal load on the remote API.  It disables parallel processing and uses longer inter-request delays.

| Variable | Default | Description |
|---|---|---|
| `GENTLE_MODE` | `false` | Set to `true` to enable gentle mode. Also available via the `--gentle` CLI flag. |
| `GENTLE_DELAY_MS` | `5000` | Milliseconds between requests in gentle mode. |
| `GENTLE_HITS_PER_PAGE` | `10` | Number of results per API page in gentle mode. |

---

## Output / Checkpoints

| Variable | Default | Description |
|---|---|---|
| `SAVE_CHECKPOINTS` | `true` | Persist checkpoints to the database after each batch. Set to `false` to disable. |
| `CHECKPOINT_INTERVAL` | `100` | Save a checkpoint every N processed CVEs. |

---

## API Server

| Variable | Default | Description |
|---|---|---|
| `API_PORT` | `3000` | TCP port the REST API listens on. |
| `API_HOST` | `localhost` | Hostname or IP address to bind to. Use `0.0.0.0` in Docker. |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated list of allowed CORS origins. |

---

## Logging

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | Winston log level (`error`, `warn`, `info`, `debug`, `silly`). |
| `LOG_FILE` | `./logs/scraper.log` | Path to the combined log file. |

---

## Algolia API

These values are pre-configured for the Wiz CVE database and should not normally need changing.

| Variable | Default | Description |
|---|---|---|
| `ALGOLIA_API_KEY` | *(built-in)* | Algolia search-only API key. |
| `ALGOLIA_APPLICATION_ID` | *(built-in)* | Algolia application ID. |
| `HITS_PER_PAGE` | `20` | Results per Algolia API page. |
| `MAX_PAGES` | `100` | Maximum number of pages to fetch (standard mode). |
| `TARGET_URL` | `https://www.wiz.io/...` | Wiz CVE database URL (used for HTML resource extraction). |

---

## User-agent rotation

| Variable | Description |
|---|---|
| `USER_AGENTS` | Comma-separated list of user-agent strings.  One is chosen at random per outbound request. |
| `USER_AGENT` | Single fallback user-agent string (used only when `USER_AGENTS` is not set). |

If neither variable is set, a built-in list of five browser user-agents is used.

---

## Data transformation

| Variable | Default | Description |
|---|---|---|
| `INCLUDE_DESCRIPTION` | `true` | Include the CVE description field. |
| `INCLUDE_AFFECTED_SOFTWARE` | `true` | Include affected software data. |
| `INCLUDE_AFFECTED_TECHNOLOGIES` | `true` | Include affected technologies data. |
| `MAX_DESCRIPTION_LENGTH` | `1000` | Truncate descriptions longer than this. |
