'use strict';
const { db } = require('./index');
const { generateWebhookToken } = require('./migrate');

function nowIso() {
  return new Date().toISOString();
}

function list({ q, serverId, enabled } = {}) {
  const clauses = [];
  const params = [];
  if (q) {
    clauses.push('jobs.name LIKE ?');
    params.push(`%${q}%`);
  }
  if (serverId) {
    clauses.push('jobs.server_id = ?');
    params.push(serverId);
  }
  if (enabled !== undefined && enabled !== null && enabled !== '') {
    clauses.push('jobs.enabled = ?');
    params.push(enabled ? 1 : 0);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT jobs.*, grafana_servers.name AS server_name
    FROM jobs JOIN grafana_servers ON grafana_servers.id = jobs.server_id
    ${where}
    ORDER BY jobs.name
  `).all(...params);
}

function listEnabled() {
  return db.prepare('SELECT * FROM jobs WHERE enabled = 1').all();
}

function getById(id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

function getByWebhookToken(token) {
  return db.prepare('SELECT * FROM jobs WHERE webhook_token = ?').get(token);
}

function create(fields) {
  const ts = nowIso();
  const stmt = db.prepare(`
    INSERT INTO jobs
      (name, server_id, dashboard_uid, dashboard_path, panel_id, panel_title,
       variables_json, outputs, cron_expression, enabled, save_local, save_path,
       pdf_format, page_size_mode, pdf_width, time_from, time_to, webhook_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    fields.name,
    fields.server_id,
    fields.dashboard_uid,
    fields.dashboard_path || null,
    fields.panel_id ?? null,
    fields.panel_title || null,
    fields.variables_json || '{}',
    fields.outputs || '["pdf"]',
    fields.cron_expression,
    fields.enabled === undefined ? 1 : (fields.enabled ? 1 : 0),
    fields.save_local ? 1 : 0,
    fields.save_path || null,
    fields.pdf_format || 'A4',
    fields.page_size_mode || 'auto-fit-content',
    fields.pdf_width ?? null,
    fields.time_from || null,
    fields.time_to || null,
    generateWebhookToken(),
    ts,
    ts
  );
  return getById(info.lastInsertRowid);
}

function update(id, fields) {
  const ts = nowIso();
  db.prepare(`
    UPDATE jobs SET
      name = ?, server_id = ?, dashboard_uid = ?, dashboard_path = ?, panel_id = ?, panel_title = ?,
      variables_json = ?, outputs = ?, cron_expression = ?, enabled = ?, save_local = ?, save_path = ?,
      pdf_format = ?, page_size_mode = ?, pdf_width = ?, time_from = ?, time_to = ?, updated_at = ?
    WHERE id = ?
  `).run(
    fields.name,
    fields.server_id,
    fields.dashboard_uid,
    fields.dashboard_path || null,
    fields.panel_id ?? null,
    fields.panel_title || null,
    fields.variables_json || '{}',
    fields.outputs || '["pdf"]',
    fields.cron_expression,
    fields.enabled ? 1 : 0,
    fields.save_local ? 1 : 0,
    fields.save_path || null,
    fields.pdf_format || 'A4',
    fields.page_size_mode || 'auto-fit-content',
    fields.pdf_width ?? null,
    fields.time_from || null,
    fields.time_to || null,
    ts,
    id
  );
  return getById(id);
}

function setEnabled(id, enabled) {
  db.prepare('UPDATE jobs SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, nowIso(), id);
  return getById(id);
}

function regenerateWebhookToken(id) {
  const token = generateWebhookToken();
  db.prepare('UPDATE jobs SET webhook_token = ?, updated_at = ? WHERE id = ?').run(token, nowIso(), id);
  return getById(id);
}

function remove(id) {
  db.prepare('DELETE FROM job_runs WHERE job_id = ?').run(id);
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

module.exports = {
  list,
  listEnabled,
  getById,
  getByWebhookToken,
  create,
  update,
  setEnabled,
  regenerateWebhookToken,
  remove,
};
