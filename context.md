# grafana-pdf-screen — project context

Read this first in a new session before touching the code.

## What this project is

A scheduled Grafana reporting tool with a web admin UI. It replaces two old standalone scripts:

- **`puppeteer_grafana_panel_download_csv`** (sibling repo, now legacy/reference-only) — used to download panel CSV data by clicking through Grafana's old panel-inspector DOM. Broken today because Grafana moved off that UI (now Grafana 11–13, "Scenes" architecture in places). Kept only for historical reference; its README now points here.
- **`grafana-pdf-screen`** (this repo) — used to be just a Puppeteer→PDF proxy (`index.js`, still present as `npm run legacy-proxy` for comparison/rollback). It's been rebuilt into a full app: `server.js` is the real entry point now.

**Goal achieved so far**: one Express app with a SQLite-backed job scheduler that renders a Grafana dashboard/panel to PDF and/or pulls panel data as CSV via Grafana's HTTP query API (not DOM scraping), on a cron schedule or via webhook, with a UI to manage servers/jobs/run history and to browse a Grafana instance's dashboards.

## Architecture

```
server.js            entry point: db.migrate() -> browserPool.initBrowser() -> scheduler.loadAllJobs() -> app.listen()
scripts/preview.js    same as server.js but forces PORT=6600 (see "Known environment quirk" below)

db/                   node:sqlite (built into Node 22.5+/24, no native deps)
  migrate.js           schema + idempotent migrations (handles upgrading an existing app.db)
  servers.js, jobs.js, runs.js   CRUD

grafana/
  client.js            low-level Grafana HTTP client: auth headers, dashboard fetch, /api/ds/query,
                        folders API, panel image render, connection test
  browserPool.js        shared puppeteer Chromium instance, auto-relaunch on crash (not on intentional shutdown)
  pdf.js                generatePdf() — kiosk-mode screenshot-to-PDF, autoscroll, graceful fallback if
                        Grafana's scroll/grid DOM classes aren't found (they change across Grafana versions)
  csvApi.js             fetchPanelCsv() — panel data via /api/ds/query, NOT DOM scraping
  interpolate.js        Grafana template-variable ($var/${var}/[[var]]) substitution into SQL-like queries;
                         gated to known datasource types (mssql/mysql/postgres), throws for unsupported ones
                         rather than silently producing wrong/empty CSV
  dataframe.js           Grafana data-frame JSON -> CSV rows (handles enum-type fields too)
  panels.js              shared panel-flatten/find helpers (rows unwrapped), used by csvApi + dashboard routes
  outputPath.js          resolves where a job's output file goes (tmp/ vs save_local path with tokens)

scheduler.js / jobRunner.js   in-process node-cron; DB is always source of truth, cron tasks are
                              registered/unregistered right after every job CRUD write

routes/   servers.js, jobs.js, runs.js, dashboards.js (AJAX pickers), webhooks.js, browse.js
views/    EJS, server-rendered, no frontend framework/build step
public/   css/js, vanilla JS only
```

## Current features (all built and tested against the real play.grafana.org instance)

