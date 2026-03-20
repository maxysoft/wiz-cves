/**
 * Comprehensive API endpoint tests using supertest.
 * All external dependencies (WizCVEScraper, file I/O) are mocked so the
 * tests are fast and deterministic.
 */

const request = require('supertest');

// ─── Mock heavy dependencies before requiring the module under test ───────────
jest.mock('../src/scraper/WizCVEScraper');
jest.mock('../src/utils/helpers', () => {
  const actual = jest.requireActual('../src/utils/helpers');
  return {
    ...actual,
    saveToJson: jest.fn().mockResolvedValue('/tmp/output/cve_data_latest.json'),
    loadFromJson: jest.fn().mockResolvedValue({
      cveData: [
        {
          cveId: 'CVE-2025-0001',
          severity: 'HIGH',
          score: 8.5,
          technologies: ['Linux'],
          component: 'kernel',
          additionalResources: {}
        }
      ]
    }),
    generateAnalytics: jest.fn().mockReturnValue({
      total: 1,
      severityDistribution: { HIGH: 1 },
      averageScore: '8.50'
    }),
    loadLatestCheckpoint: jest.fn().mockResolvedValue({
      timestamp: '2025-01-01T00:00:00.000Z',
      processedCount: 42,
      currentIndex: 42
    })
  };
});

jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(),
  ensureDirSync: jest.fn(),
  readdir: jest.fn().mockResolvedValue(['cve_data_latest.json']),
  stat: jest.fn().mockResolvedValue({
    size: 1024,
    birthtime: new Date('2025-01-01'),
    mtime: new Date('2025-01-02')
  }),
  static: jest.fn()
}));

// ─── Load the API after mocks are in place ────────────────────────────────────
const CVEScraperAPI = require('../src/api');

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────
describe('CVEScraperAPI — HTTP endpoints', () => {
  let api;
  let app;

  beforeEach(() => {
    api = new CVEScraperAPI();
    app = api.app;
  });

  // ── Health check ────────────────────────────────────────────────────────────
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

  // ── Status ──────────────────────────────────────────────────────────────────
  describe('GET /api/status', () => {
    test('returns current scraping state', async () => {
      const res = await request(app).get('/api/status');
      expect(res.statusCode).toBe(200);
      expect(res.body.isScrapingInProgress).toBe(false);
      expect(res.body.currentJob).toBeNull();
      expect(Array.isArray(res.body.scheduledJobs)).toBe(true);
    });
  });

  // ── POST /api/scrape ────────────────────────────────────────────────────────
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
      // Simulate a job already running
      api.isScrapingInProgress = true;
      api.currentScrapingJob = { id: 'scrape_1', status: 'running' };

      const res = await request(app)
        .post('/api/scrape')
        .send({});
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toMatch(/already in progress/i);
    });
  });

  // ── GET /api/scrape/:jobId ──────────────────────────────────────────────────
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

  // ── POST /api/scrape/stop ───────────────────────────────────────────────────
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

  // ── POST /api/schedule ──────────────────────────────────────────────────────
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

  // ── GET /api/schedules ──────────────────────────────────────────────────────
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

  // ── DELETE /api/schedule/:scheduleId ────────────────────────────────────────
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

  // ── POST /api/analytics ─────────────────────────────────────────────────────
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
                additionalResources: {}
              }
            ]
          }
        });
      expect(res.statusCode).toBe(200);
      expect(res.body.analytics).toBeDefined();
    });

    test('returns analytics when filePath is provided', async () => {
      const res = await request(app)
        .post('/api/analytics')
        .send({ filePath: '/tmp/mock_cve_data.json' });
      expect(res.statusCode).toBe(200);
      expect(res.body.analytics).toBeDefined();
    });

    test('returns 400 when neither filePath nor data is provided', async () => {
      const res = await request(app)
        .post('/api/analytics')
        .send({});
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/filePath or data/i);
    });
  });

  // ── GET /api/files ──────────────────────────────────────────────────────────
  describe('GET /api/files', () => {
    test('returns a list of output files', async () => {
      const res = await request(app).get('/api/files');
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.files)).toBe(true);
    });
  });

  // ── GET /api/checkpoint ─────────────────────────────────────────────────────
  describe('GET /api/checkpoint', () => {
    test('returns checkpoint information', async () => {
      const res = await request(app).get('/api/checkpoint');
      expect(res.statusCode).toBe(200);
      expect(res.body.checkpoint.processedCount).toBe(42);
    });

    test('returns 404 when no checkpoint exists', async () => {
      const { loadLatestCheckpoint } = require('../src/utils/helpers');
      loadLatestCheckpoint.mockResolvedValueOnce(null);

      const res = await request(app).get('/api/checkpoint');
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/no checkpoint/i);
    });
  });

  // ── 404 catch-all ───────────────────────────────────────────────────────────
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
