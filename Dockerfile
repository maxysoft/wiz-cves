# ─── Stage 1: dependency installation ────────────────────────────────────────
FROM node:24-alpine AS deps

WORKDIR /app

# Build tools required by better-sqlite3 (native addon compilation)
RUN apk add --no-cache python3 make g++ sqlite-dev

# Copy only the manifest files first so Docker layer-caches the install step
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --legacy-peer-deps

# ─── Stage 2: production runtime ─────────────────────────────────────────────
FROM node:24-alpine AS runtime

LABEL org.opencontainers.image.title="Wiz CVE Scraper API" \
      org.opencontainers.image.description="Production-grade Node.js CVE scraper with REST API" \
      org.opencontainers.image.source="https://github.com/maxysoft/wiz-cves" \
      org.opencontainers.image.licenses="MIT"

# Apply latest security patches and install runtime deps
RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache wget sqlite-libs && \
    rm -rf /var/cache/apk/*

# Create a non-root user/group for the application
RUN addgroup -g 1001 -S appgroup && \
    adduser  -u 1001 -S appuser -G appgroup

WORKDIR /app

# Copy production node_modules from the deps stage
COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules

# Copy application source
COPY --chown=appuser:appgroup src/ ./src/
COPY --chown=appuser:appgroup package.json ./

# Pre-create runtime directories with the correct owner so the app never
# needs root access to write output, logs, or the database.
RUN mkdir -p data logs && \
    chown -R appuser:appgroup data logs

# Drop privileges
USER appuser

# Expose the API port (default 3000, overridable via API_PORT env var)
EXPOSE 3000

# Lightweight health-check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -q --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/api.js"]
