'use strict';
const express = require('express');
const router = express.Router();
const fs = require('fs');

const runsDb = require('../db/runs');
const jobsDb = require('../db/jobs');

router.get('/', (req, res) => {
  const jobId = req.query.job ? Number(req.query.job) : null;
  const status = req.query.status || null;
  const runs = jobId ? runsDb.listByJob(jobId) : runsDb.listAll({ status });
  const job = jobId ? jobsDb.getById(jobId) : null;
  res.render('runs/list', { runs, job, status });
});

router.get('/:id', (req, res) => {
  const run = runsDb.getById(req.params.id);
  if (!run) return res.status(404).send('Run not found');
  let detail = null;
  try {
    detail = run.detail_json ? JSON.parse(run.detail_json) : null;
  } catch {
    detail = null;
  }
  res.render('runs/detail', { run, detail });
});

router.get('/:id/download/:kind', (req, res) => {
  const run = runsDb.getById(req.params.id);
  if (!run) return res.status(404).send('Run not found');
  const filePath = req.params.kind === 'pdf' ? run.pdf_path : req.params.kind === 'csv' ? run.csv_path : null;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('File not available (may have been in tmp/ and cleaned up)');
  res.download(filePath);
});

module.exports = router;
