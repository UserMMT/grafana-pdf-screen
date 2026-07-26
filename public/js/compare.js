// Client-side comparison: fetches two datasets from this app's own server
// (which talks to Grafana), then runs the actual comparison entirely in the
// browser via WebLLM/WebGPU. No dashboard data is sent to any AI service.
const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'; // small model, keeps the first-load download closer to ~900MB than several GB

function createPicker(root) {
  var serverSelect = root.querySelector('.cmp-server');
  var searchInput = root.querySelector('.cmp-dashboard-search');
  var dashboardSelect = root.querySelector('.cmp-dashboard-select');
  var dashboardLabel = root.querySelector('.cmp-dashboard-label');
  var panelSelect = root.querySelector('.cmp-panel-select');
  var variablesContainer = root.querySelector('.cmp-variables');
  var labelInput = root.querySelector('.cmp-label');

  var state = { dashboard_uid: null, dashboard_path: null, panel_id: null, panel_title: null, variables: {} };

  function searchDashboards(query) {
    fetch('/api/servers/' + serverSelect.value + '/dashboards?q=' + encodeURIComponent(query || ''))
      .then(function (r) { return r.json(); })
      .then(function (results) {
        dashboardSelect.innerHTML = '';
        (results || []).forEach(function (d) {
          var opt = document.createElement('option');
          opt.value = d.uid;
          opt.textContent = d.title;
          dashboardSelect.appendChild(opt);
        });
      });
  }

  var searchTimer = null;
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    var q = searchInput.value;
    searchTimer = setTimeout(function () { searchDashboards(q); }, 300);
  });

  function renderVariables(variables) {
    variablesContainer.innerHTML = '';
    state.variables = {};
    if (!variables || !variables.length) {
      variablesContainer.innerHTML = '<span class="hint">No template variables.</span>';
      return;
    }
    variables.forEach(function (v) {
      var row = document.createElement('div');
      row.style.marginBottom = '0.3rem';
      var label = document.createElement('label');
      label.textContent = v.label + ': ';
      label.style.fontWeight = '400';
      label.style.display = 'inline-block';
      label.style.width = '120px';
      var input = document.createElement('input');
      input.type = 'text';
      input.style.width = '180px';
      input.value = v.default || '';
      state.variables[v.name] = input.value;
      input.addEventListener('input', function () { state.variables[v.name] = input.value; });
      row.appendChild(label);
      row.appendChild(input);
      variablesContainer.appendChild(row);
    });
  }

  dashboardSelect.addEventListener('change', function () {
    var opt = dashboardSelect.options[dashboardSelect.selectedIndex];
    if (!opt) return;
    state.dashboard_uid = opt.value;
    fetch('/api/servers/' + serverSelect.value + '/dashboards/' + encodeURIComponent(opt.value))
      .then(function (r) { return r.json(); })
      .then(function (detail) {
        state.dashboard_path = detail.path || ('/d/' + opt.value);
        dashboardLabel.textContent = detail.title + ' (' + opt.value + ')';
        panelSelect.innerHTML = '<option value="">— pick a panel —</option>';
        (detail.panels || []).forEach(function (p) {
          var o = document.createElement('option');
          o.value = p.id;
          o.textContent = p.title + ' [' + (p.datasourceType || 'unknown') + ']';
          panelSelect.appendChild(o);
        });
        renderVariables(detail.variables);
      });
  });

  panelSelect.addEventListener('change', function () {
    var opt = panelSelect.options[panelSelect.selectedIndex];
    state.panel_id = opt && opt.value ? Number(opt.value) : null;
    state.panel_title = opt && opt.value ? opt.textContent.replace(/\s*\[.*\]$/, '') : null;
  });

  return {
    getConfig: function () {
      return {
        label: labelInput.value.trim() || labelInput.placeholder,
        server_id: serverSelect.value,
        dashboard_uid: state.dashboard_uid,
        panel_id: state.panel_id,
        panel_title: state.panel_title,
        variables: state.variables,
      };
    },
  };
}

var pickers = {};
document.querySelectorAll('[data-side]').forEach(function (el) {
  pickers[el.dataset.side] = createPicker(el);
});

var runBtn = document.getElementById('cmp-run-btn');
var statusEl = document.getElementById('cmp-status');
var progressWrap = document.getElementById('cmp-progress-wrap');
var progressBar = document.getElementById('cmp-progress-bar');
var progressText = document.getElementById('cmp-progress-text');
var resultCard = document.getElementById('cmp-result-card');

