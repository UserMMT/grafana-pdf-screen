'use strict';
const express = require('express');
const router = express.Router();

const serversDb = require('../db/servers');
const client = require('../grafana/client');

router.get('/servers/:id/dashboards', async (req, res) => {
  const server = serversDb.getById(req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  try {
    const results = await client.searchDashboards(server, req.query.q || '');
    res.json(results.map((d) => ({ uid: d.uid, title: d.title, url: d.url })));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/servers/:id/dashboards/:uid', async (req, res) => {
  const server = serversDb.getById(req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  try {
    const dashboardJson = await client.fetchDashboardByUid(server, req.params.uid);
    const dashboard = dashboardJson.dashboard;
    const panels = [];
    for (const p of dashboard.panels || []) {
      if (p.type !== 'row' && p.targets && p.targets.length) {
        panels.push({ id: p.id, title: p.title, datasourceType: p.datasource?.type || p.targets[0]?.datasource?.type });
      }
      if (p.type === 'row' && Array.isArray(p.panels)) {
        for (const sub of p.panels) {
          if (sub.targets && sub.targets.length) {
            panels.push({ id: sub.id, title: sub.title, datasourceType: sub.datasource?.type || sub.targets[0]?.datasource?.type });
          }
        }
      }
    }
    const variables = (dashboard.templating?.list || []).map((v) => ({
      name: v.name,
      label: v.label || v.name,
      default: v.current?.value,
      options: (v.options || []).map((o) => o.value),
    }));
    res.json({
      path: dashboardJson.meta?.url || `/d/${req.params.uid}`,
      title: dashboard.title,
      panels,
      variables,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
