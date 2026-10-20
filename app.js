/* ============================================================
   TradeLab — UI, chart, market data, drawing tools
   ============================================================ */
(() => {
'use strict';

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const NS = 'http://www.w3.org/2000/svg';

// ---- data feed: Binance public klines. Change this if geo-blocked
//      (e.g. a CORS-friendly relay, Twelve Data, Finnhub, your own API).
const API_BASE = 'https://api.binance.com';

// XAUUSD maps to PAXGUSDT (gold-backed token tracking spot gold) since
// free spot-forex OHLC feeds with CORS do not exist.
const PAIRS = [
  { label: 'XAUUSD',  binance: 'PAXGUSDT' },
  { label: 'BTCUSD',  binance: 'BTCUSDT'  },
  { label: 'ETHUSD',  binance: 'ETHUSDT'  },
  { label: 'SOLUSD',  binance: 'SOLUSDT'  },
  { label: 'BNBUSD',  binance: 'BNBUSDT'  },
  { label: 'XRPUSD',  binance: 'XRPUSDT'  },
  { label: 'DOGEUSD', binance: 'DOGEUSDT' },
  { label: 'EURUSD',  binance: 'EURUSDT'  },
  { label: 'GBPUSD',  binance: 'GBPUSDT'  },
];

const state = { symbol: 'PAXGUSDT', display: 'XAUUSD', interval: '1h', bars: [], loaded: false };
const NEED = { line: 2, box: 2, fib: 2, hline: 1 };

const fmt = v => v == null || isNaN(v) ? '-' :
  Math.abs(v) >= 1000 ? v.toFixed(1) :
  Math.abs(v) >= 1    ? v.toFixed(3) : v.toFixed(6);

// ================= chart =================
const wrap = $('#chart-wrap');
const chartEl = $('#chart');
const chart = LightweightCharts.createChart(chartEl, {
  layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8b93a6', fontSize: 11,
            fontFamily: "'Inter', system-ui, sans-serif" },
  grid: { vertLines: { color: '#161b25' }, horzLines: { color: '#161b25' } },
  crosshair: {
    mode: LightweightCharts.CrosshairMode.Normal,
    vertLine: { color: '#3a4356', labelBackgroundColor: '#2962ff' },
    horzLine: { color: '#3a4356', labelBackgroundColor: '#2962ff' },
  },
  rightPriceScale: { borderColor: '#232a38' },
  timeScale: { borderColor: '#232a38', timeVisible: true, secondsVisible: false, rightOffset: 4 },
});
const candleSeries = chart.addCandlestickSeries({
  upColor: '#26a69a', downColor: '#ef5350',
  wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  borderVisible: false,
});
const plotPool = [];   // indicator overlay line series

const legend = $('#legend');
chart.subscribeCrosshairMove(param => {
  if (!state.loaded) { legend.textContent = ''; return; }
  const d = param.seriesData && param.seriesData.get(candleSeries);
  legend.textContent = d
    ? state.display + ' · ' + state.interval.toUpperCase() +
      '   O ' + fmt(d.open) + '  H ' + fmt(d.high) + '  L ' + fmt(d.low) + '  C ' + fmt(d.close)
    : state.display + ' · ' + state.interval.toUpperCase();
});

// ================= market data =================
function setStatus(msg) { $('#statusLeft').textContent = msg; }
function setLastInfo() {
  if (!state.loaded) return;
  const a = state.bars[state.bars.length - 1], b = state.bars[state.bars.length - 2];
  const chg = (a.close - b.close) / b.close * 100;
  $('#statusRight').innerHTML = state.display + ' ' + fmt(a.close) +
    ' <span style="color:' + (chg >= 0 ? '#26a69a' : '#ef5350') + '">' +
    (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%</span>';
}

async function loadData() {
  if (!state.symbol || state.symbol.length < 5) { setStatus('Enter a valid pair symbol'); return; }
  $('#loadBtn').disabled = true;
  setStatus('Loading ' + state.display + ' ' + state.interval + ' …');
  try {
    const url = API_BASE + '/api/v3/klines?symbol=' + state.symbol +
                '&interval=' + state.interval + '&limit=1000';
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const raw = await res.json();
    if (!Array.isArray(raw) || !raw.length) throw new Error('empty dataset');
    state.bars = raw.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
    }));
    candleSeries.setData(state.bars);
    chart.timeScale().fitContent();
    candleSeries.setMarkers([]);
    plotPool.forEach(s => chart.removeSeries(s)); plotPool.length = 0;
    dw.load(); dw.render();
    hmBuild();
    state.loaded = true;
    const lastT = new Date(state.bars[state.bars.length - 1].time * 1000).toUTCString();
    setStatus(state.display + ' · ' + state.interval + ' · ' + state.bars.length +
              ' bars · last bar ' + lastT);
    setLastInfo();
  } catch (e) {
    setStatus('Data error: ' + e.message +
      ' — Binance API is geo-blocked in some regions; set API_BASE in app.js to a relay/proxy or another feed.');
  } finally { $('#loadBtn').disabled = false; }
}

