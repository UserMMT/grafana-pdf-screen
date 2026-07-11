'use strict';
const express = require('express');
const router = express.Router();

const jobsDb = require('../db/jobs');

// External systems POST here to trigger a job run on demand. The token itself
// is the auth (no job id needed in the URL) — treat it like a bearer secret.
router.post('/:token', (req, res) => {
  const job = jobsDb.getByWebhookToken(req.params.token);
  if (!job) return res.status(404).json({ ok: false, message: 'Unknown webhook token' });

  const jobRunner = require('../jobRunner');
  jobRunner.runJob(job.id, { trigger: 'webhook' }).catch((err) => {
    console.error(`webhook-triggered run of job ${job.id} failed:`, err);
  });

  res.status(202).json({ ok: true, message: `Run started for job "${job.name}"`, jobId: job.id });
});

module.exports = router;
