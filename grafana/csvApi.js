'use strict';
const client = require('./client');
const { getTemplatingDefaults, interpolateQueryTarget, UnsupportedDatasourceError } = require('./interpolate');
const { framesToRows, rowsToCsv } = require('./dataframe');
const { findPanel, summarizePanels, PanelNotFoundError } = require('./panels');

async function queryPanelRows(server, dashboardJson, panel, varsMap, { timeFrom, timeTo } = {}) {
  const dsType = panel.datasource?.type || panel.targets?.[0]?.datasource?.type;
  const resolvedTargets = (panel.targets || []).map((t) => interpolateQueryTarget(t, varsMap, dsType));

  const payload = {
    queries: resolvedTargets.map((t) => ({ ...t, datasource: t.datasource || panel.datasource })),
    from: timeFrom || dashboardJson.dashboard.time?.from || 'now-6h',
    to: timeTo || dashboardJson.dashboard.time?.to || 'now',
  };

  const response = await client.postDsQuery(server, payload);
  return framesToRows(response);
}

async function queryPanelCsv(server, dashboardJson, panel, varsMap, opts) {
  const rows = await queryPanelRows(server, dashboardJson, panel, varsMap, opts);
  return { csv: rowsToCsv(rows), rowCount: rows.length };
}

/**
 * Fetches a single panel's data via Grafana's /api/ds/query HTTP API (bypasses the
 * browser DOM entirely) and returns it as a CSV string.
 * server: row from db/servers.js. job: row from db/jobs.js (must have panel_id set).
 * variables: resolved {name: value} map (job.variables_json already merged with dashboard defaults by the caller).
 */
async function fetchPanelCsv({ server, job, variables }) {
  const dashboardJson = await client.fetchDashboardByUid(server, job.dashboard_uid);
  const panel = findPanel(dashboardJson, job.panel_id);

  const varsMap = { ...getTemplatingDefaults(dashboardJson), ...variables };
  const { csv, rowCount } = await queryPanelCsv(server, dashboardJson, panel, varsMap, {
    timeFrom: job.time_from,
    timeTo: job.time_to,
  });

  return { csv, dashboardName: dashboardJson.dashboard.title, panelTitle: panel.title, rowCount };
}

/**
 * Fetches CSV for every data panel on a dashboard in one pass (one dashboard
 * fetch, one query per panel). Per-panel failures (e.g. an unsupported
 * datasource type) are isolated rather than failing the whole dashboard - the
 * caller gets a result per panel and decides what to do with failures.
 */
async function fetchAllPanelsCsv(server, dashboardUid, { variables, timeFrom, timeTo } = {}) {
  const dashboardJson = await client.fetchDashboardByUid(server, dashboardUid);
  const panels = summarizePanels(dashboardJson, { onlyWithTargets: true });
  const varsMap = { ...getTemplatingDefaults(dashboardJson), ...variables };

  const results = [];
  for (const summary of panels) {
    const panel = findPanel(dashboardJson, summary.id);
    try {
      const { csv, rowCount } = await queryPanelCsv(server, dashboardJson, panel, varsMap, { timeFrom, timeTo });
      results.push({ panelId: panel.id, panelTitle: panel.title, ok: true, csv, rowCount });
    } catch (err) {
      const message = err instanceof UnsupportedDatasourceError ? err.message : (err.message || String(err));
      results.push({ panelId: panel.id, panelTitle: panel.title, ok: false, message });
    }
  }

  return { dashboardName: dashboardJson.dashboard.title, results };
}

/**
 * Fetches a single panel's data as structured rows (not CSV text) - used by
 * the comparison feature, which needs the data as JSON to hand to a browser-
 * side LLM rather than as a downloadable file.
 */
async function fetchPanelData({ server, dashboardUid, panelId, variables, timeFrom, timeTo }) {
  const dashboardJson = await client.fetchDashboardByUid(server, dashboardUid);
  const panel = findPanel(dashboardJson, panelId);
  const varsMap = { ...getTemplatingDefaults(dashboardJson), ...variables };
  const rows = await queryPanelRows(server, dashboardJson, panel, varsMap, { timeFrom, timeTo });
  return { dashboardName: dashboardJson.dashboard.title, panelTitle: panel.title, rows };
}

module.exports = { fetchPanelCsv, fetchAllPanelsCsv, fetchPanelData, findPanel, PanelNotFoundError };