// ================= drawing tools =================
const svg = $('#overlay');
const drawColor = $('#drawColor');

const dw = {
  list: [], tool: 'cursor', draft: null, selectedId: null, drag: null,
  key() { return 'tradelab.dw.v1.' + state.symbol + '.' + state.interval; },
  load() {
    try { this.list = JSON.parse(localStorage.getItem(this.key()) || '[]'); }
    catch (e) { this.list = []; }
    this.selectedId = null; this.draft = null;
  },
  save() { try { localStorage.setItem(this.key(), JSON.stringify(this.list)); } catch (e) {} },
  x(t) { return chart.timeScale().timeToCoordinate(t); },
  y(p) { return candleSeries.priceToCoordinate(p); },
  pt(e) {
    const r = svg.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const t = chart.timeScale().coordinateToTime(x);
    const p = candleSeries.coordinateToPrice(y);
    if (t == null || p == null) return null;
    return { time: t, price: p, x, y };
  },
  render() { renderOverlay(); },
};

function mk(name, attrs) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function drawShape(d) {
  const pts = d.points.map(p => ({ x: dw.x(p.time), y: dw.y(p.price) }));
  if (pts.some(p => p.x == null || p.y == null)) return;
  const w = chartEl.clientWidth;
  const selected = d.id && d.id === dw.selectedId;
  const g = mk('g', { 'data-id': d.id || 'draft', 'class': 'dwg' + (selected ? ' selected' : '') });
  const line = (x1, y1, x2, y2, extra) =>
    g.appendChild(mk('line', Object.assign({ x1, y1, x2, y2, stroke: d.color, 'stroke-width': 1.6 }, extra || {})));

  if (d.type === 'line') line(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
  if (d.type === 'hline') line(0, pts[0].y, w, pts[0].y);
  if (d.type === 'box') {
    const x = Math.min(pts[0].x, pts[1].x), y = Math.min(pts[0].y, pts[1].y);
    g.appendChild(mk('rect', {
      x, y, width: Math.abs(pts[1].x - pts[0].x), height: Math.abs(pts[1].y - pts[0].y),
      fill: d.color, 'fill-opacity': 0.12, stroke: d.color, 'stroke-width': 1.4, 'stroke-dasharray': '3 3',
    }));
  }
  if (d.type === 'fib') {
    line(pts[0].x, pts[0].y, pts[1].x, pts[1].y, { 'stroke-dasharray': '4 3', 'stroke-width': 1 });
    for (const r of [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]) {
      const price = d.points[1].price + (d.points[0].price - d.points[1].price) * r;
      const y = dw.y(price);
      if (y == null) continue;
      line(pts[0].x, y, w, y, { 'stroke-width': 0.8, 'stroke-dasharray': '2 3' });
      const tx = mk('text', { x: w - 46, y: y - 3, fill: d.color, 'font-size': 10 });
      tx.textContent = String(r);
      g.appendChild(tx);
    }
  }
  if (selected) for (const p of pts) g.appendChild(mk('circle', { cx: p.x, cy: p.y, r: 4, 'class': 'handle' }));
  g.addEventListener('pointerdown', ev => onShapeDown(ev, d));
  svg.appendChild(g);
}

function renderOverlay() {
  const w = chartEl.clientWidth, h = chartEl.clientHeight;
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.innerHTML = '';
  svg.classList.toggle('drawing-mode', dw.tool !== 'cursor');
  for (const d of dw.list) drawShape(d);
  if (dw.draft) drawShape(dw.draft);
  if (dw.tool !== 'cursor') {
    const c = mk('rect', { x: 0, y: 0, width: w, height: h, 'class': 'draft-catcher' });
    c.addEventListener('pointerdown', onDraftClick);
    svg.appendChild(c);
  }
}

function onDraftClick(e) {
  e.stopPropagation();
  const p = dw.pt(e); if (!p) return;
  const need = NEED[dw.tool];
  if (!dw.draft) {
    dw.draft = { type: dw.tool, points: [p], color: drawColor.value };
  } else {
    if (dw.draft.points.length >= need) dw.draft.points[need - 1] = p; // replace ghost
    else dw.draft.points.push(p);
  }
  if (dw.draft.points.length >= need) {
    dw.draft.id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    dw.list.push(dw.draft); dw.draft = null; dw.save();
  }
  dw.render();
}

function onShapeDown(e, d) {
  if (dw.tool !== 'cursor') return;
  e.stopPropagation();
  dw.selectedId = d.id;
  const p = dw.pt(e);
  if (!p) { dw.render(); return; }
  let idx = -1;
  d.points.forEach((q, k) => {
    const x = dw.x(q.time), y = dw.y(q.price);
    if (x != null && y != null && Math.hypot(p.x - x, p.y - y) < 8) idx = k;
  });
  if (idx >= 0) dw.drag = { mode: 'point', drawing: d, idx };
  else dw.drag = { mode: 'move', drawing: d, start: p, origs: d.points.map(q => Object.assign({}, q)) };
  dw.render();
}

function onPointerMove(e) {
  if (dw.drag) {
    const p = dw.pt(e); if (!p) return;
    const { mode, drawing, idx, start, origs } = dw.drag;
    if (mode === 'point') drawing.points[idx] = p;
    else {
      const dt = p.time - start.time, dp = p.price - start.price;
      drawing.points = origs.map(o => ({ time: o.time + dt, price: o.price + dp }));
    }
    dw.render(); return;
  }
  if (dw.draft) {
    const need = NEED[dw.tool];
    const p = dw.pt(e);
    if (p && dw.draft.points.length < need) {
      dw.draft.points[dw.draft.points.length] = p; // ghost preview
      dw.render();
    }
  }
}

function onPointerUp() {
  if (dw.drag) { dw.drag = null; dw.save(); dw.render(); }
}

function deleteSelected() {
  if (!dw.selectedId) return;
  dw.list = dw.list.filter(d => d.id !== dw.selectedId);
  dw.selectedId = null; dw.save(); dw.render();
}

function setTool(t) {
  dw.tool = t;
  if (t !== 'cursor') { dw.selectedId = null; dw.draft = null; }
  $$('#drawTools .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  updateHint(); dw.render();
}

function updateHint() {
  const el = $('#hint');
  if (dw.tool === 'cursor') { el.style.display = 'none'; return; }
  const msgs = {
    line:  'Trendline: click start point, then end point',
    hline: 'Horizontal line: click to place',
    box:   'Box: click one corner, then the opposite corner',
    fib:   'Fibonacci: click swing point A, then swing point B',
  };
  el.textContent = (msgs[dw.tool] || '') + '  ·  Esc to cancel';
  el.style.display = 'block';
}


// ================= liquidity heatmap (BookMap-style) =================
// Reconstructs volume-at-price "liquidity bubbles" from OHLCV history:
// each bar's volume is distributed across its high-low range (weighted
// toward the typical price) and fades with age, like DOM liquidity decay.
const hmCv = $('#heatmap');
const hm = {
  enabled: false, off: null, bins: 0, pMin: 0, pBin: 0, raf: 0, dpr: 1,
  settings: Object.assign({ opacity: 55, decayHL: 150, buckets: 140, enabled: false },
    JSON.parse(localStorage.getItem('tradelab.hm') || '{}')),
};
hm.enabled = !!hm.settings.enabled;

function hmSaveSettings() { localStorage.setItem('tradelab.hm', JSON.stringify(hm.settings)); }

const hmLUT = (() => {
  const lut = [];
  const stops = [[38, 62, 160], [0, 190, 255], [255, 226, 60], [255, 122, 40], [255, 244, 244]];
  for (let k = 0; k <= 64; k++) {
    const pos = (k / 64) * (stops.length - 1);
    const i0 = Math.min(Math.floor(pos), stops.length - 2), f = pos - i0;
    const c = stops[i0].map((v, j) => Math.round(v + (stops[i0 + 1][j] - v) * f));
    lut.push('rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')');
  }
  return lut;
})();

function hmBuild() {
  hm.off = null;
  if (!hm.enabled || !state.loaded) { hmRender(); return; }
  const bars = state.bars, n = bars.length, B = hm.settings.buckets;
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { if (b.low < lo) lo = b.low; if (b.high > hi) hi = b.high; }
  const range = (hi - lo) || 1;
  hm.pMin = lo; hm.pBin = range / B; hm.bins = B;

  const grid = new Float32Array(n * B);
  const HL = hm.settings.decayHL;
  let maxV = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i], l = b.low, h = b.high, v = b.volume || 0;
    if (!v || h < l) continue;
    const decay = Math.pow(0.5, (n - 1 - i) / HL);
    let b0 = Math.floor((l - lo) / hm.pBin), b1 = Math.floor((h - lo) / hm.pBin);
    if (b0 < 0) b0 = 0; if (b1 > B - 1) b1 = B - 1;
    const base = i * B;
    if (b0 === b1) {
      grid[base + b0] += v * decay;
      if (grid[base + b0] > maxV) maxV = grid[base + b0];
      continue;
    }
    const tp = (h + l + 2 * b.close) / 4, span = (h - l) || 1e-9;
    let wsum = 0;
    for (let j = b0; j <= b1; j++) wsum += Math.max(0.05, 1 - Math.abs(lo + (j + 0.5) * hm.pBin - tp) / span);
    for (let j = b0; j <= b1; j++) {
      const w = Math.max(0.05, 1 - Math.abs(lo + (j + 0.5) * hm.pBin - tp) / span) / wsum;
      const val = v * decay * w;
      grid[base + j] = val;
      if (val > maxV) maxV = val;
    }
  }
  if (!maxV) { hmRender(); return; }

  const off = document.createElement('canvas');
  off.width = n; off.height = B;
  const ctx = off.getContext('2d');
  ctx.globalAlpha = hm.settings.opacity / 100;
  for (let i = 0; i < n; i++) {
    const base = i * B;
    for (let j = 0; j < B; j++) {
      const t = grid[base + j] / maxV;
      if (t < 0.03) continue;                                  // skip near-empty cells
      const idx = Math.min(64, (Math.pow(t, 0.65) * 64) | 0);  // gamma for contrast
      ctx.fillStyle = hmLUT[idx];
      ctx.fillRect(i, B - 1 - j, 1, 1);
    }
  }
  hm.off = off;
  hmRender();
}

