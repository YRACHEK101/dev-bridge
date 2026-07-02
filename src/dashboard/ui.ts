// The dashboard is a single self-contained page. Embedding it as a string keeps
// the published package free of asset-path resolution bugs across dev/dist and
// needs no build step for the UI.
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>portbridge · request timeline</title>
<style>
  :root {
    --bg: #0f1117; --panel: #171a23; --border: #262b38; --text: #e6e9ef;
    --muted: #8b93a7; --frontend: #22d3ee; --backend: #c084fc; --err: #f87171;
    --ok: #4ade80;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
         background: var(--bg); color: var(--text); }
  header { display: flex; align-items: baseline; gap: 12px; padding: 14px 18px;
           border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--bg); }
  header h1 { font-size: 15px; margin: 0; font-weight: 700; }
  header .sub { color: var(--muted); }
  #status { margin-left: auto; font-size: 12px; }
  #status.live { color: var(--ok); }
  #status.down { color: var(--err); }
  .legend { display: flex; gap: 14px; padding: 8px 18px; color: var(--muted); border-bottom: 1px solid var(--border); }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  .dot.frontend { background: var(--frontend); } .dot.backend { background: var(--backend); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { position: sticky; top: 50px; background: var(--panel); color: var(--muted); font-weight: 600; z-index: 1; }
  td.path { white-space: normal; word-break: break-all; max-width: 420px; }
  .method { font-weight: 700; }
  .tag { padding: 1px 7px; border-radius: 999px; font-size: 11px; }
  .tag.frontend { color: var(--frontend); border: 1px solid var(--frontend); }
  .tag.backend { color: var(--backend); border: 1px solid var(--backend); }
  .status-2 { color: var(--ok); } .status-3 { color: var(--frontend); }
  .status-4, .status-5 { color: var(--err); }
  .bar-cell { width: 220px; }
  .bar-wrap { background: #0b0d13; border-radius: 3px; overflow: hidden; height: 14px; width: 100%; }
  .bar { height: 100%; border-radius: 3px; }
  .bar.frontend { background: var(--frontend); } .bar.backend { background: var(--backend); }
  .dur { color: var(--muted); }
  #empty { padding: 40px 18px; color: var(--muted); }
</style>
</head>
<body>
  <header>
    <h1>portbridge</h1>
    <span class="sub">live request timeline</span>
    <span id="status" class="down">connecting…</span>
  </header>
  <div class="legend">
    <span><span class="dot frontend"></span>frontend</span>
    <span><span class="dot backend"></span>backend</span>
    <span id="count">0 requests</span>
  </div>
  <div id="empty">Waiting for requests… make a call through the proxy to see it here.</div>
  <table id="table" hidden>
    <thead>
      <tr><th>time</th><th>method</th><th>path</th><th>target</th><th>status</th><th class="bar-cell">duration</th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>

<script>
(function () {
  var MAX_ROWS = 1000;
  var rows = document.getElementById('rows');
  var table = document.getElementById('table');
  var empty = document.getElementById('empty');
  var statusEl = document.getElementById('status');
  var countEl = document.getElementById('count');
  var total = 0;
  var maxDur = 50; // ms, grows to scale the waterfall bars

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function clock(iso) {
    var d = iso ? new Date(iso) : new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function addRecord(r) {
    total++;
    countEl.textContent = total + (total === 1 ? ' request' : ' requests');
    if (table.hidden) { table.hidden = false; empty.hidden = true; }
    if (r.durationMs > maxDur) maxDur = r.durationMs;

    var statusClass = 'status-' + String(r.statusCode).charAt(0);
    var pct = Math.max(2, Math.min(100, (r.durationMs / maxDur) * 100));
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="dur">' + clock(r.timestamp) + '</td>' +
      '<td class="method">' + esc(r.method) + '</td>' +
      '<td class="path">' + esc(r.path) + '</td>' +
      '<td><span class="tag ' + r.target + '">' + r.target + '</span></td>' +
      '<td class="' + statusClass + '">' + esc(r.statusCode) + (r.aborted ? ' ✕' : '') + '</td>' +
      '<td class="bar-cell"><div class="bar-wrap"><div class="bar ' + r.target + '" style="width:' + pct + '%"></div></div>' +
        '<span class="dur">' + r.durationMs + ' ms</span></td>';
    rows.insertBefore(tr, rows.firstChild);
    while (rows.childNodes.length > MAX_ROWS) rows.removeChild(rows.lastChild);
  }

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    var base = location.pathname.replace(/\\/$/, '');
    var ws = new WebSocket(proto + location.host + base + '/ws');
    ws.onopen = function () { statusEl.textContent = '● live'; statusEl.className = 'live'; };
    ws.onclose = function () {
      statusEl.textContent = '● disconnected — retrying'; statusEl.className = 'down';
      setTimeout(connect, 1000);
    };
    ws.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      if (msg.type === 'backlog') { msg.records.forEach(addRecord); }
      else if (msg.type === 'request') { addRecord(msg.record); }
    };
  }
  connect();
})();
</script>
</body>
</html>
`;
