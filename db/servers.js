'use strict';
const { db } = require('./index');

function nowIso() {
  return new Date().toISOString();
}

function list() {
  return db.prepare('SELECT * FROM grafana_servers ORDER BY name').all();
}

function getById(id) {
  return db.prepare('SELECT * FROM grafana_servers WHERE id = ?').get(id);
}

function create(fields) {
  const ts = nowIso();
  const stmt = db.prepare(`
    INSERT INTO grafana_servers
      (name, base_url, auth_method, auth_user, auth_pass, auth_api_key, timeout_s, tls_skip_verify, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    fields.name,
    fields.base_url,
    fields.auth_method,
    fields.auth_user || null,
    fields.auth_pass || null,
    fields.auth_api_key || null,
    fields.timeout_s ?? 30,
    fields.tls_skip_verify ? 1 : 0,
    ts,
    ts
  );
  return getById(info.lastInsertRowid);
}

function update(id, fields) {
  const ts = nowIso();
  db.prepare(`
    UPDATE grafana_servers SET
      name = ?, base_url = ?, auth_method = ?, auth_user = ?, auth_pass = ?,
      auth_api_key = ?, timeout_s = ?, tls_skip_verify = ?, updated_at = ?
    WHERE id = ?
  `).run(
    fields.name,
    fields.base_url,
    fields.auth_method,
    fields.auth_user || null,
    fields.auth_pass || null,
    fields.auth_api_key || null,
    fields.timeout_s ?? 30,
    fields.tls_skip_verify ? 1 : 0,
    ts,
    id
  );
  return getById(id);
}

function remove(id) {
  db.prepare('DELETE FROM grafana_servers WHERE id = ?').run(id);
}

function countJobsForServer(id) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE server_id = ?').get(id);
  return row.c;
}

module.exports = { list, getById, create, update, remove, countJobsForServer };
