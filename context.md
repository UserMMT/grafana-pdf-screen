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
- Bulk-create jobs from the Browse folder view: check multiple dashboards (or "Select all"), set shared
  cron/save/PDF-sizing settings once on `/browse/:serverId/bulk-create`, and one whole-dashboard PDF job
  per dashboard is created on confirm (`POST .../bulk-create/confirm`). Deliberately PDF-only — CSV needs
  a specific panel per job, which doesn't generalize across a batch of different dashboards; CSV/panel
  jobs still go through the regular per-job form. Selected dashboards are carried between the two steps
  as JSON-encoded hidden `dashboards` fields (uid/title/path — `path` comes straight from Grafana search
  results' `url` field, no extra per-dashboard API call needed).
- Upload dashboard JSON *to* Grafana (`/browse/:serverId/upload`, first "write" direction the app has —
  everything else only reads from Grafana). Single or multiple `.json` files via a real multipart file
  input (added `multer`, memory storage, 5MB/20-file limits). Accepts either a bare dashboard object or a
  full export `{ dashboard, meta }` shape — unwraps `.dashboard` if present. Posts to Grafana's
  `POST /api/dashboards/db` per file via `grafana/client.js`'s `createOrUpdateDashboard()`, while
  preserving `uid` so Grafana's own conflict detection can do its job. `overwrite` defaults to **off** —
  Grafana rejects with 412 instead of silently replacing an existing dashboard unless the checkbox is
  ticked. Folder picker only lists top-level folders (v1 scope; nested-folder upload means uploading to a
  top-level folder then moving it in Grafana). Results render per-file (success + uid/link, or Grafana's
  own rejection message surfaced instead of a generic HTTP error).
  **Not tested against a real write** — verified everything *except* the actual Grafana POST by
  monkey-patching `global.fetch` to intercept calls to `/api/dashboards/db` (confirmed: correct payload
  shape for both dashboard-JSON shapes, `overwrite`/`folderUid` correctly threaded through, per-file error
  isolation, Grafana's own error message surfaced). Deliberately did not run a real create against
  `play.grafana.org` — it's a public shared instance I don't own, and writing to it would be inappropriate
  regardless of test intent. **This means the actual live write path is unverified** — test it against a
  real (ideally disposable/test) Grafana instance before relying on it.
  **Fixed**: originally the uploaded dashboard's `id` field was forced to `null` rather than removed. The
  user hit "must not include an id on the root element" uploading a dashboard using Grafana's newer
  k8s-style/unified-storage dashboard schema (identity lives in `metadata`, not a root `id` field at all)
  — that schema variant rejects the property outright, even as `null`, not just non-null values. Now the
  `id` key is `delete`d from the outgoing payload instead of set to `null`, which is correct for both the
  classic schema (absent `id` == create new, same as `null` there) and this stricter one. Verified via the
  same fetch-mocking approach: the outgoing payload has no `id` key at all now, whether or not the source
  dashboard had a stale numeric one.
- Interactive in-app guide (`public/js/tour.js`, `🧭 Guide` button in the header): a small vanilla-JS
  tour engine (spotlight + positioned tooltip, no new dependency) with per-page step arrays defined via
  `window.__TOUR_STEPS__` in each view. Auto-fires once per page (tracked in `localStorage`), replayable
  anytime via the header button. Wired on jobs list/form, servers list, runs list, browse folder/dashboard.
  **Gotcha hit while building this**: injecting page-specific JS into a `window.__TOUR_STEPS__ = [...]`
  `<script>` block must use EJS's `<%- %>` (raw), not `<%= %>` (HTML-escaped) — escaped output turns `'`
  into `&#39;` and silently breaks the script's syntax. `<%= %>` is still correct for the same kind of
  JSON payload when it's going into an HTML attribute (e.g. a checkbox `value="..."`), just not inside
  a `<script>` tag. Both patterns exist side by side in `views/browse/folder.ejs` — don't conflate them.
- **Auto-set variables from a pasted Grafana URL** (job form, "Variables" section). Real problem this
  solves: many dashboards have chained/dependent template variables (variable B's options depend on
  variable A's value) - Grafana resolves that correctly in its own UI, reimplementing that logic here
  would be fragile. Instead: pick the values in Grafana itself, copy the resulting URL, paste it into the
  new field, click Apply - it parses `var-*` query params and populates matching variable inputs. Any
  `var-*` name not among the dashboard's currently-known variables is still merged into the saved
  `variables_json` (not dropped) so it's not lost, just not shown as a visible input. Verified live against
  a real dashboard with chained variables (`kubernetes cluster monitoring` on play.grafana.org): matched
  vars update visibly, untouched vars stay untouched, unmatched var names are preserved in the hidden JSON.
- **Download all panel CSVs for one dashboard as a zip** (`/browse/:serverId/dashboard/:uid/download-all-csv`,
  linked from the dashboard panel-grid page). Ad-hoc/unscheduled - queries every data panel live via the
  same `/api/ds/query` path jobs use (`grafana/csvApi.js`'s new `fetchAllPanelsCsv()`), one dashboard fetch
  shared across all panels. Per-panel failures (unsupported datasource type, etc.) don't fail the whole
  export - they land in a `_errors.txt` inside the zip alongside whatever did succeed; a 502 only happens
  if *every* panel failed. **Dependency gotcha**: `archiver@8.0.0` (the version installed by a plain
  `npm install archiver` at the time of writing) is a breaking redesign from the classic
  `archiver('zip', opts)` factory-function API (which is what most existing docs/examples/training data
  describe) to `new (require('archiver').ZipArchive)(opts)`. Using the old factory-call syntax throws
  `TypeError: archiver is not a function` - caught during testing, not from prior knowledge. Check
  `node_modules/archiver/package.json`'s version before assuming which API shape applies if this ever
  needs touching again. Verified end-to-end with a mocked Grafana backend (play.grafana.org's public
  datasources are all `testdata`, which the CSV interpolator gate deliberately rejects, so it can't
  exercise the success path) - one `mssql`-typed panel and one `testdata`-typed panel, confirmed the real
  CSV lands in the zip correctly-named and the unsupported one's error lands in `_errors.txt`.
- **Compare two dashboards with a client-side LLM** (`/compare`, `routes/compare.js`,
  `public/js/compare.js`, `views/compare.ejs`). Two independent pickers (same widget pattern as the job
  form's, but not refactored into a shared module - deliberately left job-form.js untouched to avoid
  regression risk to an already-verified flow; if a third page needs this picker, factor it out then).
  Each side resolves to a server+dashboard+panel+variables; `GET /compare/data` fetches that panel's rows
  as JSON (new `csvApi.fetchPanelData()`, capped at 80 rows server-side to fit a small model's context
  window) - **not** a CSV file, since the browser needs structured data to hand to the model, not a
  download. The comparison itself runs **entirely client-side** via WebLLM
  (`import('https://esm.run/@mlc-ai/web-llm')`, no bundler needed, consistent with the project's no-build
  vanilla-JS approach) using `Llama-3.2-1B-Instruct-q4f16_1-MLC` - chosen specifically as one of the
  smaller prebuilt WebLLM models to keep the first-run download closer to ~900MB than the several GB
  larger instruct models would need. Grafana data fetched by this app's server never leaves the browser
  from that point on; nothing is sent to an external AI API. Gated on `navigator.gpu` with a clear
  unsupported-browser message if absent.
  **Verification boundary, explicit**: fully verified the data-fetch path (both the real error case against
  play.grafana.org's unsupported `testdata` panels, and the success case via a mocked mssql-typed panel),
  the two-sided picker UI, client-side validation, and confirmed via the mocked backend that a successful
  fetch on both sides correctly reaches and triggers the WebLLM import call (status text transitions
  `Fetching data...` → `Loading model...` with no error). **Did not** let an actual model download/inference
  run - `navigator.gpu` turned out to be genuinely available in this sandbox's Chromium, so the moment the
  import call fires it's a real ~900MB download; deliberately navigated away to cancel it rather than let
  a large uncontrolled download run in this environment. The actual WebLLM engine creation and streamed
  chat completion (`engine.chat.completions.create(...)`) are implemented per WebLLM's documented API but
  **not exercised end-to-end** - test that part in a real browser session before trusting the narration
  output itself, only the plumbing up to that point is confirmed working.

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
- **Sub-path-hosted Grafana instances doubled their path segment** (e.g. `.../grafana/grafana/d/...`)
  when generating PDFs. Root cause: `job.dashboard_path` is populated from Grafana's own `meta.url` /
  search-result `url` fields, which already include any configured sub-path (`root_url` with
  `serve_from_sub_path`) — and a user's configured `base_url` for that server *also* naturally includes
  that same sub-path (it's "the URL you'd type to reach Grafana"). `buildDashboardUrl` in
  `grafana/client.js` used to blindly concatenate the two. Fixed with `joinGrafanaPath()`: it detects
  when `dashboard_path` already starts with `base_url`'s sub-path portion and uses just the origin in
  that case instead of the full `base_url`. Verified with both the doubling scenario and the normal
  root-served case (unaffected, `sub` is empty so it takes the old code path). If a similar
  double-prepending bug ever shows up elsewhere, check whether the same fields (`meta.url`/search `url`)
  are being concatenated onto `base_url` a second time somewhere new.
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
