const fs = require('fs-extra');
const Joi = require('joi');
const logger = require('./logger');
const config = require('../config');
const { getDatabase } = require('./database');

// ── Timing & retry ───────────────────────────────────────────────────────────

/**
 * Sleep for a specified number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry a function with exponential backoff.
 * @param {Function} fn
 * @param {number} maxAttempts
 * @param {number} baseDelay  Base delay in ms (doubles each retry).
 * @returns {Promise<any>}
 */
const retryWithBackoff = async (fn, maxAttempts = 3, baseDelay = 1000) => {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms`, {
        error: error.message,
        attempt,
        maxAttempts
      });

      await sleep(delay);
    }
  }

  throw lastError;
};

// ── File-system helpers ──────────────────────────────────────────────────────

/**
 * Ensure a directory exists, creating it recursively if necessary.
 * @param {string} dirPath
 */
const ensureDir = async (dirPath) => {
  try {
    await fs.ensureDir(dirPath);
  } catch (error) {
    logger.error(`Failed to create directory: ${dirPath}`, error);
    throw error;
  }
};

// ── Database-backed persistence ───────────────────────────────────────────────

/**
 * Save an array of CVE objects to the SQLite database.
 *
 * @param {Array<Object>} cves
 * @returns {number} Number of CVEs saved.
 */
const saveCVEsToDatabase = (cves) => {
  try {
    const db = getDatabase();
    const count = db.saveCVEs(cves);
    logger.info(`Saved ${count} CVEs to database`);
    return count;
  } catch (error) {
    logger.error('Failed to save CVEs to database', error);
    throw error;
  }
};

/**
 * Load CVEs from the SQLite database with optional filters.
 *
 * @param {Object} [filters]
 * @param {string} [filters.severity]
 * @param {string} [filters.search]
 * @param {number} [filters.limit=100]
 * @param {number} [filters.offset=0]
 * @returns {Array<Object>}
 */
const loadCVEsFromDatabase = (filters = {}) => {
  try {
    const db = getDatabase();
    return db.getCVEs(filters);
  } catch (error) {
    logger.error('Failed to load CVEs from database', error);
    throw error;
  }
};

/**
 * Save a checkpoint to the SQLite database.
 *
 * @param {Array<Object>} processedCVEs
 * @param {number}        currentIndex
 * @returns {number|null} Row ID of the saved checkpoint, or null when
 *   checkpoints are disabled in config.
 */
const saveCheckpoint = (processedCVEs, currentIndex) => {
  if (!config.output.saveCheckpoints) {
    return null;
  }

  try {
    const db = getDatabase();
    const rowId = db.saveCheckpoint(processedCVEs, currentIndex);
    logger.checkpoint(processedCVEs.length, `db:checkpoints#${rowId}`);
    return rowId;
  } catch (error) {
    logger.error('Failed to save checkpoint to database', error);
    throw error;
  }
};

/**
 * Load the latest checkpoint from the SQLite database.
 *
 * @returns {Object|null}
 */
const loadLatestCheckpoint = () => {
  try {
    const db = getDatabase();
    const checkpoint = db.getLatestCheckpoint();

    if (checkpoint) {
      logger.info('Loaded checkpoint from database', {
        processedCount: checkpoint.processedCount,
        timestamp: checkpoint.timestamp
      });
    }

    return checkpoint;
  } catch (error) {
    logger.warn('Failed to load checkpoint from database', error);
    return null;
  }
};

// ── CVE validation ────────────────────────────────────────────────────────────

/**
 * Validate a single CVE data object against the Joi schema.
 * @param {Object} cveData
 * @returns {{ error?: ValidationError, value: Object }}
 */
const validateCVEData = (cveData) => {
  const schema = Joi.object({
    cveId: Joi.string().pattern(/^CVE-\d{4}-\d+$/).required(),
    severity: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'N/A').allow(''),
    score: Joi.alternatives().try(
      Joi.number().min(0).max(10),
      Joi.string().allow('N/A', '')
    ).allow(null),
    technologies: Joi.alternatives().try(
      Joi.array().items(Joi.string()),
      Joi.string()
    ).default([]),
    component: Joi.string().allow('', null),
    publishedDate: Joi.string().allow('', null),
    detailUrl: Joi.string().allow('', null),
    description: Joi.string().allow('', null),
    sourceUrl: Joi.string().allow('', null),
    hasCisaKevExploit: Joi.boolean().default(false),
    hasFix: Joi.boolean().default(false),
    isHighProfileThreat: Joi.boolean().default(false),
    exploitable: Joi.boolean().default(false),
    epssPercentile: Joi.number().min(0).max(100).allow(null),
    epssProbability: Joi.number().min(0).max(1).allow(null),
    baseScore: Joi.number().min(0).max(10).allow(null),
    cnaScore: Joi.number().min(0).max(10).allow(null),
    cvss2: Joi.object().allow(null),
    cvss3: Joi.object().allow(null),
    sourceFeeds: Joi.array().default([]),
    aiDescription: Joi.object().allow(null),
    batchId: Joi.string().allow('', null),
    additionalResources: Joi.alternatives().try(
      Joi.array().items(
        Joi.object({
          title: Joi.string().required(),
          url: Joi.string().uri().required()
        })
      ),
      Joi.object()
    ).default([])
  });

  return schema.validate(cveData, { allowUnknown: true });
};

