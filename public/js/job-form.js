(function () {
  var existingJob = window.__JOB_FORM__ || null;
  var existingVariables = {};
  try {
    existingVariables = existingJob ? JSON.parse(existingJob.variables_json || '{}') : {};
  } catch (e) {
    existingVariables = {};
  }

  var serverSelect = document.getElementById('server_id');
  var searchInput = document.getElementById('dashboard_search');
  var dashboardSelect = document.getElementById('dashboard_select');
  var dashboardUidInput = document.getElementById('dashboard_uid');
  var dashboardPathInput = document.getElementById('dashboard_path');
  var dashboardLabel = document.getElementById('dashboard_selected_label');
  var panelSelect = document.getElementById('panel_select');
  var panelIdInput = document.getElementById('panel_id');
  var panelTitleInput = document.getElementById('panel_title');
  var variablesContainer = document.getElementById('variables_container');
  var variablesJsonInput = document.getElementById('variables_json');
  var pageSizeModeSelect = document.getElementById('page_size_mode');
  var pdfFormatField = document.getElementById('pdf_format_field');

  function currentServerId() {
    return serverSelect.value;
  }

  function searchDashboards(query) {
    if (!currentServerId()) return;
    fetch('/api/servers/' + currentServerId() + '/dashboards?q=' + encodeURIComponent(query || ''))
      .then(function (r) { return r.json(); })
      .then(function (results) {
        dashboardSelect.innerHTML = '';
        (results || []).forEach(function (d) {
          var opt = document.createElement('option');
          opt.value = d.uid;
          opt.textContent = d.title;
          dashboardSelect.appendChild(opt);
        });
      })
      .catch(function (e) { console.error('dashboard search failed', e); });
  }

  var searchTimer = null;
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    var q = searchInput.value;
    searchTimer = setTimeout(function () { searchDashboards(q); }, 300);
  });

  function renderVariables(variables) {
    variablesContainer.innerHTML = '';
    if (!variables || !variables.length) {
      variablesContainer.innerHTML = '<span class="hint">This dashboard has no template variables.</span>';
      updateVariablesJson();
      return;
    }
    variables.forEach(function (v) {
      var row = document.createElement('div');
      row.style.marginBottom = '0.4rem';
      var label = document.createElement('label');
      label.textContent = v.label + ': ';
      label.style.fontWeight = '400';
      label.style.display = 'inline-block';
      label.style.width = '160px';
      var input = document.createElement('input');
      input.type = 'text';
      input.dataset.varName = v.name;
      input.style.width = '260px';
      input.value = Object.prototype.hasOwnProperty.call(existingVariables, v.name) ? existingVariables[v.name] : (v.default || '');
      input.addEventListener('input', updateVariablesJson);
      row.appendChild(label);
      row.appendChild(input);
      if (v.options && v.options.length) {
        var hint = document.createElement('span');
        hint.className = 'hint';
        hint.textContent = ' options: ' + v.options.slice(0, 8).join(', ');
        row.appendChild(hint);
      }
      variablesContainer.appendChild(row);
    });
    updateVariablesJson();
  }

  function updateVariablesJson() {
    var inputs = variablesContainer.querySelectorAll('input[data-var-name]');
    var out = {};
    inputs.forEach(function (input) {
      if (input.value !== '') out[input.dataset.varName] = input.value;
    });
    variablesJsonInput.value = JSON.stringify(out);
  }

  function findVarInput(name) {
    var inputs = variablesContainer.querySelectorAll('[data-var-name]');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].dataset.varName === name) return inputs[i];
    }
    return null;
  }

  // Extracts var-* query params from a pasted Grafana dashboard URL (or bare
  // query string). Grafana resolves chained/dependent variables correctly in
  // its own UI - this lets that resolution be reused here instead of
  // reimplementing cascading-variable logic.
  function parseVarParamsFromUrl(raw) {
    var qs = raw;
    var qIndex = qs.indexOf('?');
    if (qIndex !== -1) qs = qs.slice(qIndex + 1);
    var params = new URLSearchParams(qs);
    var out = {};
    params.forEach(function (value, key) {
      if (key.indexOf('var-') === 0) out[key.slice(4)] = value;
    });
    return out;
  }

  var urlPasteInput = document.getElementById('variables_url_paste');
  var urlApplyBtn = document.getElementById('variables_url_apply');
  var urlStatus = document.getElementById('variables_url_status');

  function applyVarsFromUrl() {
    var extracted = parseVarParamsFromUrl(urlPasteInput.value.trim());
    var names = Object.keys(extracted);
    if (!names.length) {
      urlStatus.style.color = '#a11919';
      urlStatus.textContent = 'No var-* parameters found in that URL.';
      return;
    }
    var matched = 0;
    names.forEach(function (name) {
      var input = findVarInput(name);
      if (input) { input.value = extracted[name]; matched++; }
    });
    // Merge directly into the hidden field rather than calling updateVariablesJson(),
    // which only reads currently-rendered inputs and would silently drop any
    // variable name the dashboard picker doesn't already know about.
    var current = {};
    try { current = JSON.parse(variablesJsonInput.value || '{}'); } catch (e) { current = {}; }
    Object.assign(current, extracted);
    variablesJsonInput.value = JSON.stringify(current);

    urlStatus.style.color = '#196c2e';
    var extra = names.length - matched;
    urlStatus.textContent = 'Applied ' + names.length + ' variable' + (names.length === 1 ? '' : 's')
      + (extra > 0 ? ' (' + extra + ' saved but not shown below - not in this dashboard\'s known variable list)' : '') + '.';
  }

  urlApplyBtn.addEventListener('click', applyVarsFromUrl);
  urlPasteInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); applyVarsFromUrl(); }
  });

  function loadDashboardDetail(uid, preselectPanelId) {
    if (!currentServerId() || !uid) return;
    fetch('/api/servers/' + currentServerId() + '/dashboards/' + encodeURIComponent(uid))
      .then(function (r) { return r.json(); })
      .then(function (detail) {
        dashboardPathInput.value = detail.path || ('/d/' + uid);
        dashboardLabel.textContent = detail.title + ' (' + uid + ')';

        panelSelect.innerHTML = '<option value="">— whole dashboard —</option>';
        (detail.panels || []).forEach(function (p) {
          var opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.title + ' [' + (p.datasourceType || 'unknown') + ']';
          if (preselectPanelId && String(p.id) === String(preselectPanelId)) opt.selected = true;
          panelSelect.appendChild(opt);
        });
        if (preselectPanelId) {
          panelIdInput.value = preselectPanelId;
        }

        renderVariables(detail.variables);
      })
      .catch(function (e) { console.error('dashboard detail failed', e); });
  }

  dashboardSelect.addEventListener('change', function () {
    var opt = dashboardSelect.options[dashboardSelect.selectedIndex];
    if (!opt) return;
    dashboardUidInput.value = opt.value;
    loadDashboardDetail(opt.value, null);
  });

  panelSelect.addEventListener('change', function () {
    var opt = panelSelect.options[panelSelect.selectedIndex];
    panelIdInput.value = opt && opt.value ? opt.value : '';
    panelTitleInput.value = opt && opt.value ? opt.textContent.replace(/\s*\[.*\]$/, '') : '';
  });

  function syncPdfFormatVisibility() {
    pdfFormatField.style.display = pageSizeModeSelect.value === 'fixed-format' ? 'block' : 'none';
  }
  pageSizeModeSelect.addEventListener('change', syncPdfFormatVisibility);
  syncPdfFormatVisibility();

  // Initial load: if editing an existing job, pre-populate dashboard details.
  if (existingJob && existingJob.dashboard_uid) {
    loadDashboardDetail(existingJob.dashboard_uid, existingJob.panel_id);
  }

  // --- Cron presets + live next-run preview ---
  var cronInput = document.getElementById('cron_expression');
  var cronPreview = document.getElementById('cron_preview');

  function updateCronPreview() {
    var expr = cronInput.value.trim();
    if (!expr) { cronPreview.textContent = '—'; return; }
    fetch('/jobs/cron-preview?expr=' + encodeURIComponent(expr))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) { cronPreview.textContent = res.message; cronPreview.style.color = '#a11919'; return; }
        cronPreview.style.color = '#777';
        cronPreview.textContent = 'Next runs: ' + res.next.map(function (d) { return new Date(d).toLocaleString(); }).join('  •  ');
      })
      .catch(function () { cronPreview.textContent = '—'; });
  }

  var cronTimer = null;
  cronInput.addEventListener('input', function () {
    clearTimeout(cronTimer);
    cronTimer = setTimeout(updateCronPreview, 300);
  });
  document.querySelectorAll('.cron-presets [data-cron]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      cronInput.value = btn.dataset.cron;
      updateCronPreview();
    });
  });
  updateCronPreview();

  // --- Inline validation: CSV output requires a panel ---
  var jobForm = document.getElementById('job-form');
  jobForm.addEventListener('submit', function (e) {
    var csvChecked = jobForm.querySelector('[name=output_csv]').checked;
    if (csvChecked && !panelIdInput.value) {
      e.preventDefault();
      var msg = document.getElementById('csv-panel-error');
      if (!msg) {
        msg = document.createElement('div');
        msg.id = 'csv-panel-error';
        msg.className = 'field-error';
        msg.textContent = 'CSV output is checked but no panel is selected — pick a panel above, or uncheck CSV.';
        panelSelect.parentNode.appendChild(msg);
      }
      panelSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
})();
