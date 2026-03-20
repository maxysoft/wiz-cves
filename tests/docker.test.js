/**
 * Tests for the Docker setup and user-agent rotation.
 *
 * Docker artefacts (Dockerfile, docker-compose.yml) are validated by parsing
 * them as text/YAML – no Docker daemon is required.
 *
 * User-agent rotation is validated through the config module and the
 * getRandomUserAgent helper.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml'); // transitive dependency of jest (via @istanbuljs/load-nyc-config)

// ─── helpers ──────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function fileExists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

// ─── Dockerfile ───────────────────────────────────────────────────────────────

describe('Dockerfile', () => {
  let content;

  beforeAll(() => {
    content = readFile('Dockerfile');
  });

  test('file exists', () => {
    expect(fileExists('Dockerfile')).toBe(true);
  });

  test('uses a multi-stage build (at least two FROM instructions)', () => {
    const fromLines = content.match(/^FROM\s+/gm) || [];
    expect(fromLines.length).toBeGreaterThanOrEqual(2);
  });

  test('final stage uses node:24 base image', () => {
    expect(content).toMatch(/FROM\s+node:24/);
  });

  test('creates a non-root user', () => {
    // adduser or useradd pattern
    expect(content).toMatch(/adduser|useradd/);
  });

  test('switches to non-root user with USER instruction', () => {
    expect(content).toMatch(/^USER\s+/m);
  });

  test('exposes port 3000', () => {
    expect(content).toMatch(/^EXPOSE\s+3000/m);
  });

  test('defines a HEALTHCHECK instruction', () => {
    expect(content).toMatch(/^HEALTHCHECK\s+/m);
  });

  test('starts the API server via CMD', () => {
    expect(content).toMatch(/src\/api\.js/);
  });

  test('does not reference puppeteer', () => {
    expect(content).not.toMatch(/puppeteer/i);
  });
});

// ─── docker-compose.yml ───────────────────────────────────────────────────────

describe('docker-compose.yml', () => {
  let content;
  let compose;

  beforeAll(() => {
    content = readFile('docker-compose.yml');
    compose = yaml.load(content);
  });

  test('file exists', () => {
    expect(fileExists('docker-compose.yml')).toBe(true);
  });

  test('is valid YAML', () => {
    expect(compose).toBeDefined();
    expect(typeof compose).toBe('object');
  });

  test('defines an "api" service', () => {
    expect(compose.services).toHaveProperty('api');
  });

  test('api service builds from the root Dockerfile', () => {
    const build = compose.services.api.build;
    expect(build).toBeDefined();
    // context should be the repo root (".") and dockerfile should be "Dockerfile"
    expect(build.context).toBe('.');
    expect(build.dockerfile).toBe('Dockerfile');
  });

  test('api service maps port 3000', () => {
    const ports = compose.services.api.ports || [];
    const hasPort3000 = ports.some((p) => String(p).includes('3000'));
    expect(hasPort3000).toBe(true);
  });

  test('api service has a healthcheck', () => {
    expect(compose.services.api.healthcheck).toBeDefined();
  });

  test('api service sets NODE_ENV to production', () => {
    const env = compose.services.api.environment || {};
    expect(env.NODE_ENV).toBe('production');
  });

  test('api service includes USER_AGENTS environment variable', () => {
    const env = compose.services.api.environment || {};
    expect(env.USER_AGENTS).toBeDefined();
  });

  test('compose defines named volumes for output, logs, checkpoints', () => {
    expect(compose.volumes).toBeDefined();
    expect(compose.volumes).toHaveProperty('output');
    expect(compose.volumes).toHaveProperty('logs');
    expect(compose.volumes).toHaveProperty('checkpoints');
  });

  test('does not reference a browser/puppeteer service', () => {
    const serviceNames = Object.keys(compose.services || {});
    const hasBrowserService = serviceNames.some((n) =>
      /browser|puppeteer|chrome|chromium/i.test(n)
    );
    expect(hasBrowserService).toBe(false);
  });
});

// ─── User-agent rotation ──────────────────────────────────────────────────────

describe('User-agent rotation (config)', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.USER_AGENTS;
    delete process.env.USER_AGENT;
  });

  afterEach(() => {
    delete process.env.USER_AGENTS;
    delete process.env.USER_AGENT;
  });

  test('config.browser.userAgents falls back to the built-in list', () => {
    const cfg = require('../src/config');
    expect(Array.isArray(cfg.browser.userAgents)).toBe(true);
    expect(cfg.browser.userAgents.length).toBeGreaterThan(0);
  });

  test('USER_AGENT (single) is read into the list', () => {
    process.env.USER_AGENT = 'SingleAgent/1.0';
    jest.resetModules();
    const cfg = require('../src/config');
    expect(cfg.browser.userAgents).toEqual(['SingleAgent/1.0']);
  });

  test('USER_AGENTS (comma-separated) is split into a list', () => {
    process.env.USER_AGENTS = 'AgentA/1.0,AgentB/2.0,AgentC/3.0';
    jest.resetModules();
    const cfg = require('../src/config');
    expect(cfg.browser.userAgents).toEqual(['AgentA/1.0', 'AgentB/2.0', 'AgentC/3.0']);
  });

  test('USER_AGENTS trims whitespace around each entry', () => {
    process.env.USER_AGENTS = '  AgentA/1.0 , AgentB/2.0  ';
    jest.resetModules();
    const cfg = require('../src/config');
    expect(cfg.browser.userAgents).toEqual(['AgentA/1.0', 'AgentB/2.0']);
  });

  test('USER_AGENTS takes precedence over USER_AGENT', () => {
    process.env.USER_AGENT  = 'SingleAgent/1.0';
    process.env.USER_AGENTS = 'MultiA/1.0,MultiB/2.0';
    jest.resetModules();
    const cfg = require('../src/config');
    expect(cfg.browser.userAgents).toEqual(['MultiA/1.0', 'MultiB/2.0']);
  });
});

describe('getRandomUserAgent', () => {
  afterEach(() => {
    delete process.env.USER_AGENTS;
    jest.resetModules();
  });

  test('returns a non-empty string', () => {
    jest.resetModules();
    const { getRandomUserAgent } = require('../src/config');
    const ua = getRandomUserAgent();
    expect(typeof ua).toBe('string');
    expect(ua.length).toBeGreaterThan(0);
  });

  test('always returns one of the configured agents', () => {
    process.env.USER_AGENTS = 'AgentX/1.0,AgentY/2.0,AgentZ/3.0';
    jest.resetModules();
    const { getRandomUserAgent } = require('../src/config');
    const allowed = new Set(['AgentX/1.0', 'AgentY/2.0', 'AgentZ/3.0']);
    // Sample multiple times to reduce flakiness
    for (let i = 0; i < 30; i++) {
      expect(allowed.has(getRandomUserAgent())).toBe(true);
    }
  });

  test('returns different values across many calls (rotation is random)', () => {
    process.env.USER_AGENTS = 'AgentA/1.0,AgentB/2.0,AgentC/3.0,AgentD/4.0,AgentE/5.0';
    jest.resetModules();
    const { getRandomUserAgent } = require('../src/config');
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      seen.add(getRandomUserAgent());
    }
    // With 200 samples from the 5 agents defined in this test's USER_AGENTS,
    // the probability of seeing only 1 unique value is astronomically small –
    // this catches a broken "always first" implementation.
    expect(seen.size).toBeGreaterThan(1);
  });
});

// ─── WizCVEScraper – User-Agent header on each request ───────────────────────

describe('WizCVEScraper – User-Agent header rotation', () => {
  let axiosMock;

  beforeEach(() => {
    jest.resetModules();
    process.env.USER_AGENTS = 'AgentA/1.0,AgentB/2.0,AgentC/3.0';

    jest.mock('axios');
    axiosMock = require('axios');
    jest.mock('../src/utils/helpers', () => ({
      ...jest.requireActual('../src/utils/helpers'),
      saveCheckpoint: jest.fn().mockResolvedValue('/tmp/ck.json'),
    }));
  });

  afterEach(() => {
    delete process.env.USER_AGENTS;
    jest.resetModules();
  });

  test('sets a User-Agent header on every Algolia API call', async () => {
    axiosMock.post = jest.fn().mockResolvedValue({
      status: 200,
      data: { results: [{ hits: [], nbHits: 0 }] },
    });

    const WizCVEScraper = require('../src/scraper/WizCVEScraper');
    const scraper = new WizCVEScraper({ retryAttempts: 1 });
    await scraper.makeAlgoliaRequest(0, 1);

    expect(axiosMock.post).toHaveBeenCalledTimes(1);
    const [, , cfg] = axiosMock.post.mock.calls[0];
    expect(cfg.headers['User-Agent']).toBeDefined();
    expect(typeof cfg.headers['User-Agent']).toBe('string');
    expect(cfg.headers['User-Agent'].length).toBeGreaterThan(0);
  });

  test('User-Agent comes from the configured USER_AGENTS list', async () => {
    axiosMock.post = jest.fn().mockResolvedValue({
      status: 200,
      data: { results: [{ hits: [], nbHits: 0 }] },
    });

    const WizCVEScraper = require('../src/scraper/WizCVEScraper');
    const scraper = new WizCVEScraper({ retryAttempts: 1 });

    const capturedAgents = new Set();
    // Make several requests and collect the User-Agent used each time
    for (let i = 0; i < 20; i++) {
      await scraper.makeAlgoliaRequest(0, 1);
      const [, , cfg] = axiosMock.post.mock.calls[i];
      capturedAgents.add(cfg.headers['User-Agent']);
    }

    const allowed = new Set(['AgentA/1.0', 'AgentB/2.0', 'AgentC/3.0']);
    for (const ua of capturedAgents) {
      expect(allowed.has(ua)).toBe(true);
    }
  });
});
