# API Reference

The REST API server (`src/api.js`) is started with:

```bash
node src/api.js
# or
npm run api
```

Default base URL: `http://localhost:3000`

---

## Health check

### `GET /health`

Liveness probe. Always returns 200 while the server is up.

**Response**

```json
{
  "status": "healthy",
  "timestamp": "2025-01-07T10:00:00.000Z",
  "version": "1.0.0",
  "uptime": 42.7
}
```

---

## Status

### `GET /api/status`

Returns the current state of the scraping engine and configured schedules.

**Response**

```json
{
  "isScrapingInProgress": false,
  "currentJob": null,
  "scheduledJobs": ["daily_scrape"],
  "config": {
    "maxConcurrency": 3,
    "delayBetweenRequests": 2000,
    "targetUrl": "https://www.wiz.io/vulnerability-database/cve/search"
  }
}
```

---

## Scraping

### `POST /api/scrape`

Start a new scraping job in the background. Returns immediately with a job ID.

**Request body** (all fields optional)

```json
{
  "maxConcurrency": 3,
  "delayBetweenRequests": 2000,
  "retryAttempts": 5,
  "maxCVEs": 500,
  "outputFilename": "cve_data"
}
```

**Response `200`**

```json
{
  "message": "Scraping operation started",
  "jobId": "scrape_1736247600000",
  "options": { "..." }
}
```

**Response `409`** – a job is already running

```json
{
  "error": "Scraping operation already in progress",
  "currentJob": { "id": "scrape_...", "status": "running" }
}
```

---

### `GET /api/scrape/:jobId`

Poll the status of a running or completed job.

**Response `200`**

```json
{
  "id": "scrape_1736247600000",
  "startTime": "2025-01-07T10:00:00.000Z",
  "status": "completed",
  "endTime": "2025-01-07T10:45:00.000Z",
  "result": {
    "totalCVEs": 1500,
    "outputPath": "/app/output/scrape_2025-01-07/cve_data_2025-01-07T10-45-00.json"
  }
}
```

Possible `status` values: `starting` | `running` | `completed` | `failed` | `stopped`

---

### `POST /api/scrape/stop`

Stop the currently running scraping job.

**Response `200`**

```json
{
  "message": "Scraping operation stopped",
  "jobId": "scrape_1736247600000"
}
```

**Response `400`** – no job running

---

## Scheduling

### `POST /api/schedule`

Register a cron-based recurring scrape.

**Request body**

```json
{
  "name": "daily_scrape",
  "cronExpression": "0 2 * * *",
  "options": {
    "maxConcurrency": 2,
    "outputFilename": "daily_cve_data"
  }
}
```

**Response `200`**

```json
{
  "message": "Scraping scheduled successfully",
  "scheduleId": "daily_scrape",
  "cronExpression": "0 2 * * *"
}
```

**Response `400`** – invalid cron expression  
**Response `409`** – a schedule with this name already exists

---

### `GET /api/schedules`

List all registered schedules.

**Response**

```json
{
  "schedules": [
    {
      "id": "daily_scrape",
      "cronExpression": "0 2 * * *",
      "createdAt": "2025-01-07T08:00:00.000Z"
    }
  ]
}
```

---

### `DELETE /api/schedule/:scheduleId`

Remove a registered schedule.

**Response `200`**

```json
{
  "message": "Schedule deleted successfully",
  "scheduleId": "daily_scrape"
}
```

**Response `404`** – schedule not found

---

## Analytics

### `POST /api/analytics`

Generate statistics from a saved data file or an inline payload.

**Request body – file path**

```json
{ "filePath": "/app/output/cve_data_latest.json" }
```

**Request body – inline data**

```json
{
  "data": {
    "cveData": [ { "cveId": "CVE-2025-0001", "severity": "HIGH", "score": 8.5 } ]
  }
}
```

**Response `200`**

```json
{
  "generatedAt": "2025-01-07T11:00:00.000Z",
  "analytics": {
    "total": 1500,
    "averageScore": "7.20",
    "severityDistribution": { "CRITICAL": 45, "HIGH": 312, "MEDIUM": 890, "LOW": 253 },
    "scoreDistribution": { "0-3": 180, "3-7": 720, "7-9": 480, "9-10": 120 },
    "topTechnologies": { "Linux": 456, "Windows": 234 },
    "topComponents": { "kernel": 123, "openssl": 89 },
    "withAdditionalResources": 1245
  }
}
```

---

## Files

### `GET /api/files`

List JSON output files available for download.

**Response**

```json
{
  "files": [
    {
      "name": "cve_data_2025-01-07T10-45-00.json",
      "path": "/output/cve_data_2025-01-07T10-45-00.json",
      "size": 2048576,
      "createdAt": "2025-01-07T10:45:00.000Z",
      "modifiedAt": "2025-01-07T10:45:00.000Z"
    }
  ]
}
```

Files are served statically at `GET /output/<filename>`.

---

## Checkpoint

### `GET /api/checkpoint`

Return metadata about the most recently saved checkpoint.

**Response `200`**

```json
{
  "checkpoint": {
    "timestamp": "2025-01-07T10:30:00.000Z",
    "processedCount": 800,
    "currentIndex": 800
  }
}
```

**Response `404`** – no checkpoint exists

---

## Error format

All error responses follow the same shape:

```json
{
  "error": "Human-readable error title",
  "message": "Detail (only in development mode for 500 errors)"
}
```
