'use strict';
const express = require('express');
const router = express.Router();

const serversDb = require('../db/servers');
const csvApi = require('../grafana/csvApi');

const MAX_ROWS = 80; // keep the prompt small enough for a small in-browser model's context window

router.get('/', (req, res) => {
  res.render('compare', { servers: serversDb.list() });
});

// AJAX: fetches one side's panel data as JSON rows (capped) for the browser to feed to WebLLM.
router.get('/data', async (req, res) => {
  const server = serversDb.getById(req.query.server_id);
  if (!server) return res.status(404).json({ ok: false, message: 'Server not found' });

  let variables = {};
  if (req.query.variables) {
    try { variables = JSON.parse(req.query.variables); } catch { variables = {}; }
  }

  try {
    const { dashboardName, panelTitle, rows } = await csvApi.fetchPanelData({
      server,
      dashboardUid: req.query.dashboard_uid,
      panelId: Number(req.query.panel_id),
      variables,
      timeFrom: req.query.time_from || undefined,
      timeTo: req.query.time_to || undefined,
    });
    const truncated = rows.length > MAX_ROWS;
    res.json({
      ok: true,
      dashboardName,
      panelTitle,
      rowCount: rows.length,
      truncated,
      rows: truncated ? rows.slice(0, MAX_ROWS) : rows,
    });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

module.exports = router;