function hmRender() {
  hm.raf = 0;
  const ctx = hmCv.getContext('2d');
  ctx.setTransform(hm.dpr, 0, 0, hm.dpr, 0, 0);
  ctx.clearRect(0, 0, hmCv.width, hmCv.height);
  if (!hm.enabled || !hm.off || !state.loaded) return;
  const r = chart.timeScale().getVisibleLogicalRange();
  if (!r) return;
  const n = state.bars.length;
  const from = Math.max(0, r.from), to = Math.min(n - 1, r.to);
  if (to - from < 0.5) return;
  const xAt = li => {
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(li)));
    const i1 = Math.max(0, Math.min(n - 1, Math.ceil(li)));
    const x0 = chart.timeScale().timeToCoordinate(state.bars[i0].time);
    const x1 = chart.timeScale().timeToCoordinate(state.bars[i1].time);
    if (x0 == null || x1 == null) return null;
    return x0 + (x1 - x0) * (li - i0);
  };
  const dx0 = xAt(from), dx1 = xAt(to);
  const yTop = candleSeries.priceToCoordinate(hm.pMin + hm.pBin * hm.bins);
  const yBot = candleSeries.priceToCoordinate(hm.pMin);
  if (dx0 == null || dx1 == null || yTop == null || yBot == null) return;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(hm.off, from, 0, to - from, hm.bins, dx0, yTop, dx1 - dx0, yBot - yTop);
}

