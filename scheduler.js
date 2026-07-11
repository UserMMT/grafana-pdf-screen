'use strict';
const cron = require('node-cron');
const jobsDb = require('./db/jobs');

const tasks = new Map(); // jobId -> node-cron ScheduledTask

function registerJob(job) {
  unregisterJob(job.id);
  if (!job.enabled) return;
  if (!cron.validate(job.cron_expression)) {
    console.error(`job ${job.id} (${job.name}) has invalid cron expression "${job.cron_expression}", not scheduled`);
    return;
  }
  const task = cron.schedule(job.cron_expression, () => {
    const jobRunner = require('./jobRunner'); // lazy require avoids a require cycle at module-load time
    jobRunner.runJob(job.id, { trigger: 'cron' }).catch((err) => {
      console.error(`job ${job.id} (${job.name}) failed:`, err);
    });
  });
  tasks.set(job.id, task);
}

function unregisterJob(jobId) {
  const task = tasks.get(jobId);
  if (task) {
    task.stop();
    tasks.delete(jobId);
  }
}

function rescheduleJob(job) {
  registerJob(job);
}

function loadAllJobs() {
  const jobs = jobsDb.listEnabled();
  jobs.forEach(registerJob);
  console.log(`scheduler: registered ${tasks.size} of ${jobs.length} enabled job(s)`);
}

function stopAll() {
  for (const task of tasks.values()) task.stop();
  tasks.clear();
}

function isScheduled(jobId) {
  return tasks.has(jobId);
}

module.exports = { registerJob, unregisterJob, rescheduleJob, loadAllJobs, stopAll, isScheduled };
