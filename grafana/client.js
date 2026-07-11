'use strict';

class GrafanaApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'GrafanaApiError';
    this.status = status;
    this.body = body;
  }
}

function buildAuthHeaders(server) {
  const headers = {};
  if (server.auth_method === 'api_key' && server.auth_api_key) {
    headers['Authorization'] = 'Bearer ' + server.auth_api_key;
  } else if (server.auth_method === 'basic' && server.auth_user && server.auth_pass) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${server.auth_user}:${server.auth_pass}`).toString('base64');
  }
  return headers;
}

function baseUrl(server) {
  return server.base_url.replace(/\/+$/, '');
}

/**
 * Builds the browser-facing dashboard URL (used by puppeteer for PDF rendering):
 * {base_url}{dashboard_path}?var-x=y&from=...&to=...&kiosk
 */
function buildDashboardUrl(server, job, { variables }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(variables || {})) {
    if (value !== undefined && value !== null && value !== '') {
      params.append(`var-${key}`, value);
    }
  }
  if (job.time_from) params.set('from', job.time_from);
  if (job.time_to) params.set('to', job.time_to);
  params.set('kiosk', '');
  const qs = params.toString().replace(/=$/, '').replace(/=&/g, '&');
  const dashboardPath = job.dashboard_path || `/d/${job.dashboard_uid}`;
  return `${baseUrl(server)}${dashboardPath}?${qs}`;
}

async function apiFetch(server, urlPath, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timeoutMs = (server.timeout_s || 30) * 1000;
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${baseUrl(server)}${urlPath}`, {
      method,
      headers: {
        ...buildAuthHeaders(server),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      throw new GrafanaApiError(`Grafana API ${method} ${urlPath} failed: ${res.status} ${res.statusText}`, {
        status: res.status,
        body: json || text,
      });
    }
    return json;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fetchDashboardByUid(server, uid) {
  return apiFetch(server, `/api/dashboards/uid/${encodeURIComponent(uid)}`);
}

function postDsQuery(server, payload) {
  return apiFetch(server, '/api/ds/query', { method: 'POST', body: payload });
}

function searchDashboards(server, query) {
  const qs = query ? `?query=${encodeURIComponent(query)}&type=dash-db` : '?type=dash-db';
  return apiFetch(server, `/api/search${qs}`);
}

async function testConnection(server) {
  try {
    const res = await apiFetch(server, '/api/health');
    return { ok: true, message: `Connected (${res && res.version ? 'Grafana ' + res.version : 'ok'})` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

module.exports = {
  GrafanaApiError,
  buildAuthHeaders,
  buildDashboardUrl,
  fetchDashboardByUid,
  postDsQuery,
  searchDashboards,
  testConnection,
  baseUrl,
};
