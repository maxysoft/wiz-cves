/**
 * Tests for src/config/index.js.
 * Verifies that environment variables are correctly mapped to config properties.
 */

const path = require('path');

describe('Config module', () => {
  let config;

  // Re-require the config after setting env vars (config is not cached across
  // tests because jest.resetModules() is called in beforeEach)
  beforeEach(() => {
    jest.resetModules();
    // Remove env vars set by test setup so defaults are visible
    delete process.env.LOG_LEVEL;
    config = require('../src/config');
  });

  describe('defaults', () => {
    test('algolia.indexName is set', () => {
      expect(config.algolia.indexName).toBe('cve-db');
    });

    test('algolia.hitsPerPage defaults to 20', () => {
      expect(config.algolia.hitsPerPage).toBe(20);
    });

    test('algolia.maxPages defaults to 100', () => {
      expect(config.algolia.maxPages).toBe(100);
    });

    test('scraping.delayBetweenRequests defaults to 2000', () => {
      expect(config.scraping.delayBetweenRequests).toBe(2000);
    });

    test('scraping.retryAttempts defaults to 5', () => {
      expect(config.scraping.retryAttempts).toBe(5);
    });

    test('scraping.maxConcurrentRequests defaults to 3', () => {
      expect(config.scraping.maxConcurrentRequests).toBe(3);
    });

    test('output.dir defaults to "./output"', () => {
      expect(config.output.dir).toBe('./output');
    });

    test('output.saveCheckpoints defaults to true', () => {
      expect(config.output.saveCheckpoints).toBe(true);
    });

    test('api.port defaults to 3000', () => {
      expect(config.api.port).toBe(3000);
    });

    test('api.host defaults to "localhost"', () => {
      expect(config.api.host).toBe('localhost');
    });

    test('logging.level defaults to "info"', () => {
      expect(config.logging.level).toBe('info');
    });

    test('dataTransform.includeDescription defaults to true', () => {
      expect(config.dataTransform.includeDescription).toBe(true);
    });
  });

  describe('environment variable overrides', () => {
    test('HITS_PER_PAGE overrides hitsPerPage', () => {
      jest.resetModules();
      process.env.HITS_PER_PAGE = '50';
      const cfg = require('../src/config');
      expect(cfg.algolia.hitsPerPage).toBe(50);
      delete process.env.HITS_PER_PAGE;
    });

    test('API_PORT overrides port', () => {
      jest.resetModules();
      process.env.API_PORT = '8080';
      const cfg = require('../src/config');
      expect(cfg.api.port).toBe(8080);
      delete process.env.API_PORT;
    });

    test('LOG_LEVEL overrides logging.level', () => {
      jest.resetModules();
      process.env.LOG_LEVEL = 'debug';
      const cfg = require('../src/config');
      expect(cfg.logging.level).toBe('debug');
      delete process.env.LOG_LEVEL;
    });

    test('SAVE_CHECKPOINTS=false disables checkpoints', () => {
      jest.resetModules();
      process.env.SAVE_CHECKPOINTS = 'false';
      const cfg = require('../src/config');
      expect(cfg.output.saveCheckpoints).toBe(false);
      delete process.env.SAVE_CHECKPOINTS;
    });

    test('DELAY_BETWEEN_REQUESTS overrides delayBetweenRequests', () => {
      jest.resetModules();
      process.env.DELAY_BETWEEN_REQUESTS = '500';
      const cfg = require('../src/config');
      expect(cfg.scraping.delayBetweenRequests).toBe(500);
      delete process.env.DELAY_BETWEEN_REQUESTS;
    });
  });

  describe('paths', () => {
    test('paths.root is an absolute path', () => {
      expect(path.isAbsolute(config.paths.root)).toBe(true);
    });

    test('paths.src is an absolute path', () => {
      expect(path.isAbsolute(config.paths.src)).toBe(true);
    });

    test('paths.checkpoints is an absolute path', () => {
      expect(path.isAbsolute(config.paths.checkpoints)).toBe(true);
    });
  });
});
