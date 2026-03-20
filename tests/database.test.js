/**
 * Unit tests for src/utils/database.js
 *
 * Each test suite opens a fresh in-memory (or temp-file) database so that
 * tests are fully isolated and do not rely on filesystem state.
 */

const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { CVEDatabase, _resetInstance } = require('../src/utils/database');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpPath() {
  return path.join(os.tmpdir(), `wiz-test-db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function openFreshDb() {
  const db = new CVEDatabase(makeTmpPath());
  db.open();
  return db;
}

function makeCVE(overrides = {}) {
  return {
    cveId: 'CVE-2025-00001',
    severity: 'HIGH',
    score: 8.5,
    technologies: ['Linux', 'Apache'],
    component: 'httpd',
    publishedDate: '2025-01-01',
    detailUrl: 'https://example.com/cve',
    description: 'A test vulnerability',
    sourceUrl: 'https://nvd.nist.gov',
    hasCisaKevExploit: false,
    hasFix: true,
    isHighProfileThreat: false,
    exploitable: false,
    additionalResources: [{ title: 'NVD', url: 'https://nvd.nist.gov' }],
    ...overrides,
  };
}

// Close and clean up a database
function closeAndClean(db) {
  const p = db.dbPath;
  db.close();
  try { fs.removeSync(p); } catch { /* best-effort */ }
  try { fs.removeSync(`${p}-wal`); } catch { /* best-effort */ }
  try { fs.removeSync(`${p}-shm`); } catch { /* best-effort */ }
}

afterAll(() => {
  _resetInstance();
});

// ─────────────────────────────────────────────────────────────────────────────
// Constructor & open
// ─────────────────────────────────────────────────────────────────────────────
describe('CVEDatabase — constructor', () => {
  test('throws when dbPath is not provided', () => {
    expect(() => new CVEDatabase()).toThrow('dbPath is required');
  });

  test('opens successfully with a valid path', () => {
    const db = openFreshDb();
    expect(db.db).not.toBeNull();
    closeAndClean(db);
  });

  test('open() is idempotent (safe to call twice)', () => {
    const db = openFreshDb();
    expect(() => db.open()).not.toThrow();
    closeAndClean(db);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveCVEs / getCVEs / getCVEById / countCVEs
// ─────────────────────────────────────────────────────────────────────────────
describe('CVEDatabase — CVE operations', () => {
  let db;

  beforeEach(() => { db = openFreshDb(); });
  afterEach(() => { closeAndClean(db); });

  test('saveCVEs returns the number of CVEs processed', () => {
    const count = db.saveCVEs([makeCVE(), makeCVE({ cveId: 'CVE-2025-00002' })]);
    expect(count).toBe(2);
  });

  test('saveCVEs handles an empty array gracefully', () => {
    expect(db.saveCVEs([])).toBe(0);
  });

  test('getCVEs returns saved CVEs', () => {
    db.saveCVEs([makeCVE()]);
    const rows = db.getCVEs();
    expect(rows.length).toBe(1);
    expect(rows[0].cveId).toBe('CVE-2025-00001');
  });

  test('getCVEById returns the correct CVE', () => {
    db.saveCVEs([makeCVE()]);
    const cve = db.getCVEById('CVE-2025-00001');
    expect(cve).not.toBeNull();
    expect(cve.cveId).toBe('CVE-2025-00001');
    expect(cve.severity).toBe('HIGH');
    expect(cve.score).toBe(8.5);
  });

  test('getCVEById returns null for unknown ID', () => {
    expect(db.getCVEById('CVE-9999-99999')).toBeNull();
  });

  test('countCVEs reflects the number of stored CVEs', () => {
    expect(db.countCVEs()).toBe(0);
    db.saveCVEs([makeCVE(), makeCVE({ cveId: 'CVE-2025-00002' })]);
    expect(db.countCVEs()).toBe(2);
  });

  test('upsert updates an existing CVE', () => {
    db.saveCVEs([makeCVE({ severity: 'LOW' })]);
    db.saveCVEs([makeCVE({ severity: 'CRITICAL' })]);
    const rows = db.getCVEs();
    expect(rows.length).toBe(1);
    expect(rows[0].severity).toBe('CRITICAL');
  });

  test('getCVEs filters by severity', () => {
    db.saveCVEs([
      makeCVE({ cveId: 'CVE-2025-00001', severity: 'HIGH' }),
      makeCVE({ cveId: 'CVE-2025-00002', severity: 'LOW' }),
    ]);
    const rows = db.getCVEs({ severity: 'HIGH' });
    expect(rows.length).toBe(1);
    expect(rows[0].severity).toBe('HIGH');
  });

  test('getCVEs filters by search string', () => {
    db.saveCVEs([
      makeCVE({ cveId: 'CVE-2025-00001', component: 'openssl' }),
      makeCVE({ cveId: 'CVE-2025-00002', component: 'nginx' }),
    ]);
    const rows = db.getCVEs({ search: 'openssl' });
    expect(rows.length).toBe(1);
    expect(rows[0].component).toBe('openssl');
  });

  test('getCVEs respects limit and offset', () => {
    db.saveCVEs([
      makeCVE({ cveId: 'CVE-2025-00001' }),
      makeCVE({ cveId: 'CVE-2025-00002' }),
      makeCVE({ cveId: 'CVE-2025-00003' }),
    ]);
    const page1 = db.getCVEs({ limit: 2, offset: 0 });
    const page2 = db.getCVEs({ limit: 2, offset: 2 });
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(1);
  });

  test('technologies are serialized and deserialized correctly', () => {
    db.saveCVEs([makeCVE({ technologies: ['Linux', 'Python', 'Apache'] })]);
    const cve = db.getCVEById('CVE-2025-00001');
    expect(cve.technologies).toEqual(['Linux', 'Python', 'Apache']);
  });

  test('boolean fields are deserialized correctly', () => {
    db.saveCVEs([makeCVE({ hasCisaKevExploit: true, hasFix: false })]);
    const cve = db.getCVEById('CVE-2025-00001');
    expect(cve.hasCisaKevExploit).toBe(true);
    expect(cve.hasFix).toBe(false);
  });

  test('additionalResources JSON round-trips correctly', () => {
    const resources = [{ title: 'NVD', url: 'https://nvd.nist.gov' }];
    db.saveCVEs([makeCVE({ additionalResources: resources })]);
    const cve = db.getCVEById('CVE-2025-00001');
    expect(cve.additionalResources).toEqual(resources);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveRun / getRuns
// ─────────────────────────────────────────────────────────────────────────────
describe('CVEDatabase — scrape run tracking', () => {
  let db;

  beforeEach(() => { db = openFreshDb(); });
  afterEach(() => { closeAndClean(db); });

  test('saveRun inserts a new run and getRuns returns it', () => {
    db.saveRun({ jobId: 'job-1', startedAt: new Date().toISOString(), status: 'running' });
    const runs = db.getRuns();
    expect(runs.length).toBe(1);
    expect(runs[0].jobId).toBe('job-1');
    expect(runs[0].status).toBe('running');
  });

  test('saveRun updates an existing run', () => {
    db.saveRun({ jobId: 'job-2', startedAt: new Date().toISOString(), status: 'running' });
    db.saveRun({ jobId: 'job-2', completedAt: new Date().toISOString(), status: 'completed', totalCves: 50 });
    const runs = db.getRuns();
    expect(runs[0].status).toBe('completed');
    expect(runs[0].totalCves).toBe(50);
  });

  test('throws when jobId is missing', () => {
    expect(() => db.saveRun({})).toThrow('run.jobId is required');
  });

  test('getRuns respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      db.saveRun({ jobId: `job-${i}`, startedAt: new Date().toISOString() });
    }
    const runs = db.getRuns(3);
    expect(runs.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveCheckpoint / getLatestCheckpoint
// ─────────────────────────────────────────────────────────────────────────────
describe('CVEDatabase — checkpoint management', () => {
  let db;

  beforeEach(() => { db = openFreshDb(); });
  afterEach(() => { closeAndClean(db); });

  test('getLatestCheckpoint returns null when there are no checkpoints', () => {
    expect(db.getLatestCheckpoint()).toBeNull();
  });

  test('saveCheckpoint persists and getLatestCheckpoint retrieves it', () => {
    const cves = [makeCVE()];
    db.saveCheckpoint(cves, 10);

    const cp = db.getLatestCheckpoint();
    expect(cp).not.toBeNull();
    expect(cp.processedCount).toBe(1);
    expect(cp.currentIndex).toBe(10);
    expect(cp.data).toHaveLength(1);
    expect(cp.data[0].cveId).toBe('CVE-2025-00001');
  });

  test('getLatestCheckpoint returns the most recent checkpoint', () => {
    db.saveCheckpoint([makeCVE()], 5);
    db.saveCheckpoint([makeCVE(), makeCVE({ cveId: 'CVE-2025-00002' })], 15);

    const cp = db.getLatestCheckpoint();
    expect(cp.processedCount).toBe(2);
    expect(cp.currentIndex).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recordExecution / getLastExecution / checkExecutionAllowed
// ─────────────────────────────────────────────────────────────────────────────
describe('CVEDatabase — execution rate limiting', () => {
  let db;

  beforeEach(() => { db = openFreshDb(); });
  afterEach(() => { closeAndClean(db); });

  test('getLastExecution returns null with no prior executions', () => {
    expect(db.getLastExecution()).toBeNull();
  });

  test('recordExecution stores an entry and getLastExecution returns it', () => {
    db.recordExecution('test');
    const last = db.getLastExecution();
    expect(last).not.toBeNull();
    expect(typeof last).toBe('string');
  });

  test('checkExecutionAllowed returns true with no prior execution', () => {
    const { allowed } = db.checkExecutionAllowed(3600000);
    expect(allowed).toBe(true);
  });

  test('checkExecutionAllowed returns false when interval has not elapsed', () => {
    db.recordExecution();
    const { allowed, minutesRemaining } = db.checkExecutionAllowed(3600000);
    expect(allowed).toBe(false);
    expect(minutesRemaining).toBeGreaterThan(0);
  });

  test('checkExecutionAllowed returns true when interval has elapsed', () => {
    // Simulate an old execution by inserting directly
    db.db.prepare("INSERT INTO execution_log (executed_at) VALUES (datetime('now', '-2 hours'))").run();
    const { allowed } = db.checkExecutionAllowed(3600000);
    expect(allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// close
// ─────────────────────────────────────────────────────────────────────────────
describe('CVEDatabase — lifecycle', () => {
  test('close() is safe to call multiple times', () => {
    const db = openFreshDb();
    expect(() => { db.close(); db.close(); }).not.toThrow();
    try { fs.removeSync(db.dbPath); } catch { /* best-effort */ }
  });
});