function hmRequest() { if (!hm.raf) hm.raf = requestAnimationFrame(hmRender); }

function setHmEnabled(v) {
  hm.enabled = v;
  hm.settings.enabled = v;
  hmSaveSettings();
  $('#liqToggle').classList.toggle('active', v);
  hmBuild();
}

// ================= backtest UI =================
let lastResult = null;

function dedupeMarkers(ms) {
  const out = [];
  for (const m of ms) if (!out.length || out[out.length - 1].time < m.time) out.push(m);
  return out;
}

function runBacktest() {
  if (!state.loaded) { setStatus('Load chart data first'); switchTab('strategy'); return; }
  $('#btError').textContent = '';
  const cash = parseFloat($('#startCash').value) || 10000;
  const t0 = performance.now();
  const res = BacktestEngine.run(state.bars, $('#code').value, { startCash: cash });
  const dt = (performance.now() - t0).toFixed(1);
  if (res.error) { $('#btError').textContent = 'Strategy error: ' + res.error; setStatus('Backtest failed'); return; }
  lastResult = res;
  renderResults(res);
  candleSeries.setMarkers(dedupeMarkers(res.markers));
  plotPool.forEach(s => chart.removeSeries(s)); plotPool.length = 0;
  for (const pl of res.plots) {
    const s = chart.addLineSeries({
      color: pl.color, lineWidth: 1, priceLineVisible: false,
      lastValueVisible: false, crosshairMarkerVisible: false,
    });
    s.setData(pl.data); plotPool.push(s);
  }
  $('#btTime').textContent = dt + ' ms · ' + res.trades.length + ' trades';
  setStatus('Backtest finished in ' + dt + ' ms');
  switchTab('results');
}

