const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs-extra');
const cron = require('node-cron');
const WizCVEScraper = require('./scraper/WizCVEScraper');
const logger = require('./utils/logger');
const { 
  saveToJson, 
  loadFromJson, 
  generateAnalytics,
  loadLatestCheckpoint 
} = require('./utils/helpers');
const config = require('./config');

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

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet());
    
    // CORS middleware
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true
    }));
    
    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // Request logging middleware
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
    
    // Static file serving for output files
    this.app.use('/output', express.static(config.paths.output));
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        uptime: process.uptime()
      });
    });

    // Get API status and configuration
    this.app.get('/api/status', (req, res) => {
      res.json({
        isScrapingInProgress: this.isScrapingInProgress,
        currentJob: this.currentScrapingJob,
        scheduledJobs: Array.from(this.scheduledJobs.keys()),
        config: {
          maxConcurrency: config.scraping.maxConcurrency,
          delayBetweenRequests: config.scraping.delayBetweenRequests,
          targetUrl: config.scraping.targetUrl
        }
      });
    });

    // Start scraping operation
    this.app.post('/api/scrape', (req, res) => {
      try {
        if (this.isScrapingInProgress) {
          return res.status(409).json({
            error: 'Scraping operation already in progress',
            currentJob: this.currentScrapingJob
          });
        }

        const options = {
          maxConcurrency: req.body.maxConcurrency || config.scraping.maxConcurrency,
          delayBetweenRequests: req.body.delayBetweenRequests || config.scraping.delayBetweenRequests,
          retryAttempts: req.body.retryAttempts || config.scraping.retryAttempts,
          maxCVEs: req.body.maxCVEs || null,
          outputFilename: req.body.outputFilename || config.output.filename
        };

        const jobId = `scrape_${Date.now()}`;
        this.currentScrapingJob = {
          id: jobId,
          startTime: new Date().toISOString(),
          options,
          status: 'starting'
        };

        // Start scraping in background
        this.startScrapingJob(jobId, options);

        res.json({
          message: 'Scraping operation started',
          jobId,
          options
        });

      } catch (error) {
        logger.error('Failed to start scraping:', error);
        res.status(500).json({
          error: 'Failed to start scraping operation',
          message: error.message
        });
      }
    });

    // Get scraping job status
    this.app.get('/api/scrape/:jobId', (req, res) => {
      const { jobId } = req.params;
      
      if (this.currentScrapingJob && this.currentScrapingJob.id === jobId) {
        res.json(this.currentScrapingJob);
      } else {
        res.status(404).json({
          error: 'Job not found',
          jobId
        });
      }
    });

    // Stop current scraping operation
    this.app.post('/api/scrape/stop', async (req, res) => {
      try {
        if (!this.isScrapingInProgress) {
          return res.status(400).json({
            error: 'No scraping operation in progress'
          });
        }

        if (this.scraper) {
          await this.scraper.cleanup();
        }

        this.isScrapingInProgress = false;
        this.currentScrapingJob.status = 'stopped';
        this.currentScrapingJob.endTime = new Date().toISOString();

        res.json({
          message: 'Scraping operation stopped',
          jobId: this.currentScrapingJob.id
        });

      } catch (error) {
        logger.error('Failed to stop scraping:', error);
        res.status(500).json({
          error: 'Failed to stop scraping operation',
          message: error.message
        });
      }
    });

    // Schedule scraping operation
    this.app.post('/api/schedule', (req, res) => {
      try {
        const { cronExpression, options = {}, name } = req.body;

        if (!cronExpression || !cron.validate(cronExpression)) {
          return res.status(400).json({
            error: 'Invalid cron expression'
          });
        }

        const scheduleId = name || `schedule_${Date.now()}`;

        if (this.scheduledJobs.has(scheduleId)) {
          return res.status(409).json({
            error: 'Schedule with this name already exists'
          });
        }

        const task = cron.schedule(cronExpression, () => {
          if (!this.isScrapingInProgress) {
            const jobId = `scheduled_${Date.now()}`;
            this.startScrapingJob(jobId, options);
          } else {
            logger.warn('Skipping scheduled scrape - operation already in progress');
          }
        }, {
          scheduled: false
        });

        this.scheduledJobs.set(scheduleId, {
          task,
          cronExpression,
          options,
          createdAt: new Date().toISOString()
        });

        task.start();

        res.json({
          message: 'Scraping scheduled successfully',
          scheduleId,
          cronExpression,
          options
        });

      } catch (error) {
        logger.error('Failed to schedule scraping:', error);
        res.status(500).json({
          error: 'Failed to schedule scraping operation',
          message: error.message
        });
      }
    });

    // List scheduled jobs
    this.app.get('/api/schedules', (req, res) => {
      const schedules = Array.from(this.scheduledJobs.entries()).map(([id, schedule]) => ({
        id,
        cronExpression: schedule.cronExpression,
        options: schedule.options,
        createdAt: schedule.createdAt
      }));

      res.json({ schedules });
    });

    // Delete scheduled job
    this.app.delete('/api/schedule/:scheduleId', (req, res) => {
      const { scheduleId } = req.params;
      
      if (!this.scheduledJobs.has(scheduleId)) {
        return res.status(404).json({
          error: 'Schedule not found'
        });
      }

      const schedule = this.scheduledJobs.get(scheduleId);
      schedule.task.stop();
      this.scheduledJobs.delete(scheduleId);

      res.json({
        message: 'Schedule deleted successfully',
        scheduleId
      });
    });

    // Get analytics for a data file
    this.app.post('/api/analytics', async (req, res) => {
      try {
        const { filePath, data } = req.body;
        
        let cveData;
        if (filePath) {
          const { cveData: fileCveData } = await loadFromJson(path.resolve(filePath));
          cveData = fileCveData;
        } else if (data && data.cveData) {
          ({ cveData } = data);
        } else {
          return res.status(400).json({
            error: 'Either filePath or data must be provided'
          });
        }

        const analytics = generateAnalytics(cveData);
        
        res.json({
          generatedAt: new Date().toISOString(),
          analytics
        });

      } catch (error) {
        logger.error('Failed to generate analytics:', error);
        res.status(500).json({
          error: 'Failed to generate analytics',
          message: error.message
        });
      }
    });

    // List available output files
    this.app.get('/api/files', async (req, res) => {
      try {
        const outputDir = config.paths.output;
        await fs.ensureDir(outputDir);
        
        const files = await fs.readdir(outputDir);
        const jsonFiles = files
          .filter(file => file.endsWith('.json'))
          .map(async (file) => {
            const filePath = path.join(outputDir, file);
            const stats = await fs.stat(filePath);
            return {
              name: file,
              path: `/output/${file}`,
              size: stats.size,
              createdAt: stats.birthtime,
              modifiedAt: stats.mtime
            };
          });

        const fileDetails = await Promise.all(jsonFiles);
        
        res.json({
          files: fileDetails.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        });

      } catch (error) {
        logger.error('Failed to list files:', error);
        res.status(500).json({
          error: 'Failed to list files',
          message: error.message
        });
      }
    });

    // Get checkpoint information
    this.app.get('/api/checkpoint', async (req, res) => {
      try {
        const checkpoint = await loadLatestCheckpoint();
        
        if (!checkpoint) {
          return res.status(404).json({
            error: 'No checkpoint found'
          });
        }

        res.json({
          checkpoint: {
            timestamp: checkpoint.timestamp,
            processedCount: checkpoint.processedCount,
            currentIndex: checkpoint.currentIndex
          }
        });

      } catch (error) {
        logger.error('Failed to get checkpoint:', error);
        res.status(500).json({
          error: 'Failed to get checkpoint',
          message: error.message
        });
      }
    });
  }

  setupErrorHandling() {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        path: req.path
      });
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

  async startScrapingJob(jobId, options) {
    try {
      this.isScrapingInProgress = true;
      this.currentScrapingJob.status = 'running';
      
      logger.info(`Starting scraping job: ${jobId}`);
      
      this.scraper = new WizCVEScraper(options);
      const result = await this.scraper.scrapeAllCVEs();
      
      // Save results
      const outputPath = await saveToJson(options.outputFilename || config.output.filename, result);
      
      // Generate analytics
      if (result.cveData.length > 0) {
        const analytics = generateAnalytics(result.cveData);
        const analyticsResult = {
          generatedAt: new Date().toISOString(),
          dataSource: outputPath,
          analytics
        };
        
        await saveToJson(`${options.outputFilename || config.output.filename}_analytics`, analyticsResult);
      }
      
      this.currentScrapingJob.status = 'completed';
      this.currentScrapingJob.endTime = new Date().toISOString();
      this.currentScrapingJob.result = {
        totalCVEs: result.totalCVEs,
        outputPath
      };
      
      logger.info(`Scraping job completed: ${jobId}`);
      
    } catch (error) {
      logger.error(`Scraping job failed: ${jobId}`, error);
      
      this.currentScrapingJob.status = 'failed';
      this.currentScrapingJob.endTime = new Date().toISOString();
      this.currentScrapingJob.error = error.message;
      
    } finally {
      this.isScrapingInProgress = false;
      
      if (this.scraper) {
        await this.scraper.cleanup();
        this.scraper = null;
      }
    }
  }

  async start() {
    const { port } = config.api;
    const { host } = config.api;
    
    // Ensure required directories exist
    await fs.ensureDir(config.paths.output);
    await fs.ensureDir(config.paths.logs);
    await fs.ensureDir(config.paths.checkpoints);
    
    this.app.listen(port, host, () => {
      logger.info(`CVE Scraper API server started on http://${host}:${port}`);
      console.log('\n🚀 CVE Scraper API is running!');
      console.log(`📡 Server: http://${host}:${port}`);
      console.log(`📊 Health Check: http://${host}:${port}/health`);
      console.log(`📁 Output Files: http://${host}:${port}/output`);
      console.log('\n📖 API Endpoints:');
      console.log('   POST /api/scrape - Start scraping');
      console.log('   GET  /api/status - Get status');
      console.log('   POST /api/schedule - Schedule scraping');
      console.log('   POST /api/analytics - Generate analytics');
      console.log('   GET  /api/files - List output files');
    });
  }
}

// Start the API server if this file is executed directly
if (require.main === module) {
  const api = new CVEScraperAPI();
  api.start().catch(error => {
    logger.error('Failed to start API server:', error);
    process.exit(1);
  });
}

module.exports = CVEScraperAPI;