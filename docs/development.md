# Development Guide

This document covers everything you need to get the project running locally, run tests, and contribute changes.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 24.0.0 (see `.nvmrc`) |
| npm | ≥ 10 |

Use [nvm](https://github.com/nvm-sh/nvm) to manage Node versions:

```bash
nvm install   # reads .nvmrc
nvm use
```

---

## Local setup

```bash
# Install dependencies
npm install --legacy-peer-deps

# Copy the example env file
cp .env.example .env
# Edit .env as needed (all defaults work for local development)

# Create runtime directories (created automatically by the API, but useful to have up front)
mkdir -p output logs checkpoints
```

---

## Running the application

### REST API server

```bash
npm run api
# or
node src/api.js
```

The server starts on `http://localhost:3000`.

```bash
# Confirm it is running
curl http://localhost:3000/health
```

### CLI scraper

```bash
# Full scrape (uses Algolia API, no browser needed)
node src/app.js scrape

# Limit to 100 CVEs for a quick test
node src/app.js scrape --max-cves 100

# Generate analytics from existing data
node src/app.js analytics output/<file>.json

# Validate a data file
node src/app.js validate output/<file>.json

# Show checkpoint info
node src/app.js resume
```

---

## Testing

```bash
# Run all tests
npm test

# Watch mode (re-runs on file change)
npm run test:watch

# Run a single test file
npx jest tests/docker.test.js --verbose
```

### Test structure

| File | What it covers |
|---|---|
| `tests/api.test.js` | Express HTTP endpoints (supertest, all deps mocked) |
| `tests/config.test.js` | Config module / env-var mapping |
| `tests/helpers.test.js` | Helper utilities (file I/O mocked with fs-extra mock) |
| `tests/scraper.unit.test.js` | `WizCVEScraper` unit tests (axios mocked) |
| `tests/scraper.test.js` | Additional scraper / helper integration tests |
| `tests/docker.test.js` | Dockerfile + docker-compose.yml validation, user-agent rotation |

Global test helpers (`createMockCVE`, `createTempDir`, etc.) are defined in `tests/setup.js` and are available in every test file via `setupFilesAfterEnv`.

### Writing new tests

- Mock `axios` with `jest.mock('axios')` **before** requiring any module that depends on it.
- Mock `fs-extra` for file-system operations.
- Call `jest.resetModules()` in `beforeEach` when testing code that reads `process.env` at module load time (e.g. `src/config/index.js`).
- Use `global.createTempDir()` / `global.cleanupTempDir()` for tests that need a real temporary directory.

---

## Linting

```bash
npm run lint
```

The project uses [ESLint 10 flat config](https://eslint.org/docs/latest/use/configure/configuration-files-new) (`eslint.config.js`) with the `n` (Node.js) and `promise` plugins.

---

## Output format

Scraped data is written to `output/` as JSON:

```json
{
  "scrapeDate": "2025-01-07T10:30:00.000Z",
  "totalCVEs": 1500,
  "cveData": [
    {
      "cveId": "CVE-2025-0001",
      "severity": "HIGH",
      "score": 8.8,
      "technologies": ["Linux", "Apache"],
      "component": "httpd",
      "publishedDate": "Jan 05, 2025",
      "detailUrl": "https://www.wiz.io/vulnerability-database/cve/CVE-2025-0001",
      "additionalResources": [
        { "title": "NVD Reference", "url": "https://nvd.nist.gov/vuln/detail/CVE-2025-0001" }
      ]
    }
  ]
}
```

Analytics files (`*_analytics.json`) are also generated alongside the data file.

---

## Project structure

```
wiz-cves/
├── src/
│   ├── app.js                  CLI entry point
│   ├── api.js                  REST API entry point
│   ├── config/
│   │   └── index.js            Env-driven config + getRandomUserAgent()
│   ├── scraper/
│   │   └── WizCVEScraper.js    Core Algolia-based scraping engine
│   └── utils/
│       ├── helpers.js          File I/O, analytics, validation helpers
│       └── logger.js           Winston logger
├── tests/
│   ├── setup.js                Jest globals and mock helpers
│   ├── api.test.js
│   ├── config.test.js
│   ├── helpers.test.js
│   ├── scraper.test.js
│   ├── scraper.unit.test.js
│   └── docker.test.js          Docker + user-agent rotation tests
├── docs/                       Detailed documentation
│   ├── architecture.md
│   ├── api.md
│   ├── configuration.md
│   ├── docker.md
│   └── development.md          (this file)
├── output/                     Generated JSON files (git-ignored)
├── logs/                       Winston log files (git-ignored)
├── checkpoints/                Scraping checkpoints (git-ignored)
├── Dockerfile                  Production multi-stage build
├── docker-compose.yml          Single-service compose file
├── .env.example                Template for .env
├── eslint.config.js            ESLint flat config
├── jest.config.js              Jest configuration
└── package.json
```

---

## Contributing

1. Fork the repository and create a feature branch:
   ```bash
   git checkout -b feature/my-feature
   ```
2. Make your changes and add tests.
3. Run the full test suite and linter:
   ```bash
   npm test && npm run lint
   ```
4. Commit and push:
   ```bash
   git commit -m "feat: describe the change"
   git push origin feature/my-feature
   ```
5. Open a pull request.

---

## Disclaimer

This tool is for educational and research purposes only. Respect the target website's terms of service and use appropriate delays to avoid overloading the server.
