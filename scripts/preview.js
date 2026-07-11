'use strict';
// Port 5555 (the app's real default) collides with some sandboxes' ADB service.
// This wrapper picks a safer default for local/preview use without changing the
// app's actual production default (still driven by .env / GRAFANA_PDF_BIND_PORT).
process.env.PORT = process.env.PORT || '6600';
require('../server.js');
