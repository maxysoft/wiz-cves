const fs = require('fs-extra');
const path = require('path');
const Joi = require('joi');
const logger = require('./logger');
const config = require('../config');

/**
 * Sleep for a specified number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxAttempts - Maximum number of attempts
 * @param {number} baseDelay - Base delay in milliseconds
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

/**
 * Ensure directory exists
 * @param {string} dirPath - Directory path
 */
const ensureDir = async (dirPath) => {
  try {
    await fs.ensureDir(dirPath);
  } catch (error) {
    logger.error(`Failed to create directory: ${dirPath}`, error);
    throw error;
  }
};

/**
 * Save data to JSON file with backup
 * @param {string} filename - Filename without extension
 * @param {Object} data - Data to save
 * @param {string} outputDir - Output directory
 * @param {boolean} useTimestampedFolder - Whether to create timestamped subfolder
 * @returns {Promise<string>} - Full path of saved file
 */
const saveToJson = async (filename, data, outputDir = config.output.dir, useTimestampedFolder = false) => {
  let finalOutputDir = outputDir;

  if (useTimestampedFolder) {
    const isoDate = new Date().toISOString().replace(/[:.]/g, '-');
    const tsFolder = `${isoDate.split('T')[0]}_${isoDate.split('T')[1].split('.')[0]}`;
    finalOutputDir = path.join(outputDir, `scrape_${tsFolder}`);
  }
  
  await ensureDir(finalOutputDir);
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fullFilename = `${filename}_${timestamp}.json`;
  const filePath = path.join(finalOutputDir, fullFilename);
  
  try {
    await fs.writeJson(filePath, data, { spaces: 2 });
    logger.info(`Data saved to: ${filePath}`);
    
    // Also save as latest in the main output directory
    const latestPath = path.join(outputDir, `${filename}_latest.json`);
    await fs.writeJson(latestPath, data, { spaces: 2 });
    
    return filePath;
  } catch (error) {
    logger.error(`Failed to save data to: ${filePath}`, error);
    throw error;
  }
};

/**
 * Load data from JSON file
 * @param {string} filePath - File path
 * @returns {Promise<Object>} - Loaded data
 */
const loadFromJson = async (filePath) => {
  try {
    const data = await fs.readJson(filePath);
    logger.info(`Data loaded from: ${filePath}`);
    return data;
  } catch (error) {
    logger.error(`Failed to load data from: ${filePath}`, error);
    throw error;
  }
};

/**
 * Save checkpoint data
 * @param {Array} processedCVEs - Processed CVE data
 * @param {number} currentIndex - Current processing index
 * @returns {Promise<string>} - Checkpoint file path
 */
const saveCheckpoint = async (processedCVEs, currentIndex) => {
  if (!config.output.saveCheckpoints) {
    return null;
  }
  
  await ensureDir(config.paths.checkpoints);
  
  const checkpoint = {
    timestamp: new Date().toISOString(),
    processedCount: processedCVEs.length,
    currentIndex,
    data: processedCVEs
  };
  
  const filename = `checkpoint_${Date.now()}.json`;
  const filePath = path.join(config.paths.checkpoints, filename);
  
  await fs.writeJson(filePath, checkpoint, { spaces: 2 });
  logger.checkpoint(processedCVEs.length, filename);
  
  return filePath;
};

/**
 * Load latest checkpoint
 * @returns {Promise<Object|null>} - Checkpoint data or null
 */
const loadLatestCheckpoint = async () => {
  try {
    const checkpointDir = config.paths.checkpoints;
    const files = await fs.readdir(checkpointDir);
    const checkpointFiles = files
      .filter(file => file.startsWith('checkpoint_') && file.endsWith('.json'))
      .sort((a, b) => {
        const timeA = parseInt(a.replace('checkpoint_', '').replace('.json', ''), 10);
        const timeB = parseInt(b.replace('checkpoint_', '').replace('.json', ''), 10);
        return timeB - timeA;
      });
    
    if (checkpointFiles.length === 0) {
      return null;
    }
    
    const latestFile = path.join(checkpointDir, checkpointFiles[0]);
    const checkpoint = await loadFromJson(latestFile);
    
    logger.info(`Loaded checkpoint: ${checkpointFiles[0]}`, {
      processedCount: checkpoint.processedCount,
      timestamp: checkpoint.timestamp
    });
    
    return checkpoint;
  } catch (error) {
    logger.warn('Failed to load checkpoint', error);
    return null;
  }
};

/**
 * Validate CVE data structure
 * @param {Object} cveData - CVE data to validate
 * @returns {Object} - Validation result
 */
