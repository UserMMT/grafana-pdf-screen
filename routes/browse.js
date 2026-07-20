'use strict';
const express = require('express');
const router = express.Router();

const serversDb = require('../db/servers');
const jobsDb = require('../db/jobs');
const client = require('../grafana/client');
const { summarizePanels } = require('../grafana/panels');
const scheduler = require('../scheduler');

function parseCrumbs(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

router.get('/', (req, res) => {
  res.render('browse/index', { servers: serversDb.list() });
});

router.get('/:serverId', async (req, res) => {
  const server = serversDb.getById(req.params.serverId);
  if (!server) return res.status(404).send('Server not found');

  const crumbs = parseCrumbs(req.query.crumbs);
  const currentFolder = crumbs.length ? crumbs[crumbs.length - 1] : null;
  const q = req.query.q || '';

  try {
    if (q) {
      const results = await client.searchDashboards(server, q);
      return res.render('browse/folder', {
        server, crumbs, q, currentFolder, folders: [], dashboards: results, error: null,
      });
    }
    const [folders, dashboards] = await Promise.all([
      client.listFolders(server, currentFolder ? currentFolder.uid : undefined),
      client.listDashboardsInFolder(server, currentFolder ? currentFolder.uid : undefined),
    ]);
    res.render('browse/folder', { server, crumbs, q: '', currentFolder, folders, dashboards, error: null });
  } catch (err) {
    res.render('browse/folder', { server, crumbs, q, currentFolder, folders: [], dashboards: [], error: err.message });
  }
});

router.get('/:serverId/dashboard/:uid', async (req, res) => {
  const server = serversDb.getById(req.params.serverId);
  if (!server) return res.status(404).send('Server not found');
  const crumbs = parseCrumbs(req.query.crumbs);

  try {
    const dashboardJson = await client.fetchDashboardByUid(server, req.params.uid);
    const dashboard = dashboardJson.dashboard;
    const panels = summarizePanels(dashboardJson, { onlyWithTargets: false });
    const path = dashboardJson.meta?.url || `/d/${req.params.uid}`;
    const slug = path.split('/').filter(Boolean)[1] || req.params.uid;
    res.render('browse/dashboard', {
      server, crumbs, dashboard, panels, dashboardUid: req.params.uid, dashboardPath: path, slug, error: null,
    });
  } catch (err) {
    res.render('browse/dashboard', {
      server, crumbs, dashboard: null, panels: [], dashboardUid: req.params.uid, dashboardPath: null, slug: null, error: err.message,
    });
  }
});

function parseSelectedDashboards(body) {
  const raw = [].concat(body.dashboards || []);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    try {
      const d = JSON.parse(item);
      if (d && d.uid && !seen.has(d.uid)) {
        seen.add(d.uid);
        out.push({ uid: d.uid, title: d.title || d.uid, path: d.path || `/d/${d.uid}` });
      }
    } catch {
      // ignore malformed entries rather than failing the whole batch
    }
  }
  return out;
}

// Step 1: show the shared-settings form for the dashboards selected on the folder page.
router.post('/:serverId/bulk-create', (req, res) => {
  const server = serversDb.getById(req.params.serverId);
  if (!server) return res.status(404).send('Server not found');
  const dashboards = parseSelectedDashboards(req.body);
  if (!dashboards.length) return res.redirect(`/browse/${server.id}`);
  res.render('browse/bulk-create', { server, dashboards, error: null });
});

// Step 2: actually create one whole-dashboard PDF job per selected dashboard.
router.post('/:serverId/bulk-create/confirm', (req, res) => {
  const server = serversDb.getById(req.params.serverId);
  if (!server) return res.status(404).send('Server not found');
  const dashboards = parseSelectedDashboards(req.body);
  if (!dashboards.length) return res.redirect(`/browse/${server.id}`);

  const shared = {
    server_id: server.id,
    outputs: JSON.stringify(['pdf']),
    cron_expression: req.body.cron_expression,
    enabled: req.body.enabled === 'on',
    save_local: req.body.save_local === 'on',
    save_path: req.body.save_path || null,
    pdf_format: req.body.pdf_format || 'A4',
    page_size_mode: req.body.page_size_mode || 'auto-fit-content',
    pdf_width: req.body.pdf_width ? Number(req.body.pdf_width) : null,
    time_from: req.body.time_from || null,
    time_to: req.body.time_to || null,
  };

  const created = dashboards.map((d) => {
    const job = jobsDb.create({
      ...shared,
      name: d.title,
      dashboard_uid: d.uid,
      dashboard_path: d.path,
      panel_id: null,
      panel_title: null,
      variables_json: '{}',
    });
    scheduler.registerJob(job);
    return job;
  });

  res.redirect(`/jobs?created=${created.length}`);
});

// Server-side proxy for Grafana's panel image renderer: credentials never
// leave the server, and the <img> tag on the browse page just points here.
router.get('/:serverId/render/:uid/:panelId', async (req, res) => {
  const server = serversDb.getById(req.params.serverId);
  if (!server) return res.status(404).end();
  try {
    const { buffer, contentType } = await client.renderPanelImage(server, {
      uid: req.params.uid,
      slug: req.query.slug,
      panelId: req.params.panelId,
      width: Number(req.query.w) || 320,
      height: Number(req.query.h) || 180,
    });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(buffer);
  } catch (err) {
    res.status(204).end(); // let the <img>'s onerror handler show a text placeholder
  }
});

module.exports = router;
