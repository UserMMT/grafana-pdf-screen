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

// Root folder is represented by Grafana as uid=null/undefined; omitting parentUid
// lists root-level folders, passing a folder's uid lists its direct children.
function listFolders(server, parentUid) {
  const qs = parentUid ? `?parentUid=${encodeURIComponent(parentUid)}` : '';
  return apiFetch(server, `/api/folders${qs}`);
}

function getFolder(server, uid) {
  return apiFetch(server, `/api/folders/${encodeURIComponent(uid)}`);
}

// folderUid undefined/null -> root/general folder (Grafana's sentinel: 'general').
function listDashboardsInFolder(server, folderUid) {
  return apiFetch(server, `/api/search?type=dash-db&folderUIDs=${encodeURIComponent(folderUid || 'general')}`);
}

class RenderUnavailableError extends Error {
  constructor(status) {
    super(`panel render endpoint returned ${status} (image renderer may not be installed on this Grafana instance)`);
    this.name = 'RenderUnavailableError';
    this.status = status;
  }
}

async function renderPanelImage(server, { uid, slug, panelId, width = 320, height = 180, tz = 'UTC' }) {
  const controller = new AbortController();
  const timeoutMs = (server.timeout_s || 30) * 1000;
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const path = `/render/d-solo/${encodeURIComponent(uid)}/${encodeURIComponent(slug || uid)}`
      + `?panelId=${encodeURIComponent(panelId)}&width=${width}&height=${height}&tz=${encodeURIComponent(tz)}`;
    const res = await fetch(`${baseUrl(server)}${path}`, {
      headers: buildAuthHeaders(server),
      signal: controller.signal,
    });
    if (!res.ok || !(res.headers.get('content-type') || '').startsWith('image/')) {
      throw new RenderUnavailableError(res.status);
    }
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') };
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  RenderUnavailableError,
  buildAuthHeaders,
  buildDashboardUrl,
  fetchDashboardByUid,
  postDsQuery,
  searchDashboards,
  listFolders,
  getFolder,
  listDashboardsInFolder,
  renderPanelImage,
  testConnection,
  baseUrl,
};
