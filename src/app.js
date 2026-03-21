#!/usr/bin/env node

const { Command } = require('commander');
const cron = require('node-cron');
const WizCVEScraper = require('./scraper/WizCVEScraper');
const logger = require('./utils/logger');
const {
  saveCVEsToDatabase,
  loadCVEsFromDatabase,
  saveCheckpoint,
  loadLatestCheckpoint,
  generateAnalytics,
  extractBaseUrls
} = require('./utils/helpers');
const { getDatabase } = require('./utils/database');
const config = require('./config');

// Minimum allowed interval between scrape runs (hard limit: 1 hour).
const MIN_INTERVAL_MS = config.scheduling.minIntervalHours * 60 * 60 * 1000;

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle graceful shutdown
let isShuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) {
    logger.warn('Force shutdown requested, exiting immediately...');
    process.exit(1);
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);

  try {
    const appInstance = global.currentAppInstance;

    if (appInstance && appInstance.scraper) {
      logger.info('Saving current progress before shutdown...');

      let dataToSave = [];

      if (appInstance.scraper.cveData && appInstance.scraper.cveData.length > 0) {
        dataToSave = appInstance.scraper.cveData;
        logger.info(`Found completed CVE data: ${dataToSave.length} CVEs`);
      } else if (appInstance.scraper.getAllCollectedCVEs) {
        dataToSave = appInstance.scraper.getAllCollectedCVEs();
        logger.info(`Found intermediate CVE data: ${dataToSave.length} CVEs`);
      }

      if (dataToSave.length > 0) {
        try {
          saveCheckpoint(dataToSave, appInstance.scraper.processedCount || dataToSave.length);
          saveCVEsToDatabase(dataToSave);
          logger.info(`Saved ${dataToSave.length} CVEs to database during shutdown`);
        } catch (saveError) {
          logger.error('Error saving data during graceful shutdown:', saveError);
        }
      } else {
        logger.info('No CVE data collected yet, skipping checkpoint save');
      }

      await appInstance.scraper.cleanup();
    }

    logger.info('Graceful shutdown completed');
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

class CVEScraperApp {
  constructor() {
    this.scraper = null;
    this.program = new Command();
    this._scheduledTask = null;
    this.setupCLI();

    global.currentAppInstance = this;
  }

  setupCLI() {
    this.program
      .name('wiz-cve-scraper')
      .description('A robust Node.js web-scraping tool for extracting CVE data from Wiz vulnerability database')
      .version('1.0.0');

    // scrape command
    this.program
      .command('scrape')
      .description('Start scraping CVE data and save results to the SQLite database')
      .option('-d, --delay <ms>', 'Delay between requests in ms', parseInt, config.scraping.delayBetweenRequests)
      .option('-r, --retry <number>', 'Number of retry attempts', parseInt, config.scraping.retryAttempts)
      .option('-m, --max-cves <number>', 'Maximum number of CVEs to process', parseInt)
      .option('--resume', 'Resume from last checkpoint')
      .option('--no-analytics', 'Skip analytics generation')
      .option('--gentle', 'Enable gentle mode (slow scraping to reduce API load)', false)
      .option('--force', 'Bypass the 1-hour rate limiter (use with caution)', false)
      .action(this.handleScrapeCommand.bind(this));

    // schedule command
    this.program
      .command('schedule <cron>')
      .description('Run the scraper on a cron schedule (e.g. "0 */6 * * *" = every 6 hours)')
      .option('-d, --delay <ms>', 'Delay between requests in ms', parseInt, config.scraping.delayBetweenRequests)
      .option('--gentle', 'Enable gentle mode for scheduled runs', false)
      .action(this.handleScheduleCommand.bind(this));

    // analytics command
    this.program
      .command('analytics')
      .description('Generate analytics from CVEs stored in the database')
      .action(this.handleAnalyticsCommand.bind(this));

    // validate command
    this.program
      .command('validate')
      .description('Validate CVE data stored in the database')
      .action(this.handleValidateCommand.bind(this));

    // resume command
    this.program
      .command('resume')
      .description('Show the latest checkpoint information')
      .action(this.handleResumeCommand.bind(this));
  }

  // ── Command handlers ───────────────────────────────────────────────────────

  async handleScrapeCommand(options) {
    try {
      logger.info('Starting CVE scraping operation...');

      // Hard limiter — skip check only when --force is passed
      if (!options.force) {
        const db = getDatabase();
        const { allowed, minutesRemaining } = db.checkExecutionAllowed(MIN_INTERVAL_MS);
        if (!allowed) {
          logger.error(
            'Rate limiter: last execution was too recent. ' +
            `Try again in ${minutesRemaining} minute(s) or use --force.`
          );
          process.exit(1);
        }
      }

      const gentleMode = options.gentle || config.scraping.gentleMode;
      const scraperOptions = {
        delayBetweenRequests: gentleMode ? config.scraping.gentleDelay : options.delay,
        retryAttempts: options.retry,
        maxCVEs: options.maxCves,
        resumeFromCheckpoint: options.resume,
        useComprehensiveScraping: gentleMode ? false : config.scraping.useComprehensiveScraping,
        ...(gentleMode ? { hitsPerPage: config.scraping.gentleHitsPerPage } : {}),
        gentleMode
      };

      if (gentleMode) {
        logger.info('Gentle mode enabled — using reduced concurrency and longer delays');
      }

      this.scraper = new WizCVEScraper(scraperOptions);

      if (options.resume) {
        const checkpoint = loadLatestCheckpoint();
        if (checkpoint) {
          logger.info(`Resuming from checkpoint with ${checkpoint.processedCount} CVEs`);
        } else {
          logger.info('No checkpoint found, starting fresh scrape');
        }
      }

      const db = getDatabase();
      const jobId = `cli_${Date.now()}`;
      db.recordExecution('cli');
      db.saveRun({ jobId, startedAt: new Date().toISOString(), status: 'running', options: scraperOptions });

      const startTime = Date.now();
      const result = await this.scraper.scrapeAllCVEs();
      const duration = Date.now() - startTime;

      const savedCount = saveCVEsToDatabase(result.cveData);
      db.saveRun({ jobId, completedAt: new Date().toISOString(), status: 'completed', totalCves: savedCount });

      if (options.analytics !== false && result.cveData.length > 0) {
        const analytics = generateAnalytics(result.cveData);
        logger.info('Analytics summary generated', { total: analytics.total });
      }

      this.displaySummary(result, duration);
      logger.info(`CVE scraping completed — ${savedCount} CVEs stored in database`);
      process.exit(0);

    } catch (error) {
      logger.error('Scraping operation failed:', error);
      process.exit(1);
    }
  }

  async handleScheduleCommand(cronExpression, options) {
    if (!cron.validate(cronExpression)) {
      logger.error(`Invalid cron expression: "${cronExpression}"`);
      process.exit(1);
    }

    console.log(`\n⏰  Scheduler started with cron: "${cronExpression}"`);
    console.log(`⏱   Hard limiter: executions are spaced at least ${config.scheduling.minIntervalHours}h apart`);
    console.log('   Press Ctrl+C to stop.\n');

    const runScrape = async () => {
      const db = getDatabase();
      const { allowed, minutesRemaining } = db.checkExecutionAllowed(MIN_INTERVAL_MS);
      if (!allowed) {
        logger.warn(`Scheduled run skipped — rate limited (${minutesRemaining} min remaining)`);
        return;
      }

      logger.info('Scheduled scrape starting...');
      const gentleMode = options.gentle || config.scraping.gentleMode;
      const scraperOptions = {
        delayBetweenRequests: gentleMode ? config.scraping.gentleDelay : options.delay,
        retryAttempts: config.scraping.retryAttempts,
        useComprehensiveScraping: gentleMode ? false : config.scraping.useComprehensiveScraping,
        ...(gentleMode ? { hitsPerPage: config.scraping.gentleHitsPerPage } : {}),
        gentleMode
      };

      try {
        const jobId = `sched_${Date.now()}`;
        db.recordExecution('scheduled');
        db.saveRun({ jobId, startedAt: new Date().toISOString(), status: 'running', options: scraperOptions });

        this.scraper = new WizCVEScraper(scraperOptions);
        const result = await this.scraper.scrapeAllCVEs();
        const savedCount = saveCVEsToDatabase(result.cveData);

        db.saveRun({ jobId, completedAt: new Date().toISOString(), status: 'completed', totalCves: savedCount });
        logger.info(`Scheduled scrape completed — ${savedCount} CVEs stored`);
      } catch (error) {
        logger.error('Scheduled scrape failed:', error);
      } finally {
        this.scraper = null;
      }
    };

    this._scheduledTask = cron.schedule(cronExpression, runScrape);

    // Keep the process alive by waiting indefinitely
    await new Promise((resolve) => {
      process.once('SIGTERM', resolve);
    });
  }

  handleAnalyticsCommand() {
    try {
      logger.info('Generating analytics from database...');
      const cveData = loadCVEsFromDatabase({ limit: 100000 });

      if (cveData.length === 0) {
        console.log('\nNo CVE data found in the database. Run "scrape" first.');
        return;
      }

      const analytics = generateAnalytics(cveData);

      console.log('\n=== CVE Analytics ===');
      console.log(`Total CVEs:      ${analytics.total}`);
      console.log(`Average Score:   ${analytics.averageScore}`);
      console.log(`With Resources:  ${analytics.withAdditionalResources}`);
      console.log('\nSeverity Distribution:');
      Object.entries(analytics.severityDistribution).forEach(([sev, count]) => {
        console.log(`  ${sev}: ${count}`);
      });
      console.log('\nTop Technologies:');
      Object.entries(analytics.topTechnologies).slice(0, 5).forEach(([tech, count]) => {
        console.log(`  ${tech}: ${count}`);
      });

      logger.info('Analytics generation completed');

    } catch (error) {
      logger.error('Analytics generation failed:', error);
      process.exit(1);
    }
  }

  handleValidateCommand() {
    try {
      logger.info('Validating CVE data in database...');
      const cveData = loadCVEsFromDatabase({ limit: 100000 });

      if (cveData.length === 0) {
        console.log('\nNo CVE data found in the database.');
        return;
      }

      let validCount = 0;
      let invalidCount = 0;

      cveData.forEach((cve, index) => {
        if (cve.cveId && /^CVE-\d{4}-\d+$/.test(cve.cveId)) {
          validCount++;
        } else {
          invalidCount++;
          logger.warn(`Invalid CVE at index ${index}: ${cve.cveId}`);
        }
      });

      console.log('\n=== Validation Results ===');
      console.log(`Total CVEs:   ${cveData.length}`);
      console.log(`Valid CVEs:   ${validCount}`);
      console.log(`Invalid CVEs: ${invalidCount}`);
      console.log(`Validation:   ${invalidCount === 0 ? 'PASSED' : 'FAILED'}`);

    } catch (error) {
      logger.error('Validation failed:', error);
      process.exit(1);
    }
  }

  handleResumeCommand() {
    try {
      const checkpoint = loadLatestCheckpoint();

      if (!checkpoint) {
        logger.info('No checkpoint found in the database');
        console.log('\nNo checkpoint available. Run "scrape" first.');
        return;
      }

      logger.info(`Found checkpoint: ${checkpoint.processedCount} CVEs at ${checkpoint.timestamp}`);
      console.log('\n=== Latest Checkpoint ===');
      console.log(`Timestamp:       ${checkpoint.timestamp}`);
      console.log(`Processed CVEs:  ${checkpoint.processedCount}`);
      console.log(`Current Index:   ${checkpoint.currentIndex}`);
      console.log('\nRun "scrape --resume" to continue from this checkpoint.');

    } catch (error) {
      logger.error('Resume command failed:', error);
      process.exit(1);
    }
  }

  // ── Display helpers ────────────────────────────────────────────────────────

  displaySummary(result, duration) {
    const durationSeconds = (duration / 1000).toFixed(2);
    const avgTimePerCVE = result.totalCVEs > 0 ? (duration / result.totalCVEs).toFixed(2) : 0;

    console.log(`\n${'='.repeat(50)}`);
    console.log('           SCRAPING SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total CVEs Processed: ${result.totalCVEs}`);
    console.log(`Total Duration:       ${durationSeconds}s`);
    console.log(`Avg Time per CVE:     ${avgTimePerCVE}ms`);
    console.log(`Scrape Date:          ${result.scrapeDate}`);

    if (result.cveData && result.cveData.length > 0) {
      const severities = result.cveData.reduce((acc, cve) => {
        if (cve.severity) {
          acc[cve.severity] = (acc[cve.severity] || 0) + 1;
        }
        return acc;
      }, {});

      console.log('\nSeverity Distribution:');
      Object.entries(severities).forEach(([severity, count]) => {
        console.log(`  ${severity}: ${count}`);
      });

      const baseUrls = extractBaseUrls(result.cveData);
      if (baseUrls.length > 0) {
        logger.info(`Found ${baseUrls.length} unique external base URLs`);
      }
    }

    console.log('='.repeat(50));
  }

  async run() {
    try {
      await this.program.parseAsync(process.argv);
    } catch (error) {
      logger.error('Application error:', error);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  const app = new CVEScraperApp();
  app.run();
}

module.exports = CVEScraperApp;
