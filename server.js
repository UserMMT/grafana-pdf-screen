'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');

const { migrate } = require('./db/migrate');
const browserPool = require('./grafana/browserPool');
const scheduler = require('./scheduler');

const serversRouter = require('./routes/servers');
const jobsRouter = require('./routes/jobs');
const runsRouter = require('./routes/runs');
const dashboardsRouter = require('./routes/dashboards');
const webhooksRouter = require('./routes/webhooks');
const browseRouter = require('./routes/browse');
const compareRouter = require('./routes/compare');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/jobs'));
app.use('/servers', serversRouter);
app.use('/jobs', jobsRouter);
app.use('/runs', runsRouter);
app.use('/api', dashboardsRouter);
app.use('/webhooks', webhooksRouter);
app.use('/browse', browseRouter);
app.use('/compare', compareRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { error: err });
});

async function main() {
  migrate();
  await browserPool.initBrowser({
    executablePath: process.env.GRAFANA_PDF_CHROME_PATH || undefined,
  });
  scheduler.loadAllJobs();

  const port = process.env.PORT || process.env.GRAFANA_PDF_BIND_PORT || 5555;
  const host = process.env.HOST || process.env.GRAFANA_PDF_BIND_HOST || '0.0.0.0';
  const server = app.listen(port, host, () => {
    console.log(`Grafana report admin listening at http://${host}:${port}`);
  });

  async function shutdown(signal) {
    console.log(`Received ${signal}, shutting down...`);
    scheduler.stopAll();
    server.close();
    await browserPool.closeBrowser();
    process.exit(0);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
