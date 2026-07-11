'use strict';
const express = require('express');
const router = express.Router();
const parser = require('cron-parser');

const jobsDb = require('../db/jobs');
const serversDb = require('../db/servers');
const scheduler = require('../scheduler');

router.get('/', (req, res) => {
  const jobs = jobsDb.list().map((job) => {
    let nextRun = null;
    try {
      if (job.enabled) nextRun = parser.parseExpression(job.cron_expression).next().toISOString();
    } catch {
      nextRun = null;
    }
    return { ...job, nextRun, scheduled: scheduler.isScheduled(job.id) };
  });
  res.render('jobs/list', { jobs });
});

router.get('/new', (req, res) => {
  res.render('jobs/form', { job: null, servers: serversDb.list(), error: null });
});

router.post('/', (req, res) => {
  const job = jobsDb.create(fieldsFromBody(req.body));
  scheduler.registerJob(job);
  res.redirect('/jobs');
});

router.get('/:id/edit', (req, res) => {
  const job = jobsDb.getById(req.params.id);
  if (!job) return res.status(404).send('Job not found');
  res.render('jobs/form', { job, servers: serversDb.list(), error: null });
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
    enabled: body.enabled === 'on',
    save_local: body.save_local === 'on',
    save_path: body.save_path || null,
    pdf_format: body.pdf_format || 'A4',
    page_size_mode: body.page_size_mode || 'auto-fit-content',
    pdf_width: body.pdf_width ? Number(body.pdf_width) : null,
    time_from: body.time_from || null,
    time_to: body.time_to || null,
  };
}

module.exports = router;
