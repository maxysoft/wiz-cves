const path = require('path');
require('dotenv').config({ quiet: true });

const config = {
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
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/scraper.log'
  },

  // Data transformation settings
  dataTransform: {
    includeDescription: process.env.INCLUDE_DESCRIPTION !== 'false',
    includeAffectedSoftware: process.env.INCLUDE_AFFECTED_SOFTWARE !== 'false',
    includeAffectedTechnologies: process.env.INCLUDE_AFFECTED_TECHNOLOGIES !== 'false',
    maxDescriptionLength: parseInt(process.env.MAX_DESCRIPTION_LENGTH, 10) || 1000
  },

  // Paths
  paths: {
    root: path.resolve(__dirname, '../..'),
    src: path.resolve(__dirname, '..'),
    output: path.resolve(__dirname, '../../output'),
    logs: path.resolve(__dirname, '../../logs'),
    checkpoints: path.resolve(__dirname, '../../checkpoints')
  }
};

module.exports = config;