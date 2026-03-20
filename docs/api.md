# REST API Reference

The CVE Scraper exposes a REST API (`src/api.js`, default port 3000).

All responses use `Content-Type: application/json`.

---

## Health

### `GET /health`

Returns the current health status of the service.

**Response 200**
```json
{
  "status": "healthy",
  "timestamp": "2025-06-01T12:00:00.000Z",
  "version": "1.0.0",
  "uptime": 12345.67
}
```

---

## Status

### `GET /api/status`

Returns scraper state and active configuration.

**Response 200**
```json
{
  "isScrapingInProgress": false,
  "currentJob": null,
  "scheduledJobs": ["auto", "hourly"],
  "config": {
    "maxConcurrency": 3,
    "delayBetweenRequests": 2000,
    "targetUrl": "https://www.wiz.io/vulnerability-database/cve/search",
    "gentleMode": false
  }
}
```

---

## Scraping

### `POST /api/scrape`

Start a scraping job in the background.  Results are saved to the SQLite database.

A **1-hour hard limiter** is enforced: if the last execution occurred less than 1 hour ago the request is rejected with HTTP 429.

**Request body** (all fields optional)
```json
{
  "maxConcurrency": 3,
  "delayBetweenRequests": 2000,
  "retryAttempts": 5,
  "maxCVEs": 500,
  "gentleMode": false,
  "useComprehensiveScraping": true
}
```

**Response 200**
```json
{ "message": "Scraping operation started", "jobId": "scrape_1234567890" }
```

**Response 409** — scrape already in progress  
**Response 429** — rate limited
```json
{ "error": "Rate limited: ...", "minutesRemaining": 42 }
```

---

### `GET /api/scrape/:jobId`

Get status of a specific job.

**Response 200**
```json
{
  "id": "scrape_1234567890",
  "startTime": "2025-06-01T12:00:00.000Z",
  "status": "completed",
  "endTime": "2025-06-01T12:05:00.000Z",
  "result": { "totalCVEs": 4200 }
}
```

**Response 404** — job not found

---

### `POST /api/scrape/stop`

Stop the currently running scraping job.

**Response 200** / **Response 400** (nothing running)

---

## CVE Data

### `GET /api/cves`

Query CVEs stored in the database.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `severity` | string | Filter by severity (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) |
| `search` | string | Substring search on `cveId`, `component`, `description` |
| `limit` | number | Max results (default: 100) |
| `offset` | number | Pagination offset (default: 0) |

**Response 200**
```json
{
  "total": 4200,
  "count": 100,
  "cves": [ { "cveId": "CVE-2025-0001", "severity": "HIGH", ... } ]
}
```

---

### `GET /api/cves/:cveId`

Fetch a single CVE by its ID.

**Response 200** / **Response 404**

---

## Scheduling

### `POST /api/schedule`

Create a cron-scheduled scraping job.  The hard 1-hour limiter is also enforced when the scheduled job fires.

**Request body**
```json
{
  "cronExpression": "0 */6 * * *",
  "name": "every-6h",
  "options": { "gentleMode": false }
}
```

**Response 200** / **Response 400** (invalid cron) / **Response 409** (name exists)

---

### `GET /api/schedules`

List all active schedules.

**Response 200**
```json
{
  "schedules": [
    { "id": "every-6h", "cronExpression": "0 */6 * * *", "createdAt": "..." }
  ]
}
```

---

### `DELETE /api/schedule/:scheduleId`

Remove an active schedule.

**Response 200** / **Response 404**

---

## Runs

### `GET /api/runs`

Return the history of scrape runs stored in the database.

**Query parameters**

| Parameter | Default | Description |
|---|---|---|
| `limit` | 20 | Maximum number of runs to return |

**Response 200**
```json
{
  "runs": [
    {
      "id": 1,
      "jobId": "cli_1234567890",
      "startedAt": "2025-06-01T12:00:00.000Z",
      "completedAt": "2025-06-01T12:05:00.000Z",
      "status": "completed",
      "totalCves": 4200
    }
  ]
}
```

---

## Analytics

### `POST /api/analytics`

Generate analytics.  When no body is provided, analytics are computed from all CVEs in the database.

**Request body** (optional)
```json
{ "data": { "cveData": [ ... ] } }
```

**Response 200**
```json
{
  "generatedAt": "2025-06-01T12:10:00.000Z",
  "analytics": {
    "total": 4200,
    "averageScore": "7.42",
    "severityDistribution": { "HIGH": 1800, "CRITICAL": 600 },
    "topTechnologies": { "Linux": 900 }
  }
}
```

---

## Checkpoint

### `GET /api/checkpoint`

Get the latest checkpoint stored in the database.

**Response 200**
```json
{
  "checkpoint": {
    "timestamp": "2025-06-01T11:55:00.000Z",
    "processedCount": 3200,
    "currentIndex": 3200
  }
}
```

**Response 404** — no checkpoint found