- Servers CRUD (multi-Grafana-instance support), connection test
- Jobs CRUD: dashboard/panel picker (live AJAX against Grafana's `/api/search` + `/api/dashboards/uid/:uid`),
  template variables, cron schedule with preset buttons + live next-3-runs preview, PDF/CSV output toggles,
  save-to-disk with `{dashboard}/{panel}/{date}` path tokens, fixed-format vs auto-fit PDF sizing
- Clone job, bulk enable/disable/delete, filters on jobs and run-history lists
- Per-job detail page, run history with downloadable PDF/CSV and a JSON trace of each run
- Webhook trigger per job (`POST /webhooks/:token`) in addition to cron/manual, with regeneratable tokens
- Dashboard browser (`/browse`): folder-aware navigation through a Grafana server's real folder tree,
  panel thumbnails (proxied server-side via Grafana's `/render/d-solo` image endpoint so credentials never
  reach the browser, graceful "No preview" fallback if rendering fails/unavailable), and "Create job from
  this panel" links that prefill the job form

## Known environment quirk (this sandbox only, not a real deployment concern)

Port 5555 (the app's real default, from `.env`/`GRAFANA_PDF_BIND_PORT`) intermittently collides with a
QEMU-based Android emulator's ADB service in this dev sandbox. `npm run preview` (via `scripts/preview.js`)
forces port 6600 to sidestep this reliably. `.claude/launch.json` has all three entry points
(`preview`/6600, `start`/5555, `legacy-proxy`/5555) — note **`preview_start` reads `.claude/launch.json`
relative to the *primary* Claude Code working directory**, which in this multi-repo setup has been
`puppeteer_grafana_panel_download_csv`, not this repo — so a launch.json pointing here via `npm --prefix`
also lives in that sibling repo. If working from a session rooted directly in this repo, its own
`.claude/launch.json` is enough on its own.

## Things learned the hard way this session (don't re-break these)

- **Express route ordering**: literal routes (e.g. `/bulk`, `/test`, `/cron-preview`) MUST be registered
  before a `/:id`-style catch-all in the same router, or Express matches the catch-all first and swallows
  them. Bit us once in `routes/servers.js` (`/servers/test` was being eaten by `/:id`), fixed, and every
  router built since has literal routes placed first with a comment noting why.
- **Grafana's DOM changes across versions** (Angular → React → Scenes). `pdf.js`'s autoscroll code
  originally hung forever (`Runtime.callFunctionOn timed out`) against a dashboard that didn't have the
  expected `.react-grid-layout`/`.view`/`.scrollbar-view` classes — an in-page Promise that never
  resolved when `document.querySelector(...)` returned null. Now guarded: missing elements resolve
  immediately with 0 and a generic `document.body.scrollHeight` fallback is used instead of hanging or
  producing a near-empty PDF. **The same fragility existed in `grafana_autoscroll_panel.json` and has
  now been fixed there too** — see below.
- **`node:sqlite` CHECK constraints can't be altered in place** — widening `job_runs.trigger_type` to
  include `'webhook'` required detecting the old constraint via `sqlite_master.sql` and recreating the
  table (see `db/migrate.js`). Any future enum-like CHECK change needs the same treatment.
- **Git Bash / MSYS path conversion**: testing routes with `curl` from this shell silently rewrites
  arguments that look like Unix paths (e.g. `/d/uid/slug` becomes `D:/uid/slug`) before curl even sees
  them. Use `MSYS_NO_PATHCONV=1 curl ...` when a request body/query contains a `/d/...`-style value.
- **`.env`/`.env1`/`.env_1`/`.env_2`** were committed with a real-looking Grafana API key in git history.
  They've been `git rm --cached` (still on disk, just untracked going forward) — the user chose to handle
  committing that themselves. The key itself is still in old commits; scrubbing history was explicitly
  left as a separate decision, not done.
- Testing against `https://play.grafana.org` (public, no-auth) has been the go-to way to validate real
  Grafana API behavior before writing code around assumptions (confirmed `/api/ds/query` response shape,
  `/api/folders?parentUid=`, `/api/search?folderUIDs=`, `/render/d-solo/...` all empirically before use).

## `grafana_autoscroll_panel.json` — fixed this session

This is a Grafana *library panel export* — JSON you import into Grafana itself (Dashboards → Library
panels), connected to 18 dashboards per its `meta.connectedDashboards`. Not application code; nothing in
`grafana-pdf-screen`'s Node app reads or depends on it. It embeds an HTML/JS Text panel that adds an
on-dashboard autoscroll toggle button and auto-starts scrolling when left in kiosk mode, so a screen shows
the whole dashboard over time instead of only the top panels.

The user confirmed the exact symptom: **after a Grafana 10+ upgrade, the element it scrolled no longer
exists.** Verified empirically via puppeteer against `https://play.grafana.org` (current Grafana): modern
dashboards don't have `.view`/`.scrollbar-view` at all — the *document itself* scrolls natively now
(`document.documentElement.scrollHeight/clientHeight` differ, confirmed by direct measurement).

Rewrote the embedded script (both `libraryPanel.model.options.content` and `options.content` — the file
carries two copies, kept in sync) to:
1. Actually await its `sleep()` calls (they were fire-and-forget before — the "wait before autoplay" and
   "delay before reversing direction" settings were silent no-ops).
2. Try the legacy `.view`/`.scrollbar-view` classes first (older Grafana), then fall back to
   `document.scrollingElement`/`document.documentElement` (current Grafana) — and drive the whole loop off
   standard `scrollTop`/`scrollHeight`/`clientHeight`, which eliminated the old `.react-grid-layout`
   bounding-rect height hack entirely rather than chasing another version-specific class name.
3. Make the four magic numbers (wait/delay/step/reverse-delay) overridable per-dashboard via URL
   query params (`var-autoscroll_wait_ms` etc.) — Grafana auto-adds these if a dashboard defines a
   matching template variable name, and it's a no-op default otherwise. Deliberately did **not** use
   Grafana's `${var}` text-interpolation inside the script (the abandoned dead code in the original was
   reaching for this) because an undefined variable leaves literal `${var}` text in a non-template-literal
   position, which is a JS syntax error that would break the *entire* panel on any of the 18 dashboards
   that don't happen to define it. The URL-param approach degrades safely instead.
4. Toolbar button injection (`.css-ztq7l5`, an Emotion/CSS-in-JS build-generated class) now skips silently
   if not found instead of throwing — same fragility class as #2 but lower priority to actually fix since
   kiosk mode hides the toolbar anyway (this button is mainly for manual toggling while editing).

Verified before writing to the real file: `node --check` on the extracted script (syntax), plus a mocked-DOM
test (`scratchpad/test_scroll_logic.js`, not committed) exercising the full state machine — scrolls to the
bottom, reverses, scrolls back to top, reverses again, stops cleanly on toggle-off, respects URL variable
overrides, degrades gracefully when the legacy classes and toolbar host aren't found. Confirmed via JSON
diff that only the two `.content` fields changed — `id`/`version`/`meta`/`gridPos`/`pluginVersion` etc. are
byte-identical to before, so re-importing this into Grafana should update the existing library panel
in place rather than create a new one.

**Not done**: actually re-importing/testing this in a real Grafana instance (no access to the user's
instance from here) — worth doing before assuming it's fully verified end-to-end, not just logically correct.
