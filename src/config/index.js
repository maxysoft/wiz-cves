const path = require('path');
require('dotenv').config({ quiet: true });

// Validate cron expression (basic field-count check; node-cron handles deep validation)
function _isValidCron(expr) {
  if (!expr) {
    return false;
  }
  const parts = expr.trim().split(/\s+/);
  return parts.length >= 5 && parts.length <= 6;
}

// Default user agent list used when USER_AGENTS is not set
const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15'
];

/**
 * Parse the USER_AGENTS environment variable.
 * Accepts a comma-separated list of user-agent strings.
 * Falls back to USER_AGENT (single value) or the built-in default list.
 */
function parseUserAgents() {
  if (process.env.USER_AGENTS) {
    const list = process.env.USER_AGENTS.split(',').map((ua) => ua.trim()).filter(Boolean);
    if (list.length > 0) {
      return list;
    }
  }
  if (process.env.USER_AGENT) {
    return [process.env.USER_AGENT.trim()];
  }
  return DEFAULT_USER_AGENTS;
}

// Resolved once at startup; shared by the config object and getRandomUserAgent.
const USER_AGENTS = parseUserAgents();

/**
 * Return a random user-agent string from the configured list.
 * This is called on every outbound request so that each request
 * uses a different agent (uniform random rotation).
 *
 * @returns {string}
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const config = {
  // Database Configuration (SQLite)
  database: {
    path: path.resolve(
      __dirname,
      '../..',
      process.env.DATABASE_PATH || 'data/cve_scraper.db'
    )
  },

  // Scheduling Configuration
  scheduling: {
    // Cron expression for automatic scraping (e.g. "0 */6 * * *" = every 6 hours).
    // Leave empty to disable automatic scheduling.
    cronExpression: _isValidCron(process.env.SCRAPER_CRON) ? process.env.SCRAPER_CRON.trim() : '',
    // Hard minimum interval between executions (default: 1 hour).  Cannot be
    // lowered below 1 hour — this is enforced in code regardless of this value.
    minIntervalHours: Math.max(1, parseInt(process.env.MIN_INTERVAL_HOURS, 10) || 1),
    // When true, trigger one scraping job immediately when the API server starts.
    // Intended for first-start bootstrapping so the database is populated right away.
    scrapeOnStart: process.env.SCRAPE_ON_START === 'true'
  },

  // Algolia API Configuration
  algolia: {
    baseUrl: 'https://hdr4182jve-dsn.algolia.net/1/indexes/*/queries',
    apiKey: process.env.ALGOLIA_API_KEY || '2023c7fbf68076909d1a85ec42cea550',
    applicationId: process.env.ALGOLIA_APPLICATION_ID || 'HDR4182JVE',
    indexName: 'cve-db',
    hitsPerPage: parseInt(process.env.HITS_PER_PAGE, 10) || 20,
    maxPages: parseInt(process.env.MAX_PAGES, 10) || 100,
    timeout: parseInt(process.env.API_TIMEOUT, 10) || 60000 // Increased from 30s to 60s
  },

  // Scraping Configuration
  scraping: {
    delayBetweenRequests: parseInt(process.env.DELAY_BETWEEN_REQUESTS, 10) || 2000, // Increased from 1s to 2s
    retryAttempts: parseInt(process.env.RETRY_ATTEMPTS, 10) || 5, // Increased from 3 to 5
    maxCVEs: parseInt(process.env.MAX_CVES, 10) || null,
    targetUrl: process.env.TARGET_URL || 'https://www.wiz.io/vulnerability-database/cve/search',
    // Gentle mode: slower scraping to avoid stressing the remote API.
    // When enabled, uses gentleDelay between requests and disables parallelism.
    gentleMode: process.env.GENTLE_MODE === 'true',
    gentleDelay: parseInt(process.env.GENTLE_DELAY_MS, 10) || 5000,
    gentleHitsPerPage: parseInt(process.env.GENTLE_HITS_PER_PAGE, 10) || 10,
    // Circuit breaker configuration
    circuitBreakerThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD, 10) || 5,
    circuitBreakerTimeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT, 10) || 60000,
    // Connection pool settings
    maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS, 10) || 3, // Reduced from 5 to 3
    requestPoolTimeout: parseInt(process.env.REQUEST_POOL_TIMEOUT, 10) || 120000
  },

  // Output Configuration
  output: {
    dir: process.env.OUTPUT_DIR || './output',
    filename: process.env.OUTPUT_FILENAME || 'cve_data',
    saveCheckpoints: process.env.SAVE_CHECKPOINTS !== 'false', // Enable by default, disable with 'false'
    checkpointInterval: parseInt(process.env.CHECKPOINT_INTERVAL, 10) || 100
  },

  // API Configuration
  api: {
    port: parseInt(process.env.API_PORT, 10) || 3000,
    host: process.env.API_HOST || 'localhost'
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },

  // Data transformation settings
  dataTransform: {
    includeDescription: process.env.INCLUDE_DESCRIPTION !== 'false',
    includeAffectedSoftware: process.env.INCLUDE_AFFECTED_SOFTWARE !== 'false',
    includeAffectedTechnologies: process.env.INCLUDE_AFFECTED_TECHNOLOGIES !== 'false',
    maxDescriptionLength: parseInt(process.env.MAX_DESCRIPTION_LENGTH, 10) || 1000
  },

  // User-agent rotation
  // Sourced from USER_AGENTS (comma-separated list), USER_AGENT (single), or
  // the built-in default list.  getRandomUserAgent() picks one per request.
  browser: {
    userAgents: USER_AGENTS
  },

  // Paths
  paths: {
    root: path.resolve(__dirname, '../..'),
    src: path.resolve(__dirname, '..'),
    output: path.resolve(__dirname, '../../output'),
    checkpoints: path.resolve(__dirname, '../../checkpoints')
  }
};

module.exports = config;
module.exports.getRandomUserAgent = getRandomUserAgent;