const validateCVEData = (cveData) => {
  const schema = Joi.object({
    cveId: Joi.string().pattern(/^CVE-\d{4}-\d+$/).required(),
    severity: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'CRITICAL').allow(''),
    score: Joi.number().min(0).max(10).allow(null),
    technologies: Joi.array().items(Joi.string()).default([]),
    component: Joi.string().allow(''),
    publishedDate: Joi.string().allow(''),
    detailUrl: Joi.string().uri().allow(''),
    additionalResources: Joi.array().items(
      Joi.object({
        title: Joi.string().required(),
        url: Joi.string().uri().required()
      })
    ).default([])
  });
  
  return schema.validate(cveData);
};

/**
 * Clean and normalize text
 * @param {string} text - Text to clean
 * @returns {string} - Cleaned text
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
 * Parse CVSS score from text
 * @param {string} scoreText - Score text
 * @returns {number|null} - Parsed score
 */
const parseCVSSScore = (scoreText) => {
  if (!scoreText) { return null; }

  const match = scoreText.toString().match(/\d+\.?\d*/);
  if (match) {
    const score = parseFloat(match[0]);
    return score >= 0 && score <= 10 ? score : null;
  }

  return null;
};

/**
 * Generate analytics from CVE data
 * @param {Array} cveData - Array of CVE objects
 * @returns {Object} - Analytics data
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
    // Severity distribution
    if (cve.severity) {
      analytics.severityDistribution[cve.severity] = 
        (analytics.severityDistribution[cve.severity] || 0) + 1;
    }
    
    // Score distribution
    if (cve.score !== null && cve.score !== undefined) {
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
    
    // Technologies
    if (cve.technologies && Array.isArray(cve.technologies)) {
      cve.technologies.forEach(tech => {
        analytics.topTechnologies[tech] = (analytics.topTechnologies[tech] || 0) + 1;
      });
    }
    
    // Components
    if (cve.component) {
      analytics.topComponents[cve.component] = 
        (analytics.topComponents[cve.component] || 0) + 1;
    }
    
    // Additional resources
    if (cve.additionalResources && 
        cve.additionalResources.externalLinks && 
        cve.additionalResources.externalLinks.length > 0) {
      analytics.withAdditionalResources++;
    }
  });
  
  // Calculate average score
  analytics.averageScore = scoreCount > 0 ? (totalScore / scoreCount).toFixed(2) : 0;
  
  // Sort top technologies and components
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

/**
 * Save text data to file
 * @param {string} data - Text data to save
 * @param {string} filename - Base filename (without extension)
 * @param {string} outputDir - Output directory
 * @param {boolean} useTimestampedFolder - Whether to use timestamped folder
 * @returns {Promise<string>} - File path
 */
const saveToTextFile = async (data, filename, outputDir = config.outputDir, useTimestampedFolder = true) => {
  let finalOutputDir = outputDir;

  if (useTimestampedFolder) {
    const isoDate = new Date().toISOString().replace(/[:.]/g, '-');
    const tsFolder = `${isoDate.split('T')[0]}_${isoDate.split('T')[1].split('.')[0]}`;
    finalOutputDir = path.join(outputDir, `scrape_${tsFolder}`);
  }
  
  await ensureDir(finalOutputDir);
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fullFilename = `${filename}_${timestamp}.txt`;
  const filePath = path.join(finalOutputDir, fullFilename);
  
  try {
    await fs.writeFile(filePath, data, 'utf8');
    logger.info(`Text data saved to: ${filePath}`);
    
    // Also save as latest in the main output directory
    const latestPath = path.join(outputDir, `${filename}_latest.txt`);
    await fs.writeFile(latestPath, data, 'utf8');
    
    return filePath;
  } catch (error) {
    logger.error(`Failed to save text data to: ${filePath}`, error);
    throw error;
  }
};

/**
 * Extract and process external URLs from CVE data
 * @param {Array} cveData - Array of CVE objects
 * @returns {Array} - Array of unique base URLs
 */
const extractBaseUrls = (cveData) => {
  const allUrls = new Set();
  
  cveData.forEach(cve => {
    // Extract from sourceUrl
    if (cve.sourceUrl) {
      allUrls.add(cve.sourceUrl);
    }
    
    // Extract from additionalResources.externalLinks
    if (cve.additionalResources && cve.additionalResources.externalLinks) {
      cve.additionalResources.externalLinks.forEach(link => {
        if (link.url) {
          allUrls.add(link.url);
        }
      });
    }
  });
  
  // Convert URLs to base domains
  const baseUrls = new Set();
  allUrls.forEach(url => {
    try {
      const urlObj = new URL(url);
      const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
      baseUrls.add(baseUrl);
    } catch (_unused) {
      logger.warn(`Invalid URL encountered: ${url}`);
    }
  });
  
  return Array.from(baseUrls).sort();
};

module.exports = {
  sleep,
  retryWithBackoff,
  ensureDir,
  saveToJson,
  saveToTextFile,
  loadFromJson,
  saveCheckpoint,
  loadLatestCheckpoint,
  validateCVEData,
  cleanText,
  parseCVSSScore,
  generateAnalytics,
  extractBaseUrls
};