function metric(label, value, color) {
  return '<div class="metric"><div class="m-label">' + label + '</div>' +
         '<div class="m-value"' + (color ? ' style="color:' + color + '"' : '') + '>' + value + '</div></div>';
}

const iso = t => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') + 'Z';

function renderResults(res) {
  const m = res.metrics;
  $('#metricsGrid').innerHTML =
    metric('Net Profit', (m.totalReturnPct >= 0 ? '+' : '') + m.totalReturnPct.toFixed(2) + '%',
           m.totalReturnPct >= 0 ? '#26a69a' : '#ef5350') +
    metric('Final Equity', fmt(m.finalEquity)) +
    metric('Trades', m.totalTrades) +
    metric('Win Rate', m.winRatePct.toFixed(1) + '%') +
    metric('Profit Factor', isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞') +
    metric('Max Drawdown', m.maxDrawdownPct.toFixed(2) + '%', '#ef5350') +
    metric('Avg Trade', fmt(m.avgTrade)) +
    metric('Long / Short', m.longTrades + ' / ' + m.shortTrades);

  $('#tradesTable tbody').innerHTML = res.trades.slice().reverse().map(t =>
    '<tr><td style="color:' + (t.side === 'long' ? '#26a69a' : '#ef5350') + '">' + t.side.toUpperCase() + '</td>' +
    '<td>' + t.qty + '</td><td>' + fmt(t.entry) + '</td><td>' + fmt(t.exit) + '</td>' +
    '<td style="color:' + (t.pnl >= 0 ? '#26a69a' : '#ef5350') + '">' + (t.pnl >= 0 ? '+' : '') + fmt(t.pnl) + '</td>' +
    '<td>' + (t.reason || '') + '</td><td>' + iso(t.entryTime) + '</td><td>' + iso(t.exitTime) + '</td></tr>'
  ).join('') || '<tr><td colspan="8" style="color:var(--muted)">No trades generated</td></tr>';

  drawEquity(res.equity);
}

function drawEquity(eq) {
  const c = $('#equityCanvas');
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 320, h = 140;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
  if (!eq || eq.length < 2) return;
  const vals = eq.map(p => p.value);
  const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), span = (max - min) || 1;
  const px = k => k / (eq.length - 1) * w;
  const py = v => h - 6 - (v - min) / span * (h - 12);
  const up = vals[vals.length - 1] >= vals[0];
  const col = up ? '#26a69a' : '#ef5350';
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, up ? 'rgba(38,166,154,.25)' : 'rgba(239,83,80,.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.moveTo(0, py(vals[0]));
  vals.forEach((v, k) => ctx.lineTo(px(k), py(v)));
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  ctx.fillStyle = '#8b93a6'; ctx.font = '10px system-ui';
  ctx.fillText(max.toFixed(2), 4, 10);
  ctx.fillText(min.toFixed(2), 4, h - 4);
}

