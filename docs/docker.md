# Docker

This document explains how to build and run the application with Docker and Docker Compose.

---

## Quick start

```bash
# 1. Copy the example env file and edit if needed
cp .env.example .env

# 2. Build and start the API
docker compose up --build -d

# 3. Confirm the server is healthy
curl http://localhost:3000/health
```

---

## Architecture

The Docker Compose setup consists of a **single service**:

| Service | Image | Port | Role |
|---|---|---|---|
| `api` | built from `./Dockerfile` | 3000 | CVE Scraper REST API |

Scraping is done entirely via HTTP calls to the Algolia API (no headless browser required).

---

## Dockerfile

The application uses a **two-stage build** to keep the final image small and secure.

### Stage 1 – `deps` (dependency installation)

```dockerfile
FROM node:24-alpine AS deps
```

- Installs only production npm dependencies (`npm ci --omit=dev`).
- Discarded after the build; its `/app/node_modules` is copied to stage 2.

### Stage 2 – `runtime` (production image)

```dockerfile
FROM node:24-alpine AS runtime
```

Key hardening steps:

| Step | Why |
|---|---|
| `apk upgrade` on startup | Apply any Alpine security patches released since the base image was built |
| Non-root user `appuser` (uid 1001) | Principle of least privilege |
| Pre-created `output/`, `logs/`, `checkpoints/` with correct ownership | Prevent the app from ever needing to run as root |
| `HEALTHCHECK` via `wget` | Docker and Compose track liveness automatically |

---

## docker-compose.yml

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "${API_PORT:-3000}:3000"
    environment:
      NODE_ENV: production
      API_HOST: "0.0.0.0"
      USER_AGENTS: "${USER_AGENTS:-<default list>}"
      # … other vars forwarded from .env
    volumes:
      - output:/app/output
      - logs:/app/logs
      - checkpoints:/app/checkpoints
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

volumes:
  output:
  logs:
  checkpoints:
```

### Named volumes

| Volume | Mount path | Purpose |
|---|---|---|
| `output` | `/app/output` | Persists scraped JSON files across container restarts |
| `logs` | `/app/logs` | Persists Winston log files |
| `checkpoints` | `/app/checkpoints` | Persists scraping checkpoints for resume support |

---

## Environment variables in Docker

All variables documented in [configuration.md](./configuration.md) can be passed to the container.  The recommended approach is a `.env` file that Docker Compose reads automatically:

```dotenv
# .env
API_PORT=3000
LOG_LEVEL=info
DELAY_BETWEEN_REQUESTS=2000
USER_AGENTS=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...,...
```

Override individual variables at runtime:

```bash
LOG_LEVEL=debug docker compose up
```

---

## Common commands

```bash
# Build the image without starting
docker compose build

# Start in the foreground (see logs)
docker compose up

# Start detached
docker compose up -d

# Tail logs
docker compose logs -f api

# Stop and remove containers (volumes are preserved)
docker compose down

# Stop and remove containers AND volumes
docker compose down -v

# Rebuild after a code change
docker compose up --build -d
```

---

## Health check

The API exposes `GET /health`.  Docker Compose uses it as a liveness probe:

```bash
# Manual check
curl http://localhost:3000/health
# → { "status": "healthy", "uptime": 42, ... }
```

The container is considered `healthy` only after the health check passes, which avoids routing traffic before the server is ready.

---

## Production notes

- **Secrets**: Do not commit API keys to version control. Use Docker secrets or a secrets manager and inject them via environment variables at deploy time.
- **Image registry**: Tag and push the image after a successful build:
  ```bash
  docker build -t your-registry/wiz-cve-scraper:$(git rev-parse --short HEAD) .
  docker push your-registry/wiz-cve-scraper:$(git rev-parse --short HEAD)
  ```
- **Resource limits**: Add `mem_limit` / `cpus` to the service definition for predictable resource usage in shared environments.
- **Log rotation**: Mount logs to a host path and configure logrotate, or forward to a centralised logging service via a Docker log driver (e.g. `json-file` with `max-size`).
