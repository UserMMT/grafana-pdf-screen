'use strict';
require('dotenv').config();
const { time } = require('console');
const http = require('http');
const puppeteer = require('puppeteer');

/**
 * Create a readable PDF stream by fetching the given URL with puppeteer.
 *
 * @param {string} url The URL to to the grafana dashboard
 * @param {object} options
 * @returns
 */
async function streamPdf(url, options) {
  const {
    backendUser,
    backendPass,
    timeoutDuration,
    backendNoLogin,
    backendPdfSaveLocal,
    executablePath,
    width = 1200,
    height = parseInt(1200 * Math.sqrt(2)),
  } = options;

  console.log('Launching chromium:', executablePath || '(puppeteer builtin)');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    timeout:0
  });

  const page = await browser.newPage();
  if (timeoutDuration) {
    page.setDefaultNavigationTimeout(1000*timeoutDuration)
  }
    // page.setDefaultNavigationTimeout(120000); //TODO Set this param variable for slow 
  await page.setViewport({
    width,
    height,
    deviceScaleFactor: 2,
    isMobile: false
  });

  console.log('Fetching url');
  if (backendNoLogin==0){
  if (backendUser && backendPass) {
    const authHeader = 'Basic ' + new Buffer.from(`${backendUser}:${backendPass}`).toString('base64');
    await page.setExtraHTTPHeaders({ 'Authorization': authHeader });
  }
}

  await page.goto(url, { waitUntil: 'networkidle0' });

  // Hide all panel description (top-left "i") pop-up handles and, all panel
  // resize handles. Annoyingly, it seems you can't concatenate the two object
  // collections into one.
  await page.evaluate(() => {
    const infoCorners = document.getElementsByClassName('panel-info-corner');
    for (el of infoCorners) { el.hidden = true; };
    const resizeHandles = document.getElementsByClassName('react-resizable-handle');
    for (el of resizeHandles) { el.hidden = true; };

  });
	// Get the height of the main canvas, and add a margin
     var height_px = await page.evaluate(() => {
      return document.getElementsByClassName('react-grid-layout')[0].getBoundingClientRect().bottom;
    }) + 20;

    // == auto scroll to the bottom to solve long grafana dashboard start
    async function autoScroll(page) {
      await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
          var totalHeight = 0;
          var distance = 100;
          var height_px = document.getElementsByClassName('react-grid-layout')[0].getBoundingClientRect().bottom;
          var timer = setInterval(() => {
            var scrollHeight = height_px;

            // select the scrollable view
            // in newer version of grafana the scrollable div is 'scrollbar-view'
            var scrollableEl = document.querySelector('.view') || document.querySelector('.scrollbar-view');
            // element.scrollBy(0, distance);
            scrollableEl.scrollBy({
              top: distance,
              left: 0,
              behavior: 'smooth'
            });

            totalHeight += distance;

            console.log('totalHeight', totalHeight)

            if (totalHeight >= scrollHeight) {
              clearInterval(timer);
              resolve();
            }
          }, 300);
        });
      });
    }

    await autoScroll(page);
    // == auto scroll to the bottom to solve long grafana dashboard end


  console.log('Rendering PDF');
  return (await page.createPDFStream({
    width: width +'px',
    height: height_px+'px',
    scale: 1,
    format: 'tabloid',
    displayHeaderFooter: false,
    margin: {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    // landscape:true,
    path : 'test.pdf',
    printBackground: true,
  })).on('close', () => {
    console.log('Finished rendering PDF');
    browser.close();
    console.log('Terminated chromium');
  });
}

function startServer(options) {
  const {
    port,
    host,
    backendUrl,
    backendUser,
    backendPass,
    timeoutDuration,
    backendPdfSaveLocal,
    backendNoLogin,
    executablePath
  } = options;

  return http.createServer(async (request, response) => {
    const kioskParam = request.url.indexOf('?') ? '&kiosk' : '?kiosk';
    const url = `${backendUrl}${request.url}${kioskParam}`;
    console.log(`Trying: ${url}`);

    try {
      const pdf = await streamPdf(url, { backendUser, backendPass, executablePath ,backendNoLogin,backendPdfSaveLocal,timeoutDuration});
      response.setHeader('Content-Type', 'application/pdf');
      pdf.pipe(response);
    }
    catch (e) {
      console.error(e);
      response.setHeader('Content-Type', 'text/html');
      response.statusCode = 500;
      response.end('<h1>Internal Server Error 500</h>');
    }
  }).listen(port, host);
}
// console.log(process.env)
const server = startServer({
  port: process.env.GRAFANA_PDF_BIND_PORT || '5555',
  host: process.env.GRAFANA_PDF_BIND_HOST || '::',
  backendUrl: process.env.GRAFANA_PDF_BACKEND_URL ,
  backendUser: process.env.GRAFANA_PDF_BACKEND_USER || 'admin',
  backendPass: process.env.GRAFANA_PDF_BACKEND_PASS || 'admin',
  executablePath: process.env.GRAFANA_PDF_CHROME_PATH ,
  timeoutDuration: process.env.GRAFANA_PDF_TIMEOUT_DURATION || '12',
  backendPdfSaveLocal: process.env.GRAFANA_PDF_SAVE_LOCAL || false,
  backendNoLogin: process.env.GRAFANA_PDF_BACKEND_NO_LOGIN || '0'
});

server.on('listening', () => {
  const { family, address, port } = server.address();
  const url = family == 'IPv6' ? `http://[${address}]:${port}`
                               : `http://${address}:${port}`;
  console.log(`Server running at ${url}`);
});