function exportCSV() {
  if (!lastResult) return;
  const rows = [['side', 'qty', 'entry', 'exit', 'pnl', 'reason', 'entryTimeUTC', 'exitTimeUTC']]
    .concat(lastResult.trades.map(t => [t.side, t.qty, t.entry, t.exit, t.pnl.toFixed(4),
      t.reason || '', new Date(t.entryTime * 1000).toISOString(), new Date(t.exitTime * 1000).toISOString()]));
  const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'backtest_' + state.symbol + '_' + state.interval + '.csv';
  a.click(); URL.revokeObjectURL(a.href);
}

// ================= strategy examples =================
const EXAMPLES = {
'EMA Cross + ATR stops': `// Trade with the trend: EMA cross entry, ATR-based SL/TP
const fast = ema(close, 9);
const slow = ema(close, 21);
const risk = atr(14);

if (crossover(fast, slow)) {
  strategy.buy({
    qty: 1,
    sl: low.get(1) - 1.5 * risk.value,
    tp: close.value + 3 * risk.value,
    comment: 'EMA cross up'
  });
}
if (crossunder(fast, slow)) strategy.close('EMA cross down');

plot(fast, '#2196f3', 'EMA 9');
plot(slow, '#ff9800', 'EMA 21');`,

'RSI Mean Reversion': `// Buy oversold, exit overbought
const r = rsi(close, 14);

if (r.value < 30 && strategy.position().size === 0) {
  strategy.buy({
    qty: 1,
    sl: low.get(2),
    tp: close.value + (close.value - low.get(2)) * 1.5,
    comment: 'RSI < 30'
  });
}
if (r.value > 70 && strategy.position().size > 0) strategy.close('RSI > 70');

plot(r, '#ab47bc', 'RSI 14');`,

'Donchian Breakout (turtle)': `// Classic 20-bar breakout, exit on 10-bar low
const hh = highest(high, 20);
const ll = lowest(low, 10);

if (close.value > hh.get(1)) strategy.buy({ qty: 1, comment: 'Breakout 20' });
if (close.value < ll.get(1)) strategy.close('10-bar low');

plot(hh, '#66bb6a', 'HH 20');
plot(ll, '#ef5350', 'LL 10');`,
};

// ================= misc UI =================
function switchTab(name) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-page').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'results') drawEquity(lastResult ? lastResult.equity : []);
}