function fetchSideData(config) {
  var params = new URLSearchParams({
    server_id: config.server_id,
    dashboard_uid: config.dashboard_uid,
    panel_id: config.panel_id,
    variables: JSON.stringify(config.variables),
  });
  return fetch('/compare/data?' + params.toString()).then(function (r) { return r.json(); });
}

function rowsToText(rows) {
  if (!rows.length) return '(no rows returned)';
  var cols = Object.keys(rows[0]);
  var lines = [cols.join(', ')];
  rows.forEach(function (row) { lines.push(cols.map(function (c) { return row[c]; }).join(', ')); });
  return lines.join('\n');
}

var engine = null; // cached across comparisons within the page's lifetime

runBtn.addEventListener('click', function () {
  var a = pickers.a.getConfig();
  var b = pickers.b.getConfig();

  if (!a.dashboard_uid || !a.panel_id || !b.dashboard_uid || !b.panel_id) {
    statusEl.style.color = '#a11919';
    statusEl.textContent = 'Pick a dashboard and a panel on both sides first.';
    return;
  }

  if (!navigator.gpu) {
    statusEl.style.color = '#a11919';
    statusEl.textContent = 'This browser does not support WebGPU, which the in-browser model requires. Try current Chrome or Edge.';
    return;
  }

  runBtn.disabled = true;
  resultCard.style.display = 'none';
  statusEl.style.color = '#777';
  statusEl.textContent = 'Fetching data from Grafana...';

  Promise.all([fetchSideData(a), fetchSideData(b)])
    .then(function (results) {
      var dataA = results[0];
      var dataB = results[1];
      if (!dataA.ok) throw new Error(a.label + ': ' + dataA.message);
      if (!dataB.ok) throw new Error(b.label + ': ' + dataB.message);

      statusEl.textContent = 'Loading model (first run downloads ~1GB, cached after that)...';
      progressWrap.style.display = 'block';

      return import('https://esm.run/@mlc-ai/web-llm').then(function (webllm) {
        var enginePromise = engine
          ? Promise.resolve(engine)
          : webllm.CreateMLCEngine(MODEL_ID, {
              initProgressCallback: function (report) {
                var pct = Math.round((report.progress || 0) * 100);
                progressBar.style.width = pct + '%';
                progressText.textContent = report.text || (pct + '%');
              },
            });
        return enginePromise.then(function (eng) {
          engine = eng;
          progressWrap.style.display = 'none';
          statusEl.textContent = 'Comparing...';

          var prompt =
            'You are comparing two datasets exported from Grafana dashboards.\n\n' +
            'Dataset "' + a.label + '" (dashboard: ' + dataA.dashboardName + ', panel: ' + dataA.panelTitle + ')' +
            (dataA.truncated ? ' [showing first ' + dataA.rows.length + ' of ' + dataA.rowCount + ' rows]' : '') + ':\n' +
            rowsToText(dataA.rows) + '\n\n' +
            'Dataset "' + b.label + '" (dashboard: ' + dataB.dashboardName + ', panel: ' + dataB.panelTitle + ')' +
            (dataB.truncated ? ' [showing first ' + dataB.rows.length + ' of ' + dataB.rowCount + ' rows]' : '') + ':\n' +
            rowsToText(dataB.rows) + '\n\n' +
            'Compare the two datasets. Point out the most significant differences, trends, or anomalies between ' +
            a.label + ' and ' + b.label + '. Be specific with numbers. Keep it concise (a few short paragraphs or a bullet list).';

          resultCard.style.display = 'block';
          resultCard.textContent = '';

          return engine.chat.completions.create({
            messages: [
              { role: 'system', content: 'You are a precise data analyst. Only state what the data supports.' },
              { role: 'user', content: prompt },
            ],
            stream: true,
          }).then(function (stream) {
            return (async function () {
              var reply = '';
              for await (var chunk of stream) {
                reply += (chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) || '';
                resultCard.textContent = reply;
              }
              statusEl.textContent = 'Done.';
            })();
          });
        });
      });
    })
    .catch(function (err) {
      progressWrap.style.display = 'none';
      statusEl.style.color = '#a11919';
      statusEl.textContent = 'Error: ' + err.message;
    })
    .finally(function () {
      runBtn.disabled = false;
    });
});
