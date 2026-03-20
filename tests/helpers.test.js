/**
 * Comprehensive tests for the helpers module.
 * Covers all exported functions with happy-path, edge, and error cases.
 *
 * Global helpers (createTempDir, cleanupTempDir) are injected by
 * tests/setup.js which runs before every test suite via jest's
 * setupFilesAfterEnv configuration.
 */

const path = require('path');
const os = require('os');
const fs = require('fs-extra');

const {
  sleep,
  retryWithBackoff,
  ensureDir,
  saveToJson,
  loadFromJson,
  validateCVEData,
  cleanText,
  parseCVSSScore,
  generateAnalytics,
  extractBaseUrls
} = require('../src/utils/helpers');

// ─────────────────────────────────────────────────────────────────────────────
// sleep
// ─────────────────────────────────────────────────────────────────────────────
describe('sleep', () => {
  test('resolves after approximately the specified delay', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  test('returns a Promise', () => {
    const result = sleep(0);
    expect(result).toBeInstanceOf(Promise);
    return result;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retryWithBackoff
// ─────────────────────────────────────────────────────────────────────────────
describe('retryWithBackoff', () => {
  test('returns immediately on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, 3, 10);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on failure and succeeds eventually', async () => {
    let calls = 0;
    const fn = jest.fn().mockImplementation(() => {
      calls++;
      if (calls < 3) { throw new Error('temporary'); }
      return Promise.resolve('recovered');
    });

    const result = await retryWithBackoff(fn, 3, 1);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('throws after exhausting all attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));
    await expect(retryWithBackoff(fn, 2, 1)).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ensureDir
// ─────────────────────────────────────────────────────────────────────────────
describe('ensureDir', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tmpDir);
  });

  test('creates a new directory that does not exist', async () => {
    const target = path.join(tmpDir, 'new', 'nested', 'dir');
    await ensureDir(target);
    expect(await fs.pathExists(target)).toBe(true);
  });

  test('does not throw when directory already exists', async () => {
    await expect(ensureDir(tmpDir)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveToJson / loadFromJson
// ─────────────────────────────────────────────────────────────────────────────
describe('saveToJson and loadFromJson', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tmpDir);
  });

  test('saves data and can reload it', async () => {
    const payload = { foo: 'bar', count: 42 };
    const savedPath = await saveToJson('test_file', payload, tmpDir, false);
    expect(await fs.pathExists(savedPath)).toBe(true);

    const loaded = await loadFromJson(savedPath);
    expect(loaded).toMatchObject(payload);
  });

  test('creates a timestamped subfolder when flag is set', async () => {
    const savedPath = await saveToJson('test_ts', { x: 1 }, tmpDir, true);
    // The path should contain a 'scrape_' subfolder
    expect(savedPath).toContain('scrape_');
  });

  test('also writes a _latest.json to the output dir', async () => {
    await saveToJson('my_data', { hello: 'world' }, tmpDir, false);
    const latestPath = path.join(tmpDir, 'my_data_latest.json');
    expect(await fs.pathExists(latestPath)).toBe(true);
  });

  test('loadFromJson throws on non-existent file', async () => {
    await expect(loadFromJson('/tmp/does_not_exist.json')).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateCVEData
// ─────────────────────────────────────────────────────────────────────────────
describe('validateCVEData', () => {
  const validCVE = {
    cveId: 'CVE-2025-12345',
    severity: 'HIGH',
    score: 8.5,
    technologies: ['Linux', 'Apache'],
    component: 'httpd',
    publishedDate: 'Jan 05, 2025',
    detailUrl: 'https://example.com/cve',
    additionalResources: [
      { title: 'NVD', url: 'https://nvd.nist.gov/vuln/detail/CVE-2025-12345' }
    ]
  };

  test('passes for a fully valid CVE object', () => {
    const { error } = validateCVEData(validCVE);
    expect(error).toBeUndefined();
  });

  test('accepts all valid severity values', () => {
    ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].forEach(sev => {
      const { error } = validateCVEData({ ...validCVE, severity: sev });
      expect(error).toBeUndefined();
    });
  });

  test('accepts empty severity', () => {
    const { error } = validateCVEData({ ...validCVE, severity: '' });
    expect(error).toBeUndefined();
  });

  test('rejects invalid CVE ID format', () => {
    const { error } = validateCVEData({ ...validCVE, cveId: 'INVALID-ID' });
    expect(error).toBeDefined();
  });

  test('rejects when cveId is missing', () => {
    const { cveId, ...rest } = validCVE;
    const { error } = validateCVEData(rest);
    expect(error).toBeDefined();
  });

  test('rejects score greater than 10', () => {
    const { error } = validateCVEData({ ...validCVE, score: 11 });
    expect(error).toBeDefined();
  });

  test('rejects score less than 0', () => {
    const { error } = validateCVEData({ ...validCVE, score: -1 });
    expect(error).toBeDefined();
  });

  test('accepts null score', () => {
    const { error } = validateCVEData({ ...validCVE, score: null });
    expect(error).toBeUndefined();
  });

  test('accepts CVE ID with many digits', () => {
    const { error } = validateCVEData({ ...validCVE, cveId: 'CVE-2024-123456789' });
    expect(error).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cleanText
// ─────────────────────────────────────────────────────────────────────────────
describe('cleanText', () => {
  test('trims leading and trailing whitespace', () => {
    expect(cleanText('  hello  ')).toBe('hello');
  });

  test('collapses multiple internal spaces', () => {
    expect(cleanText('foo   bar')).toBe('foo bar');
  });

  test('replaces newlines with a single space', () => {
    expect(cleanText('line1\nline2')).toBe('line1 line2');
  });

  test('replaces tabs', () => {
    expect(cleanText('col1\tcol2')).toBe('col1 col2');
  });

  test('handles carriage return + newline', () => {
    expect(cleanText('a\r\nb')).toBe('a b');
  });

  test('returns empty string for empty input', () => {
    expect(cleanText('')).toBe('');
  });

  test('returns empty string for null', () => {
    expect(cleanText(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(cleanText(undefined)).toBe('');
  });

  test('returns empty string for non-string types', () => {
    expect(cleanText(42)).toBe('');
    expect(cleanText([])).toBe('');
  });

  test('does not alter already clean text', () => {
    expect(cleanText('clean text')).toBe('clean text');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCVSSScore
// ─────────────────────────────────────────────────────────────────────────────
describe('parseCVSSScore', () => {
  test('parses a plain decimal string', () => {
    expect(parseCVSSScore('8.5')).toBe(8.5);
  });

  test('parses a string with "CVSS:" prefix', () => {
    expect(parseCVSSScore('CVSS: 7.2')).toBe(7.2);
  });

  test('parses an integer string', () => {
    expect(parseCVSSScore('10')).toBe(10);
  });

  test('parses 0.0', () => {
    expect(parseCVSSScore('0.0')).toBe(0.0);
  });

  test('parses minimum score 0', () => {
    expect(parseCVSSScore('0')).toBe(0);
  });

  test('parses maximum score 10', () => {
    expect(parseCVSSScore('10.0')).toBe(10);
  });

  test('returns null for empty string', () => {
    expect(parseCVSSScore('')).toBeNull();
  });

  test('returns null for null', () => {
    expect(parseCVSSScore(null)).toBeNull();
  });

  test('returns null for undefined', () => {
    expect(parseCVSSScore(undefined)).toBeNull();
  });

  test('returns null when no numeric value is found', () => {
    expect(parseCVSSScore('No score')).toBeNull();
  });

  test('returns null for out-of-range score > 10', () => {
    expect(parseCVSSScore('11.5')).toBeNull();
  });

  test('handles numeric input directly', () => {
    expect(parseCVSSScore(9)).toBe(9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateAnalytics
// ─────────────────────────────────────────────────────────────────────────────
describe('generateAnalytics', () => {
  const makeCVE = (overrides = {}) => ({
    cveId: 'CVE-2025-0001',
    severity: 'HIGH',
    score: 8.5,
    technologies: ['Linux'],
    component: 'kernel',
    additionalResources: { externalLinks: [{ url: 'https://nvd.nist.gov/vuln/detail/CVE-2025-0001' }] },
    ...overrides
  });

  test('returns correct total count', () => {
    const analytics = generateAnalytics([makeCVE(), makeCVE()]);
    expect(analytics.total).toBe(2);
  });

  test('calculates severity distribution', () => {
    const cves = [
      makeCVE({ severity: 'HIGH' }),
      makeCVE({ severity: 'CRITICAL' }),
      makeCVE({ severity: 'HIGH' })
    ];
    const { severityDistribution } = generateAnalytics(cves);
    expect(severityDistribution.HIGH).toBe(2);
    expect(severityDistribution.CRITICAL).toBe(1);
  });

  test('calculates average score', () => {
    const cves = [makeCVE({ score: 6 }), makeCVE({ score: 8 })];
    const { averageScore } = generateAnalytics(cves);
    expect(parseFloat(averageScore)).toBe(7);
  });

  test('score is placed in correct bucket', () => {
    const cves = [
      makeCVE({ score: 1 }),   // 0-3
      makeCVE({ score: 5 }),   // 3-7
      makeCVE({ score: 8 }),   // 7-9
      makeCVE({ score: 9.5 }) // 9-10
    ];
    const { scoreDistribution } = generateAnalytics(cves);
    expect(scoreDistribution['0-3']).toBe(1);
    expect(scoreDistribution['3-7']).toBe(1);
    expect(scoreDistribution['7-9']).toBe(1);
    expect(scoreDistribution['9-10']).toBe(1);
  });

  test('handles empty array', () => {
    const analytics = generateAnalytics([]);
    expect(analytics.total).toBe(0);
    expect(analytics.averageScore).toBe(0);
  });

  test('counts top technologies', () => {
    const cves = [
      makeCVE({ technologies: ['Linux', 'Apache'] }),
      makeCVE({ technologies: ['Linux'] })
    ];
    const { topTechnologies } = generateAnalytics(cves);
    expect(topTechnologies.Linux).toBe(2);
    expect(topTechnologies.Apache).toBe(1);
  });

  test('limits topTechnologies to 10 entries', () => {
    const cves = Array.from({ length: 20 }, (_, i) =>
      makeCVE({ technologies: [`Tech${i}`] })
    );
    const { topTechnologies } = generateAnalytics(cves);
    expect(Object.keys(topTechnologies).length).toBeLessThanOrEqual(10);
  });

  test('counts CVEs with additional resources', () => {
    const cves = [
      makeCVE(),  // has externalLinks
      makeCVE({ additionalResources: {} })  // no externalLinks
    ];
    const { withAdditionalResources } = generateAnalytics(cves);
    expect(withAdditionalResources).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractBaseUrls
// ─────────────────────────────────────────────────────────────────────────────
describe('extractBaseUrls', () => {
  test('extracts unique base URLs from sourceUrl', () => {
    const cveData = [
      { sourceUrl: 'https://example.com/path/to/page' },
      { sourceUrl: 'https://example.com/another/path' }
    ];
    const urls = extractBaseUrls(cveData);
    expect(urls).toContain('https://example.com');
    expect(urls.filter(u => u === 'https://example.com').length).toBe(1);
  });

  test('extracts URLs from additionalResources.externalLinks', () => {
    const cveData = [{
      additionalResources: {
        externalLinks: [
          { url: 'https://nvd.nist.gov/vuln/detail/CVE-2025-0001' },
          { url: 'https://github.com/org/repo/issues/1' }
        ]
      }
    }];
    const urls = extractBaseUrls(cveData);
    expect(urls).toContain('https://nvd.nist.gov');
    expect(urls).toContain('https://github.com');
  });

  test('returns sorted array', () => {
    const cveData = [
      { sourceUrl: 'https://z-domain.com/foo' },
      { sourceUrl: 'https://a-domain.com/bar' }
    ];
    const urls = extractBaseUrls(cveData);
    expect(urls[0]).toBe('https://a-domain.com');
    expect(urls[1]).toBe('https://z-domain.com');
  });

  test('handles empty array', () => {
    expect(extractBaseUrls([])).toEqual([]);
  });

  test('ignores invalid URLs without throwing', () => {
    const cveData = [{ sourceUrl: 'not-a-url' }];
    expect(() => extractBaseUrls(cveData)).not.toThrow();
  });

  test('deduplicates across multiple CVEs', () => {
    const cveData = [
      { sourceUrl: 'https://same.com/path1' },
      { sourceUrl: 'https://same.com/path2' }
    ];
    const urls = extractBaseUrls(cveData);
    expect(urls.length).toBe(1);
  });
});
