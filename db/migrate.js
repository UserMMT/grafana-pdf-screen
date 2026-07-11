'use strict';
const crypto = require('crypto');
const { db } = require('./index');

function generateWebhookToken() {
  return crypto.randomBytes(24).toString('hex');
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS grafana_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      base_url TEXT NOT NULL,
      auth_method TEXT NOT NULL CHECK(auth_method IN ('none','basic','api_key')),
      auth_user TEXT,
      auth_pass TEXT,
      auth_api_key TEXT,
      timeout_s INTEGER NOT NULL DEFAULT 30,
      tls_skip_verify INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      server_id INTEGER NOT NULL REFERENCES grafana_servers(id),
      dashboard_uid TEXT NOT NULL,
      dashboard_path TEXT,
      panel_id INTEGER,
      panel_title TEXT,
      variables_json TEXT NOT NULL DEFAULT '{}',
      outputs TEXT NOT NULL DEFAULT '["pdf"]',
      cron_expression TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      save_local INTEGER NOT NULL DEFAULT 0,
      save_path TEXT,
      pdf_format TEXT DEFAULT 'A4',
      page_size_mode TEXT NOT NULL DEFAULT 'auto-fit-content' CHECK(page_size_mode IN ('auto-fit-content','fixed-format')),
      pdf_width INTEGER,
      time_from TEXT,
      time_to TEXT,
      webhook_token TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_server ON jobs(server_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_webhook_token ON jobs(webhook_token);

    CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      trigger_type TEXT NOT NULL CHECK(trigger_type IN ('cron','manual','webhook')),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','success','partial','error')),
      pdf_path TEXT,
      csv_path TEXT,
      error_text TEXT,
      detail_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_job ON job_runs(job_id, started_at DESC);
  `);

  migrateAddWebhookTokenColumn();
  migrateJobRunsTriggerCheck();
  backfillWebhookTokens();
}

// Additive migration for DBs created before webhook_token existed.
function migrateAddWebhookTokenColumn() {
  const columns = db.prepare(`PRAGMA table_info(jobs)`).all();
  const hasColumn = columns.some((c) => c.name === 'webhook_token');
  if (!hasColumn) {
    db.exec(`ALTER TABLE jobs ADD COLUMN webhook_token TEXT`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_webhook_token_unique ON jobs(webhook_token)`);
  }
}

// SQLite CHECK constraints can't be altered in place; recreate job_runs if an
// older DB's trigger_type CHECK doesn't yet allow 'webhook'.
function migrateJobRunsTriggerCheck() {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='job_runs'`).get();
  if (!row || row.sql.includes("'webhook'")) return;

  db.exec('BEGIN');
  try {
    db.exec(`ALTER TABLE job_runs RENAME TO job_runs_old`);
    db.exec(`
      CREATE TABLE job_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL REFERENCES jobs(id),
        trigger_type TEXT NOT NULL CHECK(trigger_type IN ('cron','manual','webhook')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','success','partial','error')),
        pdf_path TEXT,
        csv_path TEXT,
        error_text TEXT,
        detail_json TEXT
      )
    `);
    db.exec(`
      INSERT INTO job_runs (id, job_id, trigger_type, started_at, finished_at, status, pdf_path, csv_path, error_text, detail_json)
      SELECT id, job_id, trigger_type, started_at, finished_at, status, pdf_path, csv_path, error_text, detail_json FROM job_runs_old
    `);
    db.exec(`DROP TABLE job_runs_old`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_job ON job_runs(job_id, started_at DESC)`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function backfillWebhookTokens() {
  const rows = db.prepare(`SELECT id FROM jobs WHERE webhook_token IS NULL`).all();
  const update = db.prepare(`UPDATE jobs SET webhook_token = ? WHERE id = ?`);
  for (const row of rows) {
    update.run(generateWebhookToken(), row.id);
  }
}

module.exports = { migrate, generateWebhookToken };