// ── Text utilities ────────────────────────────────────────────────────────────

/**
 * Collapse whitespace and control characters in a string.
 * Returns an empty string for null / undefined / non-string values.
 * @param {string} text
 * @returns {string}
 */
const cleanText = (text) => {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\r\n\t]/g, ' ')
    .trim();
};

/**
 * Extract a numeric CVSS score (0–10) from a free-form string or number.
 * Returns null if the value cannot be parsed or is out of range.
 * @param {string|number} scoreText
 * @returns {number|null}
 */
const parseCVSSScore = (scoreText) => {
  if (scoreText === null || scoreText === undefined || scoreText === '') {
    return null;
  }

  const match = scoreText.toString().match(/\d+\.?\d*/);
  if (match) {
    const score = parseFloat(match[0]);
    return score >= 0 && score <= 10 ? score : null;
  }

  return null;
};

// ── Analytics ─────────────────────────────────────────────────────────────────

/**
 * Generate summary statistics from an array of CVE objects.
 *
 * @param {Array<Object>} cveData
 * @returns {Object}
 */
const generateAnalytics = (cveData) => {
  const analytics = {
    total: cveData.length,
    severityDistribution: {},
    scoreDistribution: {
      '0-3': 0,
      '3-7': 0,
      '7-9': 0,
      '9-10': 0
    },
    topTechnologies: {},
    topComponents: {},
    dateRange: {
      earliest: null,
      latest: null
    },
    withAdditionalResources: 0,
    averageScore: 0
  };

  let totalScore = 0;
  let scoreCount = 0;

  cveData.forEach(cve => {
    if (cve.severity) {
      analytics.severityDistribution[cve.severity] =
        (analytics.severityDistribution[cve.severity] || 0) + 1;
    }

    if (typeof cve.score === 'number' && !isNaN(cve.score)) {
      totalScore += cve.score;
      scoreCount++;

      if (cve.score < 3) {
        analytics.scoreDistribution['0-3']++;
      } else if (cve.score < 7) {
        analytics.scoreDistribution['3-7']++;
      } else if (cve.score < 9) {
        analytics.scoreDistribution['7-9']++;
      } else {
        analytics.scoreDistribution['9-10']++;
      }
    }

    if (Array.isArray(cve.technologies)) {
      cve.technologies.forEach(tech => {
        analytics.topTechnologies[tech] = (analytics.topTechnologies[tech] || 0) + 1;
      });
    }

    if (cve.component) {
      analytics.topComponents[cve.component] =
        (analytics.topComponents[cve.component] || 0) + 1;
    }

    if (
      cve.additionalResources &&
      cve.additionalResources.externalLinks &&
      cve.additionalResources.externalLinks.length > 0
    ) {
      analytics.withAdditionalResources++;
    }
  });

  analytics.averageScore = scoreCount > 0 ? (totalScore / scoreCount).toFixed(2) : 0;

  analytics.topTechnologies = Object.entries(analytics.topTechnologies)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

  analytics.topComponents = Object.entries(analytics.topComponents)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

  return analytics;
};

// ── URL utilities ─────────────────────────────────────────────────────────────

/**
 * Extract and deduplicate base-domain URLs from CVE data.
 *
 * @param {Array<Object>} cveData
 * @returns {Array<string>} Sorted, unique base URLs (scheme + hostname).
 */
const extractBaseUrls = (cveData) => {
  const allUrls = new Set();

  cveData.forEach(cve => {
    if (cve.sourceUrl) {
      allUrls.add(cve.sourceUrl);
    }

    if (cve.additionalResources && cve.additionalResources.externalLinks) {
      cve.additionalResources.externalLinks.forEach(link => {
        if (link.url) {
          allUrls.add(link.url);
        }
      });
    }
  });

  const baseUrls = new Set();
  allUrls.forEach(url => {
    try {
      const urlObj = new URL(url);
      baseUrls.add(`${urlObj.protocol}//${urlObj.hostname}`);
    } catch {
      logger.warn(`Invalid URL encountered: ${url}`);
    }
  });

  return Array.from(baseUrls).sort();
};

module.exports = {
  sleep,
  retryWithBackoff,
  ensureDir,
  saveCVEsToDatabase,
  loadCVEsFromDatabase,
  saveCheckpoint,
  loadLatestCheckpoint,
  validateCVEData,
  cleanText,
  parseCVSSScore,
  generateAnalytics,
  extractBaseUrls
};
