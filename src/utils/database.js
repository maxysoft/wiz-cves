const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const config = require('../config');

/**
 * CVEDatabase — thin wrapper around a better-sqlite3 connection.
 *
 * All public methods are synchronous (better-sqlite3 is sync by design).
 */
class CVEDatabase {
  /**
   * @param {string} dbPath - Absolute path to the SQLite file.
   */
  constructor(dbPath) {
    if (!dbPath) {
      throw new Error('dbPath is required');
    }
    this.dbPath = dbPath;
    this.db = null;
  }

  /**
   * Open the database connection and run schema migrations.
   * Safe to call multiple times — only opens once.
   */
  open() {
    if (this.db) {
      return;
    }

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');

    this._migrate();
    logger.info(`SQLite database opened at: ${this.dbPath}`);
  }

  // ── Schema migrations ──────────────────────────────────────────────────────

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cves (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        cve_id                TEXT    UNIQUE NOT NULL,
        severity              TEXT,
        score                 REAL,
        technologies          TEXT    DEFAULT '[]',
        component             TEXT,
        published_date        TEXT,
        detail_url            TEXT,
        description           TEXT,
        source_url            TEXT,
        has_cisa_kev_exploit  INTEGER DEFAULT 0,
        has_fix               INTEGER DEFAULT 0,
        is_high_profile_threat INTEGER DEFAULT 0,
        exploitable           INTEGER DEFAULT 0,
        additional_resources  TEXT    DEFAULT '[]',
        created_at            TEXT    DEFAULT (datetime('now')),
        updated_at            TEXT    DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_cves_severity ON cves(severity);
      CREATE INDEX IF NOT EXISTS idx_cves_created  ON cves(created_at);

      CREATE TABLE IF NOT EXISTS scrape_runs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id        TEXT    NOT NULL,
        started_at    TEXT    NOT NULL,
        completed_at  TEXT,
        status        TEXT    DEFAULT 'running',
        total_cves    INTEGER DEFAULT 0,
        error_message TEXT,
        options       TEXT    DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at      TEXT    DEFAULT (datetime('now')),
        processed_count INTEGER NOT NULL,
        current_index   INTEGER NOT NULL,
        data            TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS execution_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        executed_at TEXT    DEFAULT (datetime('now')),
        job_type    TEXT    DEFAULT 'manual'
      );
    `);

    // Add new columns to existing databases (idempotent — skip if already present)
    const existingColumns = new Set(
      this.db.prepare('PRAGMA table_info(cves)').all().map(c => c.name)
    );
    const newColumns = [
      ['epss_percentile', 'REAL'],
      ['epss_probability', 'REAL'],
      ['base_score', 'REAL'],
      ['cna_score', 'REAL'],
      ['cvss2', 'TEXT'],
      ['cvss3', 'TEXT'],
      ['source_feeds', 'TEXT DEFAULT \'[]\''],
      ['ai_description', 'TEXT'],
      ['batch_id', 'TEXT']
    ];
    for (const [colName, colDef] of newColumns) {
      if (!existingColumns.has(colName)) {
        this.db.exec(`ALTER TABLE cves ADD COLUMN ${colName} ${colDef}`);
      }
    }
  }

  // ── CVE operations ─────────────────────────────────────────────────────────

  /**
   * Upsert an array of CVE objects into the database.
   *
   * @param {Array<Object>} cves
   * @returns {number} Number of CVEs processed.
   */
  saveCVEs(cves) {
    if (!Array.isArray(cves) || cves.length === 0) {
      return 0;
    }

    const stmt = this.db.prepare(`
      INSERT INTO cves
        (cve_id, severity, score, technologies, component, published_date,
         detail_url, description, source_url, has_cisa_kev_exploit, has_fix,
         is_high_profile_threat, exploitable, additional_resources,
         epss_percentile, epss_probability, base_score, cna_score,
         cvss2, cvss3, source_feeds, ai_description, batch_id, updated_at)
      VALUES
        (@cveId, @severity, @score, @technologies, @component, @publishedDate,
         @detailUrl, @description, @sourceUrl, @hasCisaKevExploit, @hasFix,
         @isHighProfileThreat, @exploitable, @additionalResources,
         @epssPercentile, @epssProbability, @baseScore, @cnaScore,
         @cvss2, @cvss3, @sourceFeeds, @aiDescription, @batchId, datetime('now'))
      ON CONFLICT(cve_id) DO UPDATE SET
        severity               = excluded.severity,
        score                  = excluded.score,
        technologies           = excluded.technologies,
        component              = excluded.component,
        published_date         = excluded.published_date,
        detail_url             = excluded.detail_url,
        description            = excluded.description,
        source_url             = excluded.source_url,
        has_cisa_kev_exploit   = excluded.has_cisa_kev_exploit,
        has_fix                = excluded.has_fix,
        is_high_profile_threat = excluded.is_high_profile_threat,
        exploitable            = excluded.exploitable,
        additional_resources   = excluded.additional_resources,
        epss_percentile        = excluded.epss_percentile,
        epss_probability       = excluded.epss_probability,
        base_score             = excluded.base_score,
        cna_score              = excluded.cna_score,
        cvss2                  = excluded.cvss2,
        cvss3                  = excluded.cvss3,
        source_feeds           = excluded.source_feeds,
        ai_description         = excluded.ai_description,
        batch_id               = excluded.batch_id,
        updated_at             = datetime('now')
    `);

    const insertMany = this.db.transaction((cvesArr) => {
      for (const cve of cvesArr) {
        stmt.run({
          cveId: cve.cveId,
          severity: cve.severity || null,
          score: typeof cve.score === 'number' && !isNaN(cve.score) ? cve.score : null,
          technologies: JSON.stringify(Array.isArray(cve.technologies) ? cve.technologies : []),
          component: cve.component || null,
          publishedDate: cve.publishedDate || null,
          detailUrl: cve.detailUrl || null,
          description: cve.description || null,
          sourceUrl: cve.sourceUrl || null,
          hasCisaKevExploit: cve.hasCisaKevExploit ? 1 : 0,
          hasFix: cve.hasFix ? 1 : 0,
          isHighProfileThreat: cve.isHighProfileThreat ? 1 : 0,
          exploitable: cve.exploitable ? 1 : 0,
          additionalResources: JSON.stringify(cve.additionalResources || []),
          epssPercentile: typeof cve.epssPercentile === 'number' ? cve.epssPercentile : null,
          epssProbability: typeof cve.epssProbability === 'number' ? cve.epssProbability : null,
          baseScore: typeof cve.baseScore === 'number' ? cve.baseScore : null,
          cnaScore: typeof cve.cnaScore === 'number' ? cve.cnaScore : null,
          cvss2: cve.cvss2 ? JSON.stringify(cve.cvss2) : null,
          cvss3: cve.cvss3 ? JSON.stringify(cve.cvss3) : null,
          sourceFeeds: JSON.stringify(cve.sourceFeeds || []),
          aiDescription: cve.aiDescription ? JSON.stringify(cve.aiDescription) : null,
          batchId: cve.batchId || null
        });
      }
    });

    insertMany(cves);
    return cves.length;
  }

  /**
   * Query CVEs with optional filters and pagination.
   *
   * @param {Object} opts
   * @param {string} [opts.severity]  Filter by severity (case-sensitive).
   * @param {string} [opts.search]   Substring search on cve_id, component, description.
   * @param {number} [opts.limit=100]
   * @param {number} [opts.offset=0]
   * @returns {Array<Object>}
   */
  getCVEs({ severity, search, limit = 100, offset = 0 } = {}) {
    const conditions = ['1=1'];
    const params = [];

    if (severity) {
      conditions.push('severity = ?');
      params.push(severity);
    }
    if (search) {
      conditions.push('(cve_id LIKE ? OR component LIKE ? OR description LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    params.push(Math.max(1, parseInt(limit, 10) || 100));
    params.push(Math.max(0, parseInt(offset, 10) || 0));

    const rows = this.db
      .prepare(`SELECT * FROM cves WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params);

    return rows.map(row => this._deserializeCVE(row));
  }

  /**
   * Fetch a single CVE by its ID string (e.g. "CVE-2025-12345").
   *
   * @param {string} cveId
   * @returns {Object|null}
   */
  getCVEById(cveId) {
    const row = this.db.prepare('SELECT * FROM cves WHERE cve_id = ?').get(cveId);
    return row ? this._deserializeCVE(row) : null;
  }

  /**
   * Return the total number of CVEs stored in the database.
   *
   * @returns {number}
   */
  countCVEs() {
    return this.db.prepare('SELECT COUNT(*) AS count FROM cves').get().count;
  }

  /**
   * @private
   */
  _deserializeCVE(row) {
    return {
      cveId: row.cve_id,
      severity: row.severity,
      score: row.score,
      technologies: this._parseJSON(row.technologies, []),
      component: row.component,
      publishedDate: row.published_date,
      detailUrl: row.detail_url,
      description: row.description,
      sourceUrl: row.source_url,
      hasCisaKevExploit: Boolean(row.has_cisa_kev_exploit),
      hasFix: Boolean(row.has_fix),
      isHighProfileThreat: Boolean(row.is_high_profile_threat),
      exploitable: Boolean(row.exploitable),
      additionalResources: this._parseJSON(row.additional_resources, []),
      epssPercentile: row.epss_percentile ?? null,
      epssProbability: row.epss_probability ?? null,
      baseScore: row.base_score ?? null,
      cnaScore: row.cna_score ?? null,
      cvss2: this._parseJSON(row.cvss2, null),
      cvss3: this._parseJSON(row.cvss3, null),
      sourceFeeds: this._parseJSON(row.source_feeds, []),
      aiDescription: this._parseJSON(row.ai_description, null),
      batchId: row.batch_id || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // ── Scrape-run tracking ────────────────────────────────────────────────────

  /**
   * Insert or update a scrape run record.
   *
   * @param {Object} run
   * @returns {number|undefined} lastInsertRowid when inserting.
   */
  saveRun(run) {
    if (!run || !run.jobId) {
      throw new Error('run.jobId is required');
    }

    if (run.completedAt !== undefined || run.totalCves !== undefined || run.errorMessage !== undefined) {
      this.db.prepare(`
        UPDATE scrape_runs
        SET completed_at  = ?,
            status        = ?,
            total_cves    = ?,
            error_message = ?
        WHERE job_id = ?
      `).run(
        run.completedAt || null,
        run.status || 'completed',
        run.totalCves || 0,
        run.errorMessage || null,
        run.jobId
      );
      return undefined;
    }

    const result = this.db.prepare(`
      INSERT INTO scrape_runs (job_id, started_at, status, options)
      VALUES (?, ?, ?, ?)
    `).run(
      run.jobId,
      run.startedAt || new Date().toISOString(),
      run.status || 'running',
      JSON.stringify(run.options || {})
    );
    return result.lastInsertRowid;
  }

  /**
   * Return the most recent scrape runs.
   *
   * @param {number} [limit=20]
   * @returns {Array<Object>}
   */
  getRuns(limit = 20) {
    const rows = this.db
      .prepare('SELECT * FROM scrape_runs ORDER BY started_at DESC LIMIT ?')
      .all(limit);

    return rows.map(row => ({
      id: row.id,
      jobId: row.job_id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      status: row.status,
      totalCves: row.total_cves,
      errorMessage: row.error_message,
      options: this._parseJSON(row.options, {})
    }));
  }

  // ── Checkpoint management ──────────────────────────────────────────────────

  /**
   * Persist a scraping checkpoint to the database.
   *
   * @param {Array<Object>} processedCVEs
   * @param {number}        currentIndex
   * @returns {number} Row ID of the saved checkpoint.
   */
  saveCheckpoint(processedCVEs, currentIndex) {
    const result = this.db.prepare(`
      INSERT INTO checkpoints (processed_count, current_index, data)
      VALUES (?, ?, ?)
    `).run(
      processedCVEs.length,
      currentIndex,
      JSON.stringify(processedCVEs)
    );
    logger.info(`Checkpoint saved: ${processedCVEs.length} CVEs at index ${currentIndex}`);
    return result.lastInsertRowid;
  }

  /**
   * Load the most-recently saved checkpoint.
   *
   * @returns {Object|null}
   */
  getLatestCheckpoint() {
    const row = this.db
      .prepare('SELECT * FROM checkpoints ORDER BY id DESC LIMIT 1')
      .get();

    if (!row) {
      return null;
    }

    return {
      timestamp: row.created_at,
      processedCount: row.processed_count,
      currentIndex: row.current_index,
      data: this._parseJSON(row.data, [])
    };
  }

  // ── Execution rate limiting ────────────────────────────────────────────────

  /**
   * Record that a scraping run has started.
   *
   * @param {string} [jobType='manual']
   */
  recordExecution(jobType = 'manual') {
    this.db.prepare('INSERT INTO execution_log (job_type) VALUES (?)').run(jobType);
  }

  /**
   * Return the ISO-8601 timestamp of the last recorded execution, or null.
   *
   * @returns {string|null}
   */
  getLastExecution() {
    const row = this.db
      .prepare('SELECT executed_at FROM execution_log ORDER BY id DESC LIMIT 1')
      .get();
    return row ? row.executed_at : null;
  }

  /**
   * Check whether enough time has elapsed since the last execution.
   *
   * @param {number} [minIntervalMs=3600000] Minimum interval in milliseconds (default: 1 hour).
   * @returns {{ allowed: boolean, minutesRemaining: number }}
   */
  checkExecutionAllowed(minIntervalMs = 3600000) {
    const lastExecution = this.getLastExecution();
    if (!lastExecution) {
      return { allowed: true, minutesRemaining: 0 };
    }

    const elapsed = Date.now() - new Date(lastExecution).getTime();
    if (elapsed >= minIntervalMs) {
      return { allowed: true, minutesRemaining: 0 };
    }

    const minutesRemaining = Math.ceil((minIntervalMs - elapsed) / 60000);
    return { allowed: false, minutesRemaining };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Close the database connection.
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('SQLite database connection closed');
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * @private
   */
  _parseJSON(value, fallback) {
    if (!value) {
      return fallback;
    }
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance = null;

/**
 * Return (and lazily open) the shared database singleton.
 *
 * @param {string} [dbPath] Override the default path (useful in tests).
 * @returns {CVEDatabase}
 */
function getDatabase(dbPath) {
  if (!_instance) {
    _instance = new CVEDatabase(dbPath || config.database.path);
    _instance.open();
  }
  return _instance;
}

/**
 * Reset the singleton (intended for tests only).
 */
function _resetInstance() {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}

module.exports = { CVEDatabase, getDatabase, _resetInstance };
