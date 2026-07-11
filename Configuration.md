# Configuration

Two layers of configuration:

1. **`.env`** — process-level settings only (port/host, DB path, default output root, Chrome path,
   default PDF width). See the Environment section of `README.md`.
2. **SQLite (`data/app.db`)** — everything per-Grafana-instance or per-job, managed entirely from
   the admin UI (Servers / Jobs pages). This replaces what used to be single-instance `.env` config
   in the old scripts.

## Mapping from the old scripts' env vars

### From `grafana-pdf-screen`'s old `index.js`-only server

| Old env var | Old status | New home |
|---|---|---|
| `GRAFANA_PDF_BACKEND_USER` / `_PASS` / `_API_KEY` / `_URL` / `_NO_LOGIN` | used, single instance only | `grafana_servers` row (Servers UI): `auth_method`/`auth_user`/`auth_pass`/`auth_api_key`/`base_url` |
| `GRAFANA_PDF_TIMEOUT_DURATION` | used, global only | `grafana_servers.timeout_s` (per server) |
| `GRAFANA_PDF_SAVE_LOCAL` | declared, ignored (always saved to `tmp/`) | `jobs.save_local` (per job, in the job form) |
| `GRAFANA_PDF_SAVE_PATH` | declared, unused (hardcoded `tmp/`) | `jobs.save_path` (per job, supports `{dashboard}` `{panel}` `{date}` tokens); `.env`'s `OUTPUT_ROOT` is the global root relative paths resolve against |
| `GRAFANA_PDF_FORMAT` | declared, commented out | `jobs.pdf_format` + `jobs.page_size_mode` (`fixed-format` mode actually passes `format:` to `page.pdf()`, which the old code never did) |
| `GRAFANA_ENABLE_AUTOFIT` | declared, unused | the `page_size_mode` selector in the job form (`auto-fit-content` vs `fixed-format`) |
| `GRAFANA_PDF_WIDTH` | used, global only | stays as an `.env` default; `jobs.pdf_width` can override per job |
| `GRAFANA_PDF_BIND_PORT` / `_BIND_HOST` | used | stays process-level: `.env`'s `PORT`/`HOST` (or the old var names, still read as a fallback) |
| `GRAFANA_PDF_CHROME_PATH` | used | stays process-level `.env` |

### From `puppeteer_grafana_panel_download_csv`'s `Configuration.md` (documented but never implemented)

| Planned var | New home |
|---|---|
| `MULTI_SERVER` / `MULTI_SERVER_CREDENTIAL` | the `grafana_servers` table — add as many servers as you need, each with its own auth |
| `SAVE_LOCAL` | `jobs.save_local` (see above) |
| `Req_time_out_s` | `grafana_servers.timeout_s` |
| `TRACE` | `job_runs.detail_json` — every run records server/dashboard/panel/variables/resolved URL/timings, viewable on the run detail page |
| `LOGIN` / `PASSWORD` / `URL` / `LINK_PANNEL` | superseded by a `grafana_servers` row + a job's dashboard/panel/variable selection |

## Database schema

See `db/migrate.js` for the authoritative schema. Summary:

- **`grafana_servers`** — one row per Grafana instance: `base_url`, `auth_method` (`none`/`basic`/`api_key`) + credentials, `timeout_s`, `tls_skip_verify`.
- **`jobs`** — one row per scheduled report: which server/dashboard/panel, the chosen template
  variable combination (`variables_json`), which outputs to produce (`outputs`: `pdf`/`csv`),
  `cron_expression`, and output options (`save_local`/`save_path`/`pdf_format`/`page_size_mode`/`pdf_width`/`time_from`/`time_to`).
- **`job_runs`** — one row per execution (cron or manual "Run now"): status, output file paths,
  error text, and a `detail_json` trace blob.

## CSV export datasource support

`grafana/interpolate.js` only supports datasources with a plain-text SQL query field:
`mssql`, `mysql`, `postgres`. A job pointed at any other datasource type will fail that job's
CSV output with a clear `datasource type 'X' not yet supported` error (PDF output, if also
enabled, is unaffected). To add support for another datasource type, add one function to the
`interpolators` registry in `grafana/interpolate.js`.
