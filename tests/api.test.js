/**
 * Comprehensive API endpoint tests using supertest.
 * External dependencies (WizCVEScraper, database) are mocked so the
 * tests are fast and deterministic.
 */

const request = require('supertest');

// ─── Mock heavy dependencies before requiring the module under test ───────────
jest.mock('../src/scraper/WizCVEScraper');

// Mock the database module
jest.mock('../src/utils/database', () => {
  const mockDb = {
    saveCVEs: jest.fn().mockReturnValue(1),
    getCVEs: jest.fn().mockReturnValue([
      {
        cveId: 'CVE-2025-0001',
        severity: 'HIGH',
        score: 8.5,
        technologies: ['Linux'],
        component: 'kernel',
        additionalResources: [],
      },
    ]),
    getCVEById: jest.fn().mockReturnValue({
      cveId: 'CVE-2025-0001',
      severity: 'HIGH',
      score: 8.5,
      technologies: ['Linux'],
      component: 'kernel',
    }),
    countCVEs: jest.fn().mockReturnValue(1),
    saveRun: jest.fn(),
    getRuns: jest.fn().mockReturnValue([]),
    saveCheckpoint: jest.fn().mockReturnValue(1),
    getLatestCheckpoint: jest.fn().mockReturnValue({
      timestamp: '2025-01-01T00:00:00.000Z',
      processedCount: 42,
      currentIndex: 42,
      data: [],
    }),
    recordExecution: jest.fn(),
    getLastExecution: jest.fn().mockReturnValue(null),
    checkExecutionAllowed: jest.fn().mockReturnValue({ allowed: true, minutesRemaining: 0 }),
    open: jest.fn(),
    close: jest.fn(),
  };

  return {
    getDatabase: jest.fn(() => mockDb),
    CVEDatabase: jest.fn(),
    _resetInstance: jest.fn(),
    _mockDb: mockDb,
  };
});

// Mock helpers that delegate to the database
jest.mock('../src/utils/helpers', () => {
  const actual = jest.requireActual('../src/utils/helpers');
  return {
    ...actual,
    saveCVEsToDatabase: jest.fn().mockReturnValue(1),
    loadCVEsFromDatabase: jest.fn().mockReturnValue([
      {
        cveId: 'CVE-2025-0001',
        severity: 'HIGH',
        score: 8.5,
        technologies: ['Linux'],
        component: 'kernel',
        additionalResources: {},
      },
    ]),
    generateAnalytics: jest.fn().mockReturnValue({
      total: 1,
      severityDistribution: { HIGH: 1 },
      averageScore: '8.50',
    }),
    loadLatestCheckpoint: jest.fn().mockReturnValue({
      timestamp: '2025-01-01T00:00:00.000Z',
      processedCount: 42,
      currentIndex: 42,
    }),
  };
});

