'use strict';
const { db } = require('./index');

function nowIso() {
  return new Date().toISOString();
}

function insertStart({ jobId, triggerType }) {
  const info = db.prepare(`
    INSERT INTO job_runs (job_id, trigger_type, started_at, status)
    VALUES (?, ?, ?, 'running')
  `).run(jobId, triggerType, nowIso());
  return info.lastInsertRowid;
}

function finish(runId, { status, pdfPath, csvPath, errorText, detail }) {
  db.prepare(`
    UPDATE job_runs SET
      finished_at = ?, status = ?, pdf_path = ?, csv_path = ?, error_text = ?, detail_json = ?
    WHERE id = ?
  `).run(
    nowIso(),
    status,
    pdfPath || null,
    csvPath || null,
    errorText || null,
    detail ? JSON.stringify(detail) : null,
    runId
  );
}

function listAll({ jobId, status, limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (jobId) {
    clauses.push('job_runs.job_id = ?');
    params.push(jobId);
  }
  if (status) {
    clauses.push('job_runs.status = ?');
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT job_runs.*, jobs.name AS job_name
    FROM job_runs JOIN jobs ON jobs.id = job_runs.job_id
    ${where}
    ORDER BY started_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
}

function listByJob(jobId, { limit = 50, offset = 0 } = {}) {
  return listAll({ jobId, limit, offset });
}

function getById(id) {
  return db.prepare(`
    SELECT job_runs.*, jobs.name AS job_name
    FROM job_runs JOIN jobs ON jobs.id = job_runs.job_id
    WHERE job_runs.id = ?
  `).get(id);
}

module.exports = { insertStart, finish, listByJob, listAll, getById };
