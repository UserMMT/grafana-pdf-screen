'use strict';
const path = require('path');
const fs = require('fs');

const DEFAULT_OUTPUT_ROOT = process.env.OUTPUT_ROOT
  ? path.resolve(process.env.OUTPUT_ROOT)
  : path.resolve(__dirname, '..', 'data', 'output');

const TMP_ROOT = path.resolve(__dirname, '..', 'tmp');

function safeSegment(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function dateStamp(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Resolves the directory a job's output file should be written to.
 * job.save_local truthy -> under job.save_path (or DEFAULT_OUTPUT_ROOT) with {dashboard}/{panel}/{date} tokens.
 * otherwise -> tmp/ (ephemeral, cleared at operator's discretion).
 */
function resolveOutputDir({ job, dashboardName, panelTitle, date }) {
  if (!job.save_local) {
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    return TMP_ROOT;
  }
  const template = job.save_path || DEFAULT_OUTPUT_ROOT;
  const resolved = template
    .replace('{dashboard}', safeSegment(dashboardName))
    .replace('{panel}', safeSegment(panelTitle))
    .replace('{date}', dateStamp(date));
  const dir = path.isAbsolute(resolved) ? resolved : path.resolve(DEFAULT_OUTPUT_ROOT, resolved);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { resolveOutputDir, safeSegment, dateStamp, DEFAULT_OUTPUT_ROOT, TMP_ROOT };