// ─── Load the API after mocks are in place ────────────────────────────────────
const CVEScraperAPI = require('../src/api');
const { getDatabase } = require('../src/utils/database');

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────
describe('CVEScraperAPI — HTTP endpoints', () => {
  let api;
  let app;
  let mockDb;

  beforeEach(() => {
    api = new CVEScraperAPI();
    app = api.app;
    mockDb = getDatabase();
    // Reset rate limiter mock to allow scraping by default
    mockDb.checkExecutionAllowed.mockReturnValue({ allowed: true, minutesRemaining: 0 });
  });

  // ── Health check ──────────────────────────────────────────────────────────
  describe('GET /health', () => {
    test('returns 200 with status: healthy', async () => {
      const res = await request(app).get('/health');
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.version).toBe('1.0.0');
      expect(typeof res.body.uptime).toBe('number');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  // ── Status ────────────────────────────────────────────────────────────────
  describe('GET /api/status', () => {
    test('returns current scraping state', async () => {
      const res = await request(app).get('/api/status');
      expect(res.statusCode).toBe(200);
      expect(res.body.isScrapingInProgress).toBe(false);
      expect(res.body.currentJob).toBeNull();
      expect(Array.isArray(res.body.scheduledJobs)).toBe(true);
    });
  });

  // ── POST /api/scrape ──────────────────────────────────────────────────────
  describe('POST /api/scrape', () => {
    test('starts a scraping job and returns 200', async () => {
      const res = await request(app)
        .post('/api/scrape')
        .send({});
      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/started/i);
      expect(res.body.jobId).toMatch(/^scrape_/);
    });

    test('returns 409 when a scrape is already in progress', async () => {
      api.isScrapingInProgress = true;
      api.currentScrapingJob = { id: 'scrape_1', status: 'running' };

      const res = await request(app)
        .post('/api/scrape')
        .send({});
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toMatch(/already in progress/i);
    });

    test('returns 429 when rate limiter blocks the request', async () => {
      mockDb.checkExecutionAllowed.mockReturnValueOnce({ allowed: false, minutesRemaining: 45 });

      const res = await request(app)
        .post('/api/scrape')
        .send({});
      expect(res.statusCode).toBe(429);
      expect(res.body.error).toMatch(/rate limited/i);
      expect(res.body.minutesRemaining).toBe(45);
    });
  });

  // ── GET /api/scrape/:jobId ────────────────────────────────────────────────
  describe('GET /api/scrape/:jobId', () => {
    test('returns job details when jobId matches current job', async () => {
      const jobId = 'scrape_12345';
      api.currentScrapingJob = { id: jobId, status: 'running' };

      const res = await request(app).get(`/api/scrape/${jobId}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.id).toBe(jobId);
    });

    test('returns 404 for unknown jobId', async () => {
      const res = await request(app).get('/api/scrape/nonexistent');
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  // ── POST /api/scrape/stop ─────────────────────────────────────────────────
  describe('POST /api/scrape/stop', () => {
    test('returns 400 when no scrape is running', async () => {
      const res = await request(app).post('/api/scrape/stop');
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/no scraping operation/i);
    });

    test('stops a running scrape', async () => {
      api.isScrapingInProgress = true;
      api.currentScrapingJob = { id: 'scrape_999', status: 'running' };

      const mockCleanup = jest.fn().mockResolvedValue();
      api.scraper = { cleanup: mockCleanup };

      const res = await request(app).post('/api/scrape/stop');
      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/stopped/i);
      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });
  });

  // ── POST /api/schedule ────────────────────────────────────────────────────
  describe('POST /api/schedule', () => {
    test('creates a schedule with a valid cron expression', async () => {
      const res = await request(app)
        .post('/api/schedule')
        .send({ cronExpression: '0 * * * *', name: 'hourly' });
      expect(res.statusCode).toBe(200);
      expect(res.body.scheduleId).toBe('hourly');
      expect(res.body.cronExpression).toBe('0 * * * *');
    });

    test('returns 400 for invalid cron expression', async () => {
      const res = await request(app)
        .post('/api/schedule')
        .send({ cronExpression: 'not-a-cron' });
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/invalid cron/i);
    });

    test('returns 409 when schedule name already exists', async () => {
      await request(app)
        .post('/api/schedule')
        .send({ cronExpression: '0 * * * *', name: 'my-job' });

      const res = await request(app)
        .post('/api/schedule')
        .send({ cronExpression: '0 * * * *', name: 'my-job' });

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toMatch(/already exists/i);
    });
  });

  // ── GET /api/schedules ────────────────────────────────────────────────────
  describe('GET /api/schedules', () => {
    test('returns empty list initially', async () => {
      const res = await request(app).get('/api/schedules');
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.schedules)).toBe(true);
    });

    test('lists created schedules', async () => {
      await request(app)
        .post('/api/schedule')
        .send({ cronExpression: '*/5 * * * *', name: 'five-min' });

      const res = await request(app).get('/api/schedules');
      expect(res.body.schedules.some(s => s.id === 'five-min')).toBe(true);
    });
  });

  // ── DELETE /api/schedule/:scheduleId ─────────────────────────────────────
  describe('DELETE /api/schedule/:scheduleId', () => {
    test('deletes an existing schedule', async () => {
      await request(app)
        .post('/api/schedule')
        .send({ cronExpression: '0 0 * * *', name: 'daily' });

      const res = await request(app).delete('/api/schedule/daily');
      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/deleted/i);
    });

    test('returns 404 for non-existent schedule', async () => {
      const res = await request(app).delete('/api/schedule/ghost');
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  // ── GET /api/cves ─────────────────────────────────────────────────────────
  describe('GET /api/cves', () => {
    test('returns CVE list from database', async () => {
      const res = await request(app).get('/api/cves');
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.cves)).toBe(true);
      expect(typeof res.body.total).toBe('number');
      expect(typeof res.body.count).toBe('number');
    });

    test('passes query params to database', async () => {
      const res = await request(app).get('/api/cves?severity=HIGH&limit=10');
      expect(res.statusCode).toBe(200);
      expect(mockDb.getCVEs).toHaveBeenCalledWith(expect.objectContaining({
        severity: 'HIGH',
        limit: 10,
      }));
    });
  });

  // ── GET /api/cves/:cveId ──────────────────────────────────────────────────
  describe('GET /api/cves/:cveId', () => {
    test('returns a specific CVE', async () => {
      const res = await request(app).get('/api/cves/CVE-2025-0001');
      expect(res.statusCode).toBe(200);
      expect(res.body.cveId).toBe('CVE-2025-0001');
    });

    test('returns 404 when CVE is not found', async () => {
      mockDb.getCVEById.mockReturnValueOnce(null);
      const res = await request(app).get('/api/cves/CVE-9999-99999');
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  // ── GET /api/runs ─────────────────────────────────────────────────────────
  describe('GET /api/runs', () => {
    test('returns list of scrape runs', async () => {
      const res = await request(app).get('/api/runs');
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.runs)).toBe(true);
    });
  });

  // ── POST /api/analytics ───────────────────────────────────────────────────
  describe('POST /api/analytics', () => {
    test('returns analytics when inline data is provided', async () => {
      const res = await request(app)
        .post('/api/analytics')
        .send({
          data: {
            cveData: [
              {
                cveId: 'CVE-2025-0001',
                severity: 'HIGH',
                score: 8.5,
                technologies: ['Linux'],
                component: 'kernel',
                additionalResources: {},
              },
            ],
          },
        });
      expect(res.statusCode).toBe(200);
      expect(res.body.analytics).toBeDefined();
    });

    test('loads CVEs from database when no data provided', async () => {
      const res = await request(app)
        .post('/api/analytics')
        .send({});
      expect(res.statusCode).toBe(200);
      expect(res.body.analytics).toBeDefined();
    });
  });

  // ── GET /api/checkpoint ───────────────────────────────────────────────────
  describe('GET /api/checkpoint', () => {
    test('returns checkpoint information', async () => {
      const res = await request(app).get('/api/checkpoint');
      expect(res.statusCode).toBe(200);
      expect(res.body.checkpoint.processedCount).toBe(42);
    });

    test('returns 404 when no checkpoint exists', async () => {
      const { loadLatestCheckpoint } = require('../src/utils/helpers');
      loadLatestCheckpoint.mockReturnValueOnce(null);

      const res = await request(app).get('/api/checkpoint');
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/no checkpoint/i);
    });
  });

  // ── 404 catch-all ─────────────────────────────────────────────────────────
  describe('Unknown routes', () => {
    test('returns 404 for unregistered GET route', async () => {
      const res = await request(app).get('/api/does-not-exist');
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    test('returns 404 for unregistered POST route', async () => {
      const res = await request(app).post('/api/does-not-exist').send({});
      expect(res.statusCode).toBe(404);
    });
  });
});
