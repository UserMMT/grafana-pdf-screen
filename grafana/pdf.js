'use strict';
const path = require('path');
const browserPool = require('./browserPool');
const client = require('./client');
const { resolveOutputDir, safeSegment, dateStamp } = require('./outputPath');

const DEFAULT_WIDTH = Number(process.env.GRAFANA_PDF_WIDTH || 1920);

// Grafana's dashboard-grid/scroll-container class names have changed across versions
// (Angular -> React -> Scenes) and will likely change again. Bail out safely instead of
// hanging the puppeteer protocol call forever when the expected elements aren't present.
async function autoScroll(page) {
  return page.evaluate(async () => {
    return new Promise((resolve) => {
      const gridEl = document.getElementsByClassName('react-grid-layout')[0];
      const scrollableEl = document.querySelector('.view') || document.querySelector('.scrollbar-view');
      if (!gridEl || !scrollableEl) {
        resolve(0); // unknown Grafana DOM version: skip autoscroll, render what's already visible
        return;
      }
      let totalHeight = 0;
      const distance = 100;
      const heightPx = gridEl.getBoundingClientRect().bottom;
      const timer = setInterval(() => {
        try {
          scrollableEl.scrollBy({ top: distance, left: 0, behavior: 'smooth' });
          totalHeight += distance;
          if (totalHeight >= heightPx) {
            clearInterval(timer);
            resolve(totalHeight);
          }
        } catch (err) {
          clearInterval(timer);
          resolve(totalHeight);
        }
      }, 300);
      // hard stop in case the loop above never reaches heightPx (e.g. layout keeps growing)
      setTimeout(() => {
        clearInterval(timer);
        resolve(totalHeight);
      }, 30000);
    });
  });
}

/**
 * Renders a dashboard/panel to PDF via the shared puppeteer browser and returns the file path.
 * job: row from db/jobs.js. server: row from db/servers.js. variables: resolved {name: value} map.
 */
async function generatePdf({ server, job, variables }) {
  const browser = await browserPool.getBrowser();
  const page = await browser.newPage();
  const timeoutS = server.timeout_s || 30;
  if (timeoutS) {
    page.setDefaultNavigationTimeout(1000 * timeoutS);
  }

  const width = job.pdf_width || DEFAULT_WIDTH;
  const height = Math.round(1200 * Math.sqrt(2));
  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: false });

  if (server.auth_method !== 'none') {
    await page.setExtraHTTPHeaders(client.buildAuthHeaders(server));
  }

  const url = client.buildDashboardUrl(server, job, { variables });
  console.log('Fetching url:', url);
  await page.goto(url, { waitUntil: 'networkidle0' });

  let dashboardName = await page.evaluate(() => document.title.split('-')[0]);
  dashboardName = safeSegment((dashboardName || job.dashboard_uid).trim());

  let totalHeight = await autoScroll(page);
  if (!totalHeight) {
    // autoScroll couldn't find Grafana's grid/scroll classes (DOM changed again, or a
    // short dashboard with no scroll container) - fall back to a generic DOM measurement
    // so we don't render a near-empty page.
    totalHeight = await page.evaluate(() => document.body.scrollHeight);
  }

  const date = new Date();
  const outDir = resolveOutputDir({ job, dashboardName, panelTitle: 'dashboard', date });
  const fileName = `${dashboardName}__${dateStamp(date)}.pdf`;
  const filePath = path.join(outDir, fileName);

  const pdfOptions = {
    path: filePath,
    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    printBackground: true,
  };

  if (job.page_size_mode === 'fixed-format') {
    pdfOptions.format = job.pdf_format || 'A4';
  } else {
    pdfOptions.width = width + 'px';
    pdfOptions.height = Math.max(totalHeight, 1) + 'px';
    pdfOptions.scale = 1;
  }

  await page.pdf(pdfOptions);
  await page.close();

  console.log('Finished rendering PDF:', filePath);
  return { filePath, dashboardName, url };
}

module.exports = { generatePdf, autoScroll };
