Grafana Reports
===============

A scheduled Grafana reporting tool with a web admin UI. Connects to one or more Grafana
servers, renders dashboards/panels to PDF (via headless Chromium) and exports panel data
to CSV (via Grafana's `/api/ds/query` HTTP API), on a cron schedule you manage from the UI.

This merges two older single-purpose scripts:
- **PDF rendering** — originally this repo (`grafana-pdf-screen`): Puppeteer navigates to a
  dashboard in kiosk mode, auto-scrolls to force lazy-rendered panels to load, and renders a PDF.
  This work is based on [a gist by svet-b](https://gist.github.com/svet-b/1ad0656cd3ce0e1a633e16eb20f66425).
- **CSV export** — originally [`puppeteer_grafana_panel_download_csv`](https://github.com/CinquinAndy/klee_pypetter_grafana_auto_download_csv),
  which used to click through the Grafana panel-inspector DOM. That approach broke when Grafana
  moved off its old Angular/early-React panel UI. CSV export is now done via Grafana's HTTP query
  API instead (`grafana/csvApi.js`), which is more robust to future Grafana UI changes — though it
  currently only supports SQL-based datasources (`mssql`/`mysql`/`postgres`, see Limitations below).

Installation
------------

```
npm install
```

Optionally skip installation of `chromium` by puppeteer:

```
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm install
```

Requires Node.js 22.5+ (uses the built-in `node:sqlite` module — no native build step needed).

Running
-------

```
npm start
```

This starts the admin web UI (default `http://0.0.0.0:5555`, see `.env` below) where you:

1. **Servers** — add each Grafana instance you want to report on (base URL + auth: none / basic / API key).
2. **Jobs** — pick a server, search for a dashboard, optionally pick a panel (required for CSV
   output), set template variable values, choose outputs (PDF and/or CSV), and set a cron schedule.
3. **Run History** — see past runs, their status, error details, and download the produced files.

Environment (`.env`)
---------------------

These are process-level settings only. Per-Grafana-instance credentials now live in the
**Servers** UI (SQLite-backed), not in `.env` — see Configuration.md for the full mapping from
the old single-instance env vars to the new DB-backed model.

`PORT` / `GRAFANA_PDF_BIND_PORT`: port the admin UI listens on. Default `5555`.

`HOST` / `GRAFANA_PDF_BIND_HOST`: address the admin UI binds to. Default `0.0.0.0`.

`GRAFANA_PDF_CHROME_PATH`: path to a chrome/chromium executable. Puppeteer uses its builtin
chrome if omitted.

`GRAFANA_PDF_WIDTH`: default PDF render width in px (a job can override this per-job).

`DB_PATH`: path to the SQLite database file. Default `./data/app.db`.

`OUTPUT_ROOT`: default root directory for jobs with "save to disk" enabled. Default `./data/output`.

Legacy standalone proxy
------------------------

The original PDF-proxy-only server (`index.js`, no UI/scheduling/CSV) is still present and can
be run standalone with `npm run legacy-proxy` if you just need the old single-dashboard-per-request
HTTP proxy behavior. New work should use the admin UI (`npm start`) instead.

`grafana_autoscroll_panel.json`
--------------------------------

This is a **Grafana library panel export**, not application code. Import it into Grafana itself
(Dashboards → Library panels → Import) to add a manual/visual autoscroll button to a dashboard.
It's an optional visual aid for people viewing the dashboard directly in a browser; the app's own
Puppeteer-driven autoscroll (`grafana/pdf.js`) does not depend on it.

Limitations
-----------

- CSV export only supports datasources with a plain SQL-text query field (`mssql`, `mysql`,
  `postgres`) — see `grafana/interpolate.js`. Pointing a job's panel at an unsupported datasource
  produces a clear per-run error rather than a wrong/empty CSV.
- Autoscroll/height-measurement in `grafana/pdf.js` targets Grafana's `react-grid-layout`/`.view`
  DOM classes; if a future Grafana version renames these again, PDF rendering falls back to a
  generic `document.body.scrollHeight` measurement rather than hanging.

License
-------
