# Release Notes

## grafana_autoscroll_panel.json — unreleased
- Fixed: `sleep()` calls inside the panel's embedded script were never `await`ed, so the "wait before autoplay" and "delay before reversing direction" settings were silent no-ops.
- Fixed: autoscroll stopped working entirely on Grafana 10+ ("Scenes" dashboards) because the `.view`/`.scrollbar-view` classes it scrolled no longer exist. Now falls back to native document scrolling, which is what current Grafana actually uses.
- Added: scroll wait/delay/step/reverse-delay are now overridable per dashboard via template variables (`autoscroll_wait_ms`, `autoscroll_delay_ms`, `autoscroll_distance_px`, `autoscroll_invert_delay_ms`) without editing the panel.
- Toolbar play/pause button injection now fails silently instead of throwing if Grafana's internal CSS class for the toolbar changes again.

##  Grafana-PDF-SCREEN V0.1
- Fix long dashboard [scroll]
- adding custom Timeout
- default variable value
- .env file support