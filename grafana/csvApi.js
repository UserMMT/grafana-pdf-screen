'use strict';
const client = require('./client');
const { getTemplatingDefaults, interpolateQueryTarget } = require('./interpolate');
const { framesToRows, rowsToCsv } = require('./dataframe');
const { findPanel, PanelNotFoundError } = require('./panels');

/**
 * Fetches a single panel's data via Grafana's /api/ds/query HTTP API (bypasses the
 * browser DOM entirely) and returns it as a CSV string.
 * server: row from db/servers.js. job: row from db/jobs.js (must have panel_id set).
 * variables: resolved {name: value} map (job.variables_json already merged with dashboard defaults by the caller).
 */
async function fetchPanelCsv({ server, job, variables }) {
  const dashboardJson = await client.fetchDashboardByUid(server, job.dashboard_uid);
  const panel = findPanel(dashboardJson, job.panel_id);

  const templatingDefaults = getTemplatingDefaults(dashboardJson);
  const varsMap = { ...templatingDefaults, ...variables };

  const dsType = panel.datasource?.type || panel.targets?.[0]?.datasource?.type;
  const resolvedTargets = (panel.targets || []).map((t) => interpolateQueryTarget(t, varsMap, dsType));

  const payload = {
    queries: resolvedTargets.map((t) => ({ ...t, datasource: t.datasource || panel.datasource })),
    from: job.time_from || dashboardJson.dashboard.time?.from || 'now-6h',
    to: job.time_to || dashboardJson.dashboard.time?.to || 'now',
  };

  const response = await client.postDsQuery(server, payload);
  const rows = framesToRows(response);
  const csv = rowsToCsv(rows);

  return { csv, dashboardName: dashboardJson.dashboard.title, panelTitle: panel.title, rowCount: rows.length };
}

module.exports = { fetchPanelCsv, findPanel, PanelNotFoundError };
