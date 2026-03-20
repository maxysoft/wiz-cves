# Configuration Reference

All configuration is driven by environment variables.  Copy `.env.example` to `.env` and edit it before starting the application.

```bash
cp .env.example .env
```

---

## Scraping

| Variable | Default | Description |
|---|---|---|
| `DELAY_BETWEEN_REQUESTS` | `2000` | Milliseconds to wait between consecutive Algolia API calls |
| `RETRY_ATTEMPTS` | `5` | Maximum number of retries per API request |
| `MAX_CONCURRENT_REQUESTS` | `3` | Maximum parallel Algolia requests (comprehensive mode) |
| `REQUEST_POOL_TIMEOUT` | `120000` | Timeout (ms) for the parallel request pool |
| `CIRCUIT_BREAKER_THRESHOLD` | `5` | Consecutive failures before the circuit opens |
| `CIRCUIT_BREAKER_TIMEOUT` | `60000` | Time (ms) the circuit stays open before testing again |
| `MAX_CVES` | *(unlimited)* | Cap the total number of CVEs to fetch |
| `TARGET_URL` | `https://www.wiz.io/vulnerability-database/cve/search` | Target URL (informational; scraping is API-based) |

---

## Algolia API

| Variable | Default | Description |
|---|---|---|
| `ALGOLIA_API_KEY` | *(public read key)* | Algolia search-only API key |
| `ALGOLIA_APPLICATION_ID` | `HDR4182JVE` | Algolia application ID |
| `HITS_PER_PAGE` | `20` | Number of CVEs returned per Algolia page |
| `MAX_PAGES` | `100` | Maximum number of pages to fetch per query |
| `API_TIMEOUT` | `60000` | HTTP timeout (ms) for each Algolia request |

---

## User-Agent rotation

The scraper sets a `User-Agent` HTTP header on every outbound request, picking one agent at random from the configured list on each call.

| Variable | Default | Description |
|---|---|---|
| `USER_AGENTS` | *(built-in list of 5 agents)* | Comma-separated list of user-agent strings. One is chosen at random per request. |
| `USER_AGENT` | *(none)* | Single user-agent string. Used as a one-element list when `USER_AGENTS` is not set. |

**Precedence**: `USER_AGENTS` > `USER_AGENT` > built-in default list.

**Example**

```dotenv
USER_AGENTS=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36,Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36
```

---

## Output

| Variable | Default | Description |
|---|---|---|
| `OUTPUT_DIR` | `./output` | Directory where JSON results are written |
| `OUTPUT_FILENAME` | `cve_data` | Base filename (timestamp is appended automatically) |
| `SAVE_CHECKPOINTS` | `true` | Write checkpoint files during a scrape |
| `CHECKPOINT_INTERVAL` | `100` | Save a checkpoint every N processed CVEs |

---

## API server

| Variable | Default | Description |
|---|---|---|
| `API_PORT` | `3000` | TCP port the Express server listens on |
| `API_HOST` | `localhost` | Bind address (use `0.0.0.0` inside Docker) |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origin allow-list |

---

## Logging

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | Winston log level: `error` \| `warn` \| `info` \| `debug` |
| `LOG_FILE` | `./logs/scraper.log` | Path of the log file (combined) |
| `NODE_ENV` | *(unset)* | Set to `production` to suppress verbose error details in API responses |

---

## Data transformation

| Variable | Default | Description |
|---|---|---|
| `INCLUDE_DESCRIPTION` | `true` | Include the CVE description field in output |
| `INCLUDE_AFFECTED_SOFTWARE` | `true` | Include affected-software list in output |
| `INCLUDE_AFFECTED_TECHNOLOGIES` | `true` | Include affected-technologies list in output |
| `MAX_DESCRIPTION_LENGTH` | `1000` | Truncate descriptions longer than this many characters |
