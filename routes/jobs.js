'use strict';
const express = require('express');
const router = express.Router();
const parser = require('cron-parser');

const jobsDb = require('../db/jobs');
const serversDb = require('../db/servers');
const runsDb = require('../db/runs');
const scheduler = require('../scheduler');

function withNextRun(job) {
  let nextRun = null;
  try {
    if (job.enabled) nextRun = parser.parseExpression(job.cron_expression).next().toISOString();
  } catch {
    nextRun = null;
  }
  return { ...job, nextRun, scheduled: scheduler.isScheduled(job.id) };
}

router.get('/', (req, res) => {
  const filters = {
    q: req.query.q || undefined,
    serverId: req.query.server ? Number(req.query.server) : undefined,
    enabled: req.query.enabled === '' || req.query.enabled === undefined ? undefined : req.query.enabled === '1',
  };
  const jobs = jobsDb.list(filters).map(withNextRun);
  const createdCount = req.query.created ? Number(req.query.created) : 0;
  res.render('jobs/list', { jobs, servers: serversDb.list(), filters: req.query, createdCount });
});

router.get('/new', (req, res) => {
  // Populated when arriving from the dashboard browser's "Create job" links.
  const prefill = req.query.dashboard_uid ? {
    server_id: req.query.server_id ? Number(req.query.server_id) : undefined,
    dashboard_uid: req.query.dashboard_uid,
    dashboard_path: req.query.dashboard_path || null,
    panel_id: req.query.panel_id ? Number(req.query.panel_id) : null,
    panel_title: req.query.panel_title || null,
  } : null;
  res.render('jobs/form', { job: null, prefill, servers: serversDb.list(), error: null });
});

router.post('/', (req, res) => {
  const job = jobsDb.create(fieldsFromBody(req.body));
  scheduler.registerJob(job);
  res.redirect('/jobs');
});

// Literal routes must be registered before "/:id" below (see routes/servers.js for the
// bug this class of mistake caused: /:id would otherwise swallow /bulk, /cron-preview, etc).
router.post('/bulk', (req, res) => {
  const ids = [].concat(req.body.ids || []).map(Number).filter(Boolean);
  const action = req.body.action;
  ids.forEach((id) => {
    if (action === 'enable') {
      const job = jobsDb.setEnabled(id, true);
      scheduler.registerJob(job);
    } else if (action === 'disable') {
      jobsDb.setEnabled(id, false);
      scheduler.unregisterJob(id);
    } else if (action === 'delete') {
      scheduler.unregisterJob(id);
      jobsDb.remove(id);
    }
  });
  res.redirect('/jobs');
});

router.get('/cron-preview', (req, res) => {
  try {
    const interval = parser.parseExpression(req.query.expr || '');
    const next = [];
    for (let i = 0; i < 3; i++) next.push(interval.next().toISOString());
    res.json({ ok: true, next });
  } catch (err) {
    res.json({ ok: false, message: 'Invalid cron expression' });
  }
});

router.get('/:id', (req, res) => {
  const job = jobsDb.getById(req.params.id);
  if (!job) return res.status(404).send('Job not found');
  const server = serversDb.getById(job.server_id);
  const runs = runsDb.listByJob(job.id, { limit: 10 });
  res.render('jobs/detail', { job: withNextRun(job), server, runs });
});

router.get('/:id/edit', (req, res) => {
  const job = jobsDb.getById(req.params.id);
  if (!job) return res.status(404).send('Job not found');
  const origin = `${req.protocol}://${req.get('host')}`;
  res.render('jobs/form', { job, prefill: null, servers: serversDb.list(), error: null, origin });
});

router.post('/:id', (req, res) => {
  const job = jobsDb.update(req.params.id, fieldsFromBody(req.body));
  scheduler.rescheduleJob(job);
  res.redirect('/jobs');
});

router.post('/:id/delete', (req, res) => {
  scheduler.unregisterJob(Number(req.params.id));
  jobsDb.remove(req.params.id);
  res.redirect('/jobs');
});

router.post('/:id/toggle', (req, res) => {
  const job = jobsDb.getById(req.params.id);
  if (!job) return res.status(404).send('Job not found');
  const updated = jobsDb.setEnabled(job.id, !job.enabled);
  if (updated.enabled) scheduler.registerJob(updated);
  else scheduler.unregisterJob(updated.id);
  res.redirect('/jobs');
});

router.post('/:id/run-now', (req, res) => {
  const jobRunner = require('../jobRunner');
  const jobId = Number(req.params.id);
  jobRunner.runJob(jobId, { trigger: 'manual' }).catch((err) => {
    console.error(`manual run of job ${jobId} failed:`, err);
  });
  res.redirect(`/runs?job=${jobId}`);
});

router.post('/:id/clone', (req, res) => {
  const job = jobsDb.getById(req.params.id);
  if (!job) return res.status(404).send('Job not found');
  const clone = jobsDb.create({
    ...job,
    name: `${job.name} (copy)`,
    enabled: false, // land as a disabled draft so cloning never silently doubles a schedule
  });
  res.redirect(`/jobs/${clone.id}/edit`);
});

router.post('/:id/webhook-token/regenerate', (req, res) => {
  const job = jobsDb.regenerateWebhookToken(req.params.id);
  if (!job) return res.status(404).send('Job not found');
  res.redirect(`/jobs/${job.id}/edit`);
});

function fieldsFromBody(body) {
  const outputs = [];
  if (body.output_pdf === 'on') outputs.push('pdf');
  if (body.output_csv === 'on') outputs.push('csv');

  let variables = {};
  if (body.variables_json) {
    try {
      variables = JSON.parse(body.variables_json);
    } catch {
      variables = {};
    }
  }

  return {
    name: body.name,
    server_id: Number(body.server_id),
    dashboard_uid: body.dashboard_uid,
    dashboard_path: body.dashboard_path || null,
    panel_id: body.panel_id ? Number(body.panel_id) : null,
    panel_title: body.panel_title || null,
    variables_json: JSON.stringify(variables),
    outputs: JSON.stringify(outputs.length ? outputs : ['pdf']),
    cron_expression: body.cron_expression,
    enabled: body.enabled === 'on' || body.enabled === true,
    save_local: body.save_local === 'on' || body.save_local === true,
    save_path: body.save_path || null,
    pdf_format: body.pdf_format || 'A4',
    page_size_mode: body.page_size_mode || 'auto-fit-content',
    pdf_width: body.pdf_width ? Number(body.pdf_width) : null,
    time_from: body.time_from || null,
    time_to: body.time_to || null,
  };
}

module.exports = router;
