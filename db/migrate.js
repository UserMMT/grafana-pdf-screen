'use strict';
const { db } = require('./index');

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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_server ON jobs(server_id);

    CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      trigger_type TEXT NOT NULL CHECK(trigger_type IN ('cron','manual')),
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
}

module.exports = { migrate };