function onKey(e) {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (dw.draft) { dw.draft = null; dw.render(); } else setTool('cursor');
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && dw.selectedId) { deleteSelected(); return; }
  if (k === 'v') setTool('cursor');
  if (k === 'l') setTool('line');
  if (k === 'h') setTool('hline');
  if (k === 'b') setTool('box');
  if (k === 'f') setTool('fib');
}

function sizeChart() {
  chart.applyOptions({ width: wrap.clientWidth, height: wrap.clientHeight });
  hm.dpr = window.devicePixelRatio || 1;
  hmCv.width = wrap.clientWidth * hm.dpr;
  hmCv.height = wrap.clientHeight * hm.dpr;
  hmCv.style.width = wrap.clientWidth + 'px';
  hmCv.style.height = wrap.clientHeight + 'px';
  dw.render();
  hmRequest();
}

// ================= init =================
function init() {
  const sel = $('#pairSelect');
  for (const p of PAIRS) {
    const o = document.createElement('option');
    o.value = p.binance;
    o.textContent = p.label + '  (' + p.binance + ')';
    sel.appendChild(o);
  }
  sel.value = state.symbol;
  sel.onchange = () => {
    state.symbol = sel.value;
    state.display = (PAIRS.find(p => p.binance === sel.value) || {}).label || sel.value;
    loadData();
  };
  $('#intervalSelect').onchange = e => { state.interval = e.target.value; loadData(); };
  $('#loadBtn').onclick = () => {
    const v = $('#symbolInput').value.trim().toUpperCase();
    if (v) {
      state.symbol = v;
      state.display = (PAIRS.find(p => p.binance === v) || {}).label || v;
    }
    loadData();
  };
  $('#symbolInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loadBtn').click(); });

  $$('#drawTools .tool').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('#delDraw').onclick = deleteSelected;
  $('#clearDraw').onclick = () => {
    if (confirm('Delete all drawings on this chart?')) {
      dw.list = []; dw.selectedId = null; dw.save(); dw.render();
    }
  };
  $('#panelToggle').onclick = () => $('#side').classList.toggle('collapsed');
  $('#runBtn').onclick = runBacktest;
  $('#csvBtn').onclick = exportCSV;
  $$('.tab-btn').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

  const ex = $('#exampleSel');
  for (const k in EXAMPLES) {
    const o = document.createElement('option');
    o.value = k; o.textContent = k;
    ex.appendChild(o);
  }
  ex.onchange = () => { if (ex.value) $('#code').value = EXAMPLES[ex.value]; };
  $('#code').value = EXAMPLES['EMA Cross + ATR stops'];

  window.addEventListener('keydown', onKey);
  wrap.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  chartEl.addEventListener('pointerdown', () => {
    if (dw.tool === 'cursor' && dw.selectedId) { dw.selectedId = null; dw.render(); }
  });
  new ResizeObserver(sizeChart).observe(wrap);
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => { dw.render(); hmRequest(); });

  // liquidity heatmap controls
  const op = $('#liqOpacity'), dc = $('#liqDecay'), bk = $('#liqBuckets');
  op.value = hm.settings.opacity;
  dc.value = String(hm.settings.decayHL);
  bk.value = String(hm.settings.buckets);
  $('#liqToggle').classList.toggle('active', hm.enabled);
  $('#liqToggle').onclick = () => setHmEnabled(!hm.enabled);
  $('#liqSettingsBtn').onclick = e => { e.stopPropagation(); $('#liqPanel').classList.toggle('hidden'); };
  document.addEventListener('click', e => {
    if (!e.target.closest('#liqPanel') && !e.target.closest('#liqSettingsBtn'))
      $('#liqPanel').classList.add('hidden');
  });
  op.oninput = () => { hm.settings.opacity = +op.value; hmSaveSettings(); hmBuild(); };
  dc.onchange = () => { hm.settings.decayHL = +dc.value; hmSaveSettings(); hmBuild(); };
  bk.onchange = () => { hm.settings.buckets = +bk.value; hmSaveSettings(); hmBuild(); };

  loadData();
}

document.addEventListener('DOMContentLoaded', init);
})();
