'use strict';
const fs = require('fs');
const path = require('path');

const jobsDb = require('./db/jobs');
const serversDb = require('./db/servers');
const runsDb = require('./db/runs');
const pdf = require('./grafana/pdf');
const csvApi = require('./grafana/csvApi');

async function runJob(jobId, { trigger }) {
  const job = jobsDb.getById(jobId);
  if (!job) throw new Error(`job ${jobId} not found`);
  const server = serversDb.getById(job.server_id);
  if (!server) throw new Error(`server ${job.server_id} not found for job ${jobId}`);

  const outputs = JSON.parse(job.outputs || '["pdf"]');
  const variables = JSON.parse(job.variables_json || '{}');

  const runId = runsDb.insertStart({ jobId: job.id, triggerType: trigger });
  const detail = {
    server: server.name,
    dashboardUid: job.dashboard_uid,
    panelId: job.panel_id,
    panelTitle: job.panel_title,
    variables,
    startedAt: new Date().toISOString(),
  };

  let pdfPath = null;
  let csvPath = null;
  const errors = [];

  if (outputs.includes('pdf')) {
    try {
      const result = await pdf.generatePdf({ server, job, variables });
      pdfPath = result.filePath;
      detail.pdfUrl = result.url;
      detail.dashboardName = result.dashboardName;
    } catch (err) {
      errors.push(`pdf: ${err.message}`);
    }
  }

  if (outputs.includes('csv')) {
    try {
      const { csv, dashboardName, panelTitle, rowCount } = await csvApi.fetchPanelCsv({ server, job, variables });
      csvPath = writeCsvFile({ job, dashboardName, panelTitle, csv });
      detail.csvRowCount = rowCount;
      detail.dashboardName = detail.dashboardName || dashboardName;
      detail.panelTitle = detail.panelTitle || panelTitle;
    } catch (err) {
      errors.push(`csv: ${err.message}`);
    }
  }

  detail.finishedAt = new Date().toISOString();

  let status;
  if (errors.length === 0) status = 'success';
  else if (errors.length < outputs.length) status = 'partial';
  else status = 'error';

  runsDb.finish(runId, {
    status,
    pdfPath,
    csvPath,
    errorText: errors.length ? errors.join('; ') : null,
    detail,
  });

  return { runId, status, pdfPath, csvPath, errors };
}

function writeCsvFile({ job, dashboardName, panelTitle, csv }) {
  const { resolveOutputDir, safeSegment, dateStamp } = require('./grafana/outputPath');
  const date = new Date();
  const outDir = resolveOutputDir({ job, dashboardName, panelTitle, date });
  const fileName = `${safeSegment(dashboardName)}__${safeSegment(panelTitle)}__${dateStamp(date)}.csv`;
  const filePath = path.join(outDir, fileName);
  fs.writeFileSync(filePath, csv, 'utf8');
  return filePath;
}

module.exports = { runJob };
