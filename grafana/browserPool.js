'use strict';
const puppeteer = require('puppeteer');

let browser = null;
let launchOptions = null;
let shuttingDown = false;

async function launch(options) {
  launchOptions = options;
  console.log('Launching chromium:', options.executablePath || '(puppeteer builtin)');
  browser = await puppeteer.launch({
    executablePath: options.executablePath,
    headless: true,
    args: [
      '--ignore-certificate-errors',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
    timeout: 0,
  });
  browser.on('disconnected', () => {
    if (shuttingDown) return; // intentional closeBrowser() call, not a crash
    console.error('Chromium disconnected unexpectedly, relaunching...');
    browser = null;
    launch(launchOptions).catch((err) => console.error('Failed to relaunch chromium:', err));
  });
}

async function initBrowser(options) {
  await launch(options);
}

async function getBrowser() {
  if (!browser) {
    if (!launchOptions) {
      throw new Error('browserPool.initBrowser() must be called before getBrowser()');
    }
    await launch(launchOptions);
  }
  return browser;
}

async function closeBrowser() {
  shuttingDown = true;
  if (browser) {
    const b = browser;
    browser = null;
    await b.close();
  }
}

module.exports = { initBrowser, getBrowser, closeBrowser };
