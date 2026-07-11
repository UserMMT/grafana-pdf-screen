'use strict';

class PanelNotFoundError extends Error {
  constructor(panelId) {
    super(`panel ${panelId} not found on dashboard`);
    this.name = 'PanelNotFoundError';
    this.panelId = panelId;
  }
}

// Grafana nests panels inside collapsed rows (type:'row'); this flattens both
// levels into one list of raw panel objects (rows themselves excluded).
function flattenPanels(dashboardJson) {
  const panels = dashboardJson?.dashboard?.panels || [];
  const flat = [];
  for (const p of panels) {
    if (p.type === 'row') {
      if (Array.isArray(p.panels)) flat.push(...p.panels);
    } else {
      flat.push(p);
    }
  }
  return flat;
}

function findPanel(dashboardJson, panelId) {
  const panel = flattenPanels(dashboardJson).find((p) => p.id === panelId);
  if (!panel) throw new PanelNotFoundError(panelId);
  return panel;
}

// Lightweight summary for UI pickers/browsers. onlyWithTargets restricts to
// panels that actually query data (excludes text/markdown/row panels) - used
// by the job form's CSV panel picker; the dashboard browser shows everything.
function summarizePanels(dashboardJson, { onlyWithTargets = false } = {}) {
  return flattenPanels(dashboardJson)
    .filter((p) => !onlyWithTargets || (p.targets && p.targets.length))
    .map((p) => ({
      id: p.id,
      title: p.title,
      type: p.type,
      hasData: !!(p.targets && p.targets.length),
      datasourceType: p.datasource?.type || p.targets?.[0]?.datasource?.type,
    }));
}

module.exports = { flattenPanels, findPanel, summarizePanels, PanelNotFoundError };
