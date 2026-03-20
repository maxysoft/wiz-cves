const winston = require('winston');
const config = require('../config');

// Human-readable format for local development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`;
  })
);

// Structured JSON format for production (Docker log management reads stdout/stderr)
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: config.logging.level,
  format: process.env.NODE_ENV === 'production' ? jsonFormat : consoleFormat,
  defaultMeta: { service: 'wiz-cve-scraper' },
  transports: [
    // All logs go to stdout; errors are additionally mirrored to stderr so
    // Docker log drivers and `docker logs` can filter by stream.
    new winston.transports.Console({
      stderrLevels: ['error']
    })
  ]
});

// Custom methods for specific logging scenarios
logger.scrapeStart = (url) => {
  logger.info('Starting scrape operation', { url, timestamp: new Date().toISOString() });
};

logger.scrapeComplete = (totalCVEs, duration) => {
  logger.info('Scrape operation completed', {
    totalCVEs,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString()
  });
};

logger.scrapeError = (error, context = {}) => {
  logger.error('Scrape operation failed', {
    error: error.message,
    stack: error.stack,
    context,
    timestamp: new Date().toISOString()
  });
};

logger.cveProcessed = (cveId, index, total) => {
  if (index % 10 === 0 || index === total) {
    logger.info('CVE processing progress', {
      cveId,
      progress: `${index}/${total}`,
      percentage: `${((index / total) * 100).toFixed(1)}%`
    });
  }
};

logger.cveError = (cveId, error) => {
  logger.warn('Failed to process CVE', {
    cveId,
    error: error.message,
    timestamp: new Date().toISOString()
  });
};

logger.checkpoint = (count, filename) => {
  logger.info('Checkpoint saved', {
    processedCount: count,
    checkpointFile: filename,
    timestamp: new Date().toISOString()
  });
};

logger.performance = (operation, duration, details = {}) => {
  logger.info('Performance metric', {
    operation,
    duration: `${duration}ms`,
    ...details,
    timestamp: new Date().toISOString()
  });
};

module.exports = logger;