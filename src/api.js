const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cron = require('node-cron');
const WizCVEScraper = require('./scraper/WizCVEScraper');
const logger = require('./utils/logger');
const {
  saveCVEsToDatabase,
  loadCVEsFromDatabase,
  generateAnalytics,
  loadLatestCheckpoint
} = require('./utils/helpers');
const { getDatabase } = require('./utils/database');
const config = require('./config');

// Minimum allowed interval between scrape runs (hard limit: 1 hour).
const MIN_INTERVAL_MS = config.scheduling.minIntervalHours * 60 * 60 * 1000;

class CVEScraperAPI {
  constructor() {
    this.app = express();
    this.scraper = null;
    this.isScrapingInProgress = false;
    this.currentScrapingJob = null;
    this.scheduledJobs = new Map();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  // ── Middleware ─────────────────────────────────────────────────────────────

  setupMiddleware() {
    this.app.use(helmet());

    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
      credentials: true
    }));

    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  // ── Routes ─────────────────────────────────────────────────────────────────

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        uptime: process.uptime()
      });
    });

    // Status
    this.app.get('/api/status', (req, res) => {
      res.json({
        isScrapingInProgress: this.isScrapingInProgress,
        currentJob: this.currentScrapingJob,
        scheduledJobs: Array.from(this.scheduledJobs.keys()),
        config: {
          maxConcurrency: config.scraping.maxConcurrentRequests,
          delayBetweenRequests: config.scraping.delayBetweenRequests,
          targetUrl: config.scraping.targetUrl,
          gentleMode: config.scraping.gentleMode
        }
      });
    });

    // Start scraping
    this.app.post('/api/scrape', (req, res) => {
      try {
        if (this.isScrapingInProgress) {
          return res.status(409).json({
            error: 'Scraping operation already in progress',
            currentJob: this.currentScrapingJob
          });
        }

        // Hard limiter: enforce minimum interval between executions
        const db = getDatabase();
        const { allowed, minutesRemaining } = db.checkExecutionAllowed(MIN_INTERVAL_MS);
        if (!allowed) {
          return res.status(429).json({
            error: `Rate limited: last execution was too recent. Try again in ${minutesRemaining} minute(s).`,
            minutesRemaining
          });
        }

        const options = this._buildOptions(req.body);
        const jobId = `scrape_${Date.now()}`;

        this.currentScrapingJob = {
          id: jobId,
          startTime: new Date().toISOString(),
          options,
          status: 'starting'
        };

        this.startScrapingJob(jobId, options);

        return res.json({ message: 'Scraping operation started', jobId, options });

      } catch (error) {
        logger.error('Failed to start scraping:', error);
        return res.status(500).json({
          error: 'Failed to start scraping operation',
          message: error.message
        });
      }
    });

    // Get job status
    this.app.get('/api/scrape/:jobId', (req, res) => {
      const { jobId } = req.params;

      if (this.currentScrapingJob && this.currentScrapingJob.id === jobId) {
        return res.json(this.currentScrapingJob);
      }

      return res.status(404).json({ error: 'Job not found', jobId });
    });

    // Stop scraping
    this.app.post('/api/scrape/stop', async (req, res) => {
      try {
        if (!this.isScrapingInProgress) {
          return res.status(400).json({ error: 'No scraping operation in progress' });
        }

        if (this.scraper) {
          await this.scraper.cleanup();
        }

        this.isScrapingInProgress = false;
        this.currentScrapingJob.status = 'stopped';
        this.currentScrapingJob.endTime = new Date().toISOString();

        return res.json({
          message: 'Scraping operation stopped',
          jobId: this.currentScrapingJob.id
        });

      } catch (error) {
        logger.error('Failed to stop scraping:', error);
        return res.status(500).json({
          error: 'Failed to stop scraping operation',
          message: error.message
        });
      }
    });

    // Schedule scraping with cron expression + hard limiter enforcement
    this.app.post('/api/schedule', (req, res) => {
      try {
        const { cronExpression, options = {}, name } = req.body;

        if (!cronExpression || !cron.validate(cronExpression)) {
          return res.status(400).json({ error: 'Invalid cron expression' });
        }

        const scheduleId = name || `schedule_${Date.now()}`;

        if (this.scheduledJobs.has(scheduleId)) {
          return res.status(409).json({ error: 'Schedule with this name already exists' });
        }

        const task = cron.schedule(cronExpression, () => {
          if (this.isScrapingInProgress) {
            logger.warn('Skipping scheduled scrape — operation already in progress');
            return;
          }

          const db = getDatabase();
          const { allowed, minutesRemaining } = db.checkExecutionAllowed(MIN_INTERVAL_MS);
          if (!allowed) {
            logger.warn(`Skipping scheduled scrape — rate limited (${minutesRemaining} min remaining)`);
            return;
          }

          const jobId = `scheduled_${Date.now()}`;
          this.startScrapingJob(jobId, this._buildOptions(options));
        }, { scheduled: false });

        this.scheduledJobs.set(scheduleId, {
          task,
          cronExpression,
          options,
          createdAt: new Date().toISOString()
        });

        task.start();

        return res.json({
          message: 'Scraping scheduled successfully',
          scheduleId,
          cronExpression,
          options
        });

      } catch (error) {
        logger.error('Failed to schedule scraping:', error);
        return res.status(500).json({
          error: 'Failed to schedule scraping operation',
          message: error.message
        });
      }
    });

    // List schedules
    this.app.get('/api/schedules', (req, res) => {
      const schedules = Array.from(this.scheduledJobs.entries()).map(([id, schedule]) => ({
        id,
        cronExpression: schedule.cronExpression,
        options: schedule.options,
        createdAt: schedule.createdAt
      }));

      return res.json({ schedules });
    });

    // Delete schedule
    this.app.delete('/api/schedule/:scheduleId', (req, res) => {
      const { scheduleId } = req.params;

      if (!this.scheduledJobs.has(scheduleId)) {
        return res.status(404).json({ error: 'Schedule not found' });
      }

      const schedule = this.scheduledJobs.get(scheduleId);
      schedule.task.stop();
      this.scheduledJobs.delete(scheduleId);

      return res.json({ message: 'Schedule deleted successfully', scheduleId });
    });

    // Query CVEs from the database
    this.app.get('/api/cves', (req, res) => {
      try {
        const { severity, search, limit, offset } = req.query;
        const db = getDatabase();

        const cves = db.getCVEs({
          severity: severity || undefined,
          search: search || undefined,
          limit: parseInt(limit, 10) || 100,
          offset: parseInt(offset, 10) || 0
        });

        return res.json({
          total: db.countCVEs(),
          count: cves.length,
          cves
        });

      } catch (error) {
        logger.error('Failed to query CVEs:', error);
        return res.status(500).json({
          error: 'Failed to query CVEs',
          message: error.message
        });
      }
    });

    // Get a single CVE
    this.app.get('/api/cves/:cveId', (req, res) => {
      try {
        const db = getDatabase();
        const cve = db.getCVEById(req.params.cveId);

        if (!cve) {
          return res.status(404).json({ error: 'CVE not found', cveId: req.params.cveId });
        }

        return res.json(cve);

      } catch (error) {
        logger.error('Failed to get CVE:', error);
        return res.status(500).json({
          error: 'Failed to get CVE',
          message: error.message
        });
      }
    });

    // Scrape run history
    this.app.get('/api/runs', (req, res) => {
      try {
        const db = getDatabase();
        const limit = parseInt(req.query.limit, 10) || 20;
        return res.json({ runs: db.getRuns(limit) });
      } catch (error) {
        logger.error('Failed to get runs:', error);
        return res.status(500).json({
          error: 'Failed to get runs',
          message: error.message
        });
      }
    });

    // Analytics (computed from the database)
    this.app.post('/api/analytics', (req, res) => {
      try {
        const { data } = req.body;

        let cveData;
        if (data && data.cveData) {
          ({ cveData } = data);
        } else {
          cveData = loadCVEsFromDatabase({ limit: 100000 });
        }

        if (!Array.isArray(cveData)) {
          return res.status(400).json({ error: 'cveData must be an array' });
        }

        const analytics = generateAnalytics(cveData);

        return res.json({ generatedAt: new Date().toISOString(), analytics });

      } catch (error) {
        logger.error('Failed to generate analytics:', error);
        return res.status(500).json({
          error: 'Failed to generate analytics',
          message: error.message
        });
      }
    });

    // Checkpoint info
    this.app.get('/api/checkpoint', (req, res) => {
      try {
        const checkpoint = loadLatestCheckpoint();

        if (!checkpoint) {
          return res.status(404).json({ error: 'No checkpoint found' });
        }

        return res.json({
          checkpoint: {
            timestamp: checkpoint.timestamp,
            processedCount: checkpoint.processedCount,
            currentIndex: checkpoint.currentIndex
          }
        });

      } catch (error) {
        logger.error('Failed to get checkpoint:', error);
        return res.status(500).json({
          error: 'Failed to get checkpoint',
          message: error.message
        });
      }
    });
  }

  // ── Error handling ─────────────────────────────────────────────────────────

  setupErrorHandling() {
    // 404 catch-all
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Endpoint not found', path: req.path });
    });

    // Global error handler
    this.app.use((error, req, res, _next) => {
      logger.error('API Error:', error);
      res.status(error.status || 500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      });
    });
  }

  // ── Scraping job runner ────────────────────────────────────────────────────

  async startScrapingJob(jobId, options) {
    const db = getDatabase();

    try {
      this.isScrapingInProgress = true;
      if (this.currentScrapingJob) {
        this.currentScrapingJob.status = 'running';
      }

      db.recordExecution('api');
      db.saveRun({
        jobId,
        startedAt: new Date().toISOString(),
        status: 'running',
        options
      });

      logger.info(`Starting scraping job: ${jobId}`);

      this.scraper = new WizCVEScraper(options);
      const result = await this.scraper.scrapeAllCVEs();

      const savedCount = saveCVEsToDatabase(result.cveData);

      db.saveRun({
        jobId,
        completedAt: new Date().toISOString(),
        status: 'completed',
        totalCves: savedCount
      });

      if (this.currentScrapingJob) {
        this.currentScrapingJob.status = 'completed';
        this.currentScrapingJob.endTime = new Date().toISOString();
        this.currentScrapingJob.result = { totalCVEs: savedCount };
      }

      logger.info(`Scraping job completed: ${jobId} — ${savedCount} CVEs saved`);

    } catch (error) {
      logger.error(`Scraping job failed: ${jobId}`, error);

      db.saveRun({
        jobId,
        completedAt: new Date().toISOString(),
        status: 'failed',
        totalCves: 0,
        errorMessage: error.message
      });

      if (this.currentScrapingJob) {
        this.currentScrapingJob.status = 'failed';
        this.currentScrapingJob.endTime = new Date().toISOString();
        this.currentScrapingJob.error = error.message;
      }

    } finally {
      this.isScrapingInProgress = false;
      this.scraper = null;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  _buildOptions(body = {}) {
    const gentleMode = body.gentleMode !== undefined ? body.gentleMode : config.scraping.gentleMode;
    return {
      maxConcurrentRequests: body.maxConcurrency || config.scraping.maxConcurrentRequests,
      delayBetweenRequests: gentleMode
        ? config.scraping.gentleDelay
        : (body.delayBetweenRequests || config.scraping.delayBetweenRequests),
      retryAttempts: body.retryAttempts || config.scraping.retryAttempts,
      maxCVEs: body.maxCVEs || null,
      useComprehensiveScraping: body.useComprehensiveScraping !== undefined ? body.useComprehensiveScraping : !gentleMode,
      gentleMode
    };
  }

  // ── Startup ────────────────────────────────────────────────────────────────

  start() {
    const { port, host } = config.api;

    // Open the database (creates file + schema if needed)
    getDatabase();

    // Start cron scheduler if configured
    if (config.scheduling.cronExpression) {
      const expr = config.scheduling.cronExpression;
      if (cron.validate(expr)) {
        const task = cron.schedule(expr, () => {
          if (this.isScrapingInProgress) {
            logger.warn('Skipping auto-scheduled scrape — already in progress');
            return;
          }
          const db = getDatabase();
          const { allowed, minutesRemaining } = db.checkExecutionAllowed(MIN_INTERVAL_MS);
          if (!allowed) {
            logger.warn(`Skipping auto-scheduled scrape — rate limited (${minutesRemaining} min remaining)`);
            return;
          }
          const jobId = `auto_${Date.now()}`;
          this.startScrapingJob(jobId, this._buildOptions({}));
        });

        this.scheduledJobs.set('auto', {
          task,
          cronExpression: expr,
          options: {},
          createdAt: new Date().toISOString()
        });

        logger.info(`Auto-scheduler started with cron: "${expr}"`);
      } else {
        logger.warn(`Invalid SCRAPER_CRON expression "${expr}" — auto-scheduler disabled`);
      }
    }

    this.app.listen(port, host, () => {
      logger.info(`CVE Scraper API server started on http://${host}:${port}`);
      console.log('\n🚀 CVE Scraper API is running!');
      console.log(`📡 Server: http://${host}:${port}`);
      console.log(`📊 Health: http://${host}:${port}/health`);
      console.log(`🗄  CVEs:   http://${host}:${port}/api/cves`);
      console.log('\n📖 Key Endpoints:');
      console.log('   POST /api/scrape        — Start scraping');
      console.log('   GET  /api/cves          — Query stored CVEs');
      console.log('   GET  /api/status        — Scraper status');
      console.log('   POST /api/schedule      — Schedule with cron expression');
      console.log('   POST /api/analytics     — Generate analytics');
      console.log('   GET  /api/runs          — Scrape run history');
    });
  }
}

if (require.main === module) {
  const api = new CVEScraperAPI();
  api.start();
}

module.exports = CVEScraperAPI;
