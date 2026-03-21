/**
 * Unit tests for WizCVEScraper.
 * Axios and all I/O are mocked so no real network calls are made.
 */

// ─── Mock axios BEFORE requiring WizCVEScraper ────────────────────────────────
jest.mock('axios');
const axios = require('axios');

jest.mock('../src/utils/helpers', () => {
  const actual = jest.requireActual('../src/utils/helpers');
  return {
    ...actual,
    saveCheckpoint: jest.fn().mockResolvedValue('/tmp/checkpoint.json'),
    saveCVEsToDatabase: jest.fn().mockReturnValue(0)
  };
});

const WizCVEScraper = require('../src/scraper/WizCVEScraper');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeAlgoliaResponse(hits = [], nbHits = hits.length) {
  return {
    status: 200,
    statusText: 'OK',
    data: {
      results: [{ hits, nbHits }]
    }
  };
}

function makeBrowseResponse(hits = [], cursor = null, nbHits = hits.length) {
  return {
    status: 200,
    statusText: 'OK',
    data: Object.assign({ hits, nbHits }, cursor ? { cursor } : {})
  };
}

function makeHit(overrides = {}) {
  return {
    externalId: 'CVE-2025-0001',
    severity: 'HIGH',
    baseScore: 8.5,
    cnaScore: 8.5,
    publishedAt: 1735689600000, // 2025-01-01 as ms timestamp (matches real API)
    description: 'Test vulnerability',
    affectedTechnologies: [{ name: 'Linux' }],
    affectedSoftware: ['kernel 5.x'],
    sourceUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2025-0001',
    hasFix: true,
    hasCisaKevExploit: false,
    isHighProfileThreat: false,
    exploitable: false,
    epssPercentile: 75.5,
    epssProbability: 0.012,
    cvss2: { attackVector: 'NETWORK', attackComplexity: 'LOW' },
    cvss3: { attackVector: 'NETWORK', attackComplexity: 'HIGH' },
    sourceFeeds: [{ name: 'GitHub Advisory Database', id: 'abc', url: null }],
    aiDescription: { overview: 'Test overview', technicalDetails: '' },
    batchId: '2025-1-01-testbatch',
    ...overrides
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constructor
// ─────────────────────────────────────────────────────────────────────────────
describe('WizCVEScraper — constructor', () => {
  test('initialises with default options', () => {
    const scraper = new WizCVEScraper();
    expect(scraper.options.retryAttempts).toBeGreaterThan(0);
    expect(scraper.options.delayBetweenRequests).toBeGreaterThan(0);
    expect(scraper.cveData).toEqual([]);
    expect(scraper.processedCount).toBe(0);
  });

  test('overrides defaults with supplied options', () => {
    const scraper = new WizCVEScraper({ retryAttempts: 10, maxCVEs: 50 });
    expect(scraper.options.retryAttempts).toBe(10);
    expect(scraper.options.maxCVEs).toBe(50);
  });

  test('circuit breaker starts CLOSED', () => {
    const scraper = new WizCVEScraper();
    expect(scraper.circuitBreaker.state).toBe('CLOSED');
    expect(scraper.circuitBreaker.failures).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getStats
// ─────────────────────────────────────────────────────────────────────────────
describe('WizCVEScraper — getStats', () => {
  test('returns zero duration when not started', () => {
    const scraper = new WizCVEScraper();
    const stats = scraper.getStats();
    expect(stats.duration).toBe(0);
    expect(stats.processedCount).toBe(0);
    expect(stats.averageTimePerCVE).toBe(0);
  });

  test('returns correct processedCount', () => {
    const scraper = new WizCVEScraper();
    scraper.processedCount = 5;
    scraper.startTime = Date.now() - 1000;
    const stats = scraper.getStats();
    expect(stats.processedCount).toBe(5);
    expect(stats.duration).toBeGreaterThan(0);
    expect(stats.averageTimePerCVE).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAllCollectedCVEs
// ─────────────────────────────────────────────────────────────────────────────
describe('WizCVEScraper — getAllCollectedCVEs', () => {
  test('returns empty array when no data collected', () => {
    const scraper = new WizCVEScraper();
    expect(scraper.getAllCollectedCVEs()).toEqual([]);
  });

  test('returns cveData when populated', () => {
    const scraper = new WizCVEScraper();
    scraper.cveData = [{ cveId: 'CVE-2025-0001' }];
    expect(scraper.getAllCollectedCVEs()).toHaveLength(1);
  });

  test('returns intermediate data from currentAllCVEs when cveData is empty', () => {
    const scraper = new WizCVEScraper();
    scraper.currentAllCVEs = new Map([['CVE-2025-0001', { cveId: 'CVE-2025-0001' }]]);
    expect(scraper.getAllCollectedCVEs()).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cleanup
// ─────────────────────────────────────────────────────────────────────────────
describe('WizCVEScraper — cleanup', () => {
  test('clears currentAllCVEs without throwing', () => {
    const scraper = new WizCVEScraper();
    scraper.currentAllCVEs = new Map([['k', 'v']]);
    expect(() => scraper.cleanup()).not.toThrow();
    expect(scraper.currentAllCVEs).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isRetryableError
// ─────────────────────────────────────────────────────────────────────────────
describe('WizCVEScraper — isRetryableError', () => {
  let scraper;

  beforeEach(() => {
    scraper = new WizCVEScraper();
  });

  test.each(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])(
    'returns true for error code %s',
    (code) => {
      expect(scraper.isRetryableError({ code })).toBe(true);
    }
  );

  test('returns true for ECONNABORTED timeout', () => {
    const error = { code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' };
    expect(scraper.isRetryableError(error)).toBe(true);
  });

  test('returns true for HTTP 500', () => {
    expect(scraper.isRetryableError({ response: { status: 500 } })).toBe(true);
  });

  test('returns true for HTTP 429 rate limit', () => {
    expect(scraper.isRetryableError({ response: { status: 429 } })).toBe(true);
  });

  test('returns true for HTTP 503', () => {
    expect(scraper.isRetryableError({ response: { status: 503 } })).toBe(true);
  });

  test('returns false for HTTP 404', () => {
    expect(scraper.isRetryableError({ response: { status: 404 } })).toBe(false);
  });

  test('returns false for HTTP 400', () => {
    expect(scraper.isRetryableError({ response: { status: 400 } })).toBe(false);
  });

  test('returns false for generic JS error', () => {
    expect(scraper.isRetryableError(new Error('something broke'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// categorizeResourceType
// ─────────────────────────────────────────────────────────────────────────────
describe('WizCVEScraper — categorizeResourceType', () => {
  let scraper;

  beforeEach(() => {
    scraper = new WizCVEScraper();
  });

  test.each([
    ['https://nvd.nist.gov/vuln/detail/CVE-2025-0001', 'NVD link', 'NVD'],
    ['https://github.com/org/repo', 'GitHub advisory', 'GitHub'],
    ['https://vuldb.com/?id.1234', 'VulDB entry', 'VulDB'],
    ['https://cve.mitre.org/cgi-bin/cvename.cgi', 'MITRE CVE', 'MITRE'],
    ['https://www.exploit-db.com/exploits/12345', 'Exploit-DB', 'Exploit-DB'],
    ['https://exploit-db.com/exploits/12345', 'Exploit-DB alt', 'Exploit-DB']
  ])(
    'categorizes %s as %s',
    (url, title, expected) => {
      expect(scraper.categorizeResourceType(url, title)).toBe(expected);
    }
  );

  test('categorizes security advisory by title', () => {
    expect(
      scraper.categorizeResourceType('https://example.com/blog', 'Security Advisory 2025')
    ).toBe('Security Advisory');
  });

  test('categorizes patch/fix by title', () => {
    expect(
      scraper.categorizeResourceType('https://example.com/release', 'Patch for CVE-2025-0001')
    ).toBe('Patch/Fix');
  });

  test('categorizes proof-of-concept by title', () => {
    expect(
      scraper.categorizeResourceType('https://example.com/poc', 'Proof of Concept Exploit')
    ).toBe('Proof of Concept');
  });

  test('returns Other for unknown URL and title', () => {
    expect(
      scraper.categorizeResourceType('https://random.example.com/page', 'Some Document')
    ).toBe('Other');
  });

  test('does NOT allow spoofed NVD hostname', () => {
    // evil.com/nvd.nist.gov should NOT return 'NVD'
    const result = scraper.categorizeResourceType(
      'https://evil.com/nvd.nist.gov/vuln',
      'Fake NVD page'
    );
    expect(result).not.toBe('NVD');
  });

  test('does NOT allow spoofed github.com hostname', () => {
    const result = scraper.categorizeResourceType(
      'https://notgithub.com/github.com/path',
      'Fake GitHub'
    );
    expect(result).not.toBe('GitHub');
  });

  test('handles subdomains of github.com', () => {
    const result = scraper.categorizeResourceType(
      'https://raw.github.com/org/repo/file.txt',
      'GitHub raw file'
    );
    expect(result).toBe('GitHub');
  });

  test('does not throw on invalid URL', () => {
    expect(() =>
      scraper.categorizeResourceType('not-a-url', 'Random Title')
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// testApiConnectivity (via axios mock)
// ─────────────────────────────────────────────────────────────────────────────
describe('WizCVEScraper — testApiConnectivity', () => {
  let scraper;

  beforeEach(() => {
    scraper = new WizCVEScraper({ retryAttempts: 1, delayBetweenRequests: 0 });
    jest.clearAllMocks();
  });

  test('returns total hit count on success', async () => {
    axios.post.mockResolvedValue(makeAlgoliaResponse([], 1234));
    const count = await scraper.testApiConnectivity();
    expect(count).toBe(1234);
  });

  test('throws when API returns invalid structure', async () => {
    axios.post.mockResolvedValue({ data: {} });
    await expect(scraper.testApiConnectivity()).rejects.toThrow();
  });

  test('throws when axios rejects', async () => {
    axios.post.mockRejectedValue(new Error('network error'));
    await expect(scraper.testApiConnectivity()).rejects.toThrow('network error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// transformAlgoliaHitToCVE
// ─────────────────────────────────────────────────────────────────────────────
describe('WizCVEScraper — transformAlgoliaHitToCVE', () => {
  let scraper;

  beforeEach(() => {
    scraper = new WizCVEScraper({ retryAttempts: 1, delayBetweenRequests: 0 });
  });

  test('returns a properly shaped CVE object', async () => {
    const hit = makeHit();
    const cve = await scraper.transformAlgoliaHitToCVE(hit);

    expect(cve.cveId).toBe('CVE-2025-0001');
    expect(cve.severity).toBe('HIGH');
    expect(cve.score).toBe(8.5);
    expect(typeof cve.description).toBe('string');
    expect(cve.additionalResources).toBeDefined();
  });

  test('uses baseScore preferentially over cnaScore and legacy cvssScore', () => {
    const hit = makeHit({ baseScore: 9.0, cnaScore: 7.0, cvssScore: 5.0 });
    const cve = scraper.transformAlgoliaHitToCVE(hit);
    expect(cve.score).toBe(9.0);
  });

  test('falls back to cnaScore when baseScore is absent', () => {
    const hit = makeHit({ baseScore: undefined, cnaScore: 7.0, cvssScore: 5.0 });
    const cve = scraper.transformAlgoliaHitToCVE(hit);
    expect(cve.score).toBe(7.0);
  });

  test('falls back to cvssScore when baseScore and cnaScore are absent', () => {
    const hit = makeHit({ baseScore: undefined, cnaScore: undefined, cvssScore: 5.0 });
    const cve = scraper.transformAlgoliaHitToCVE(hit);
    expect(cve.score).toBe(5.0);
  });

  test('captures epssPercentile and epssProbability', () => {
    const hit = makeHit({ epssPercentile: 75.5, epssProbability: 0.012 });
    const cve = scraper.transformAlgoliaHitToCVE(hit);
    expect(cve.epssPercentile).toBe(75.5);
    expect(cve.epssProbability).toBe(0.012);
  });

  test('captures cvss2 and cvss3 objects', () => {
    const cvss2 = { attackVector: 'NETWORK', attackComplexity: 'LOW' };
    const cvss3 = { attackVector: 'NETWORK', attackComplexity: 'HIGH' };
    const hit = makeHit({ cvss2, cvss3 });
    const cve = scraper.transformAlgoliaHitToCVE(hit);
    expect(cve.cvss2).toEqual(cvss2);
    expect(cve.cvss3).toEqual(cvss3);
  });

  test('captures sourceFeeds array', () => {
    const sourceFeeds = [{ name: 'GitHub Advisory Database', id: 'abc', url: null }];
    const hit = makeHit({ sourceFeeds });
    const cve = scraper.transformAlgoliaHitToCVE(hit);
    expect(cve.sourceFeeds).toEqual(sourceFeeds);
  });

  test('captures aiDescription object', () => {
    const aiDescription = { overview: 'Test overview', technicalDetails: '' };
    const hit = makeHit({ aiDescription });
    const cve = scraper.transformAlgoliaHitToCVE(hit);
    expect(cve.aiDescription).toEqual(aiDescription);
  });

  test('captures batchId', () => {
    const hit = makeHit({ batchId: '2025-1-01-testbatch' });
    const cve = scraper.transformAlgoliaHitToCVE(hit);
    expect(cve.batchId).toBe('2025-1-01-testbatch');
  });

  test('sets detailUrl from cveId', () => {
    const hit = makeHit();
    const cve = scraper.transformAlgoliaHitToCVE(hit);
    expect(cve.detailUrl).toBe('https://www.wiz.io/vulnerability-database/cve/cve-2025-0001');
  });

  test('handles ms-timestamp publishedAt correctly', () => {
    // 1735689600000 ms = 2025-01-01 UTC
    const hit = makeHit({ publishedAt: 1735689600000 });
    const cve = scraper.transformAlgoliaHitToCVE(hit);
    expect(cve.publishedDate).toBe('2025-01-01');
  });

  test('externalLinks is always an empty array (no per-CVE HTTP scraping)', async () => {
    const hit = makeHit();
    const cve = await scraper.transformAlgoliaHitToCVE(hit);
    expect(Array.isArray(cve.additionalResources.externalLinks)).toBe(true);
    expect(cve.additionalResources.externalLinks).toHaveLength(0);
  });

  test('falls back to N/A for missing fields', async () => {
    const hit = { externalId: 'CVE-2025-9999' };
    const cve = await scraper.transformAlgoliaHitToCVE(hit);

    expect(cve.cveId).toBe('CVE-2025-9999');
    expect(cve.severity).toBe('N/A');
    expect(cve.score).toBe('N/A');
    expect(cve.technologies).toBe('N/A');
    expect(cve.epssPercentile).toBeNull();
    expect(cve.epssProbability).toBeNull();
    expect(cve.cvss2).toBeNull();
    expect(cve.cvss3).toBeNull();
    expect(cve.sourceFeeds).toEqual([]);
    expect(cve.aiDescription).toBeNull();
    expect(cve.batchId).toBeNull();
  });

  test('returns null when transformation throws an unexpected error', async () => {
    // A hit whose getter throws causes the catch block to return null
    const badHit = Object.defineProperty({}, 'externalId', {
      get() { throw new Error('unexpected parse error'); }
    });
    const cve = await scraper.transformAlgoliaHitToCVE(badHit);
    expect(cve).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractCVEList / processCVEDetails
// ─────────────────────────────────────────────────────────────────────────────
describe('WizCVEScraper — extractCVEList and processCVEDetails', () => {
  test('extractCVEList returns current cveData', () => {
    const scraper = new WizCVEScraper();
    scraper.cveData = [{ cveId: 'CVE-2025-0001' }];
    expect(scraper.extractCVEList()).toHaveLength(1);
  });

  test('processCVEDetails returns the cve even when validation fails', () => {
    const scraper = new WizCVEScraper();
    // Pass an object that will fail CVE schema validation
    const invalidCVE = { id: 'BAD', severity: 'UNKNOWN', score: 99 };
    const result = scraper.processCVEDetails(invalidCVE);
    expect(result).toEqual(invalidCVE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// makeBrowseRequest
// ─────────────────────────────────────────────────────────────────────────────
describe('WizCVEScraper — makeBrowseRequest', () => {
  let scraper;

  beforeEach(() => {
    scraper = new WizCVEScraper({ retryAttempts: 1, delayBetweenRequests: 0 });
    jest.clearAllMocks();
  });

  test('returns browse response with hits and cursor on first call (no cursor)', async () => {
    const hits = [makeHit()];
    axios.post.mockResolvedValue(makeBrowseResponse(hits, 'cursor-abc', 100));
    const result = await scraper.makeBrowseRequest(null, 1000);
    expect(result.hits).toHaveLength(1);
    expect(result.cursor).toBe('cursor-abc');
    expect(result.nbHits).toBe(100);
  });

  test('passes cursor in body on subsequent calls', async () => {
    axios.post.mockResolvedValue(makeBrowseResponse([], null, 100));
    await scraper.makeBrowseRequest('cursor-xyz', 1000);
    const callBody = axios.post.mock.calls[0][1];
    expect(callBody).toEqual({ cursor: 'cursor-xyz' });
  });

  test('posts to the browse endpoint URL', async () => {
    axios.post.mockResolvedValue(makeBrowseResponse([], null, 0));
    await scraper.makeBrowseRequest(null, 1000);
    const url = axios.post.mock.calls[0][0];
    expect(url).toMatch(/\/1\/indexes\/cve-db\/browse$/);
  });

  test('throws when axios rejects', async () => {
    axios.post.mockRejectedValue(new Error('network error'));
    await expect(scraper.makeBrowseRequest()).rejects.toThrow('network error');
  });

  test('throws on non-2xx HTTP status', async () => {
    axios.post.mockResolvedValue({ status: 403, statusText: 'Forbidden', data: {} });
    await expect(scraper.makeBrowseRequest()).rejects.toThrow('HTTP 403');
  });
});
