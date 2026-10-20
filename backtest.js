/* ============================================================
   TradeLab Backtest Engine  (backtest.js)
   Pine Script-inspired strategy DSL, executed natively in JS.
   ------------------------------------------------------------
   EXECUTION MODEL
   - strategy.buy/sell/close()  -> fills at NEXT bar OPEN
   - sl / tp                    -> checked intrabar on high/low,
                                   with gap handling; SL wins ties
   - No leverage/margin: qty = units of base asset.
     Equity = startCash + realized PnL + floating PnL
   ============================================================ */
const BacktestEngine = (() => {
  'use strict';

  // ---------------- indicator math (full arrays) ----------------
  function smaArr(src, len) {
    const out = new Array(src.length).fill(NaN);
    let sum = 0;
    for (let i = 0; i < src.length; i++) {
      sum += src[i];
      if (i >= len) sum -= src[i - len];
      if (i >= len - 1) out[i] = sum / len;
    }
    return out;
  }
  function emaArr(src, len) {
    const out = new Array(src.length);
    const k = 2 / (len + 1);
    let prev = src[0];
    out[0] = prev;
    for (let i = 1; i < src.length; i++) { prev = src[i] * k + prev * (1 - k); out[i] = prev; }
    return out;
  }
  function rmaArr(src, len) { // Wilder smoothing
    const out = new Array(src.length);
    let prev = src[0];
    out[0] = prev;
    for (let i = 1; i < src.length; i++) { prev = (prev * (len - 1) + src[i]) / len; out[i] = prev; }
    return out;
  }
  function rsiArr(src, len) {
    const n = src.length;
    const up = new Array(n).fill(0), dn = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const d = src[i] - src[i - 1];
      if (d > 0) up[i] = d; else dn[i] = -d;
    }
    const ru = rmaArr(up, len), rd = rmaArr(dn, len);
    return src.map((_, i) => rd[i] === 0 ? 100 : 100 - 100 / (1 + ru[i] / rd[i]));
  }
  function atrArr(h, l, c, len) {
    const n = h.length, tr = new Array(n);
    for (let i = 0; i < n; i++) {
      const pc = i ? c[i - 1] : c[i];
      tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc));
    }
    return rmaArr(tr, len);
  }
  function stdevArr(src, len) {
    const out = new Array(src.length).fill(NaN);
    for (let i = len - 1; i < src.length; i++) {
      let m = 0;
      for (let j = i - len + 1; j <= i; j++) m += src[j];
      m /= len;
      let s = 0;
      for (let j = i - len + 1; j <= i; j++) s += (src[j] - m) ** 2;
      out[i] = Math.sqrt(s / len);
    }
    return out;
  }
  function highestArr(src, len) {
    const out = new Array(src.length).fill(NaN);
    for (let i = 0; i < src.length; i++) {
      const from = Math.max(0, i - len + 1);
      let m = -Infinity;
      for (let j = from; j <= i; j++) if (src[j] > m) m = src[j];
      out[i] = m;
    }
    return out;
  }
  function lowestArr(src, len) {
    const out = new Array(src.length).fill(NaN);
    for (let i = 0; i < src.length; i++) {
      const from = Math.max(0, i - len + 1);
      let m = Infinity;
      for (let j = from; j <= i; j++) if (src[j] < m) m = src[j];
      out[i] = m;
    }
    return out;
  }

  // ---------------- main entry ----------------
  function run(bars, code, cfg = {}) {
    const n = bars.length;
    if (!Array.isArray(bars) || n < 2) return { error: 'Not enough bars loaded' };
    const O = bars.map(b => b.open),  H = bars.map(b => b.high),
          L = bars.map(b => b.low),   C = bars.map(b => b.close),
          V = bars.map(b => b.volume || 0), T = bars.map(b => b.time);

    let i = 0;               // current bar index (strategy code runs bar-by-bar)
    let sid = 0;
    const cache = new Map(); // memoized indicator series -> O(1) per bar

    const ser = arr => ({
      __id: ++sid, arr,
      get value() { return arr[i]; },
      get(k) { return i - k >= 0 ? arr[i - k] : NaN; },  // .get(1) = previous value
      valueOf() { return arr[i]; },
    });
    const ind = (name, srcId, argKey, calc) => {
      const key = name + '|' + srcId + '|' + argKey;
      let s = cache.get(key);
      if (!s) { s = ser(calc()); cache.set(key, s); }
      return s;
    };

    const sma      = (s, l)      => ind('sma', s.__id, l, () => smaArr(s.arr, l));
    const ema      = (s, l)      => ind('ema', s.__id, l, () => emaArr(s.arr, l));
    const rma      = (s, l)      => ind('rma', s.__id, l, () => rmaArr(s.arr, l));
    const rsi      = (s, l = 14) => ind('rsi', s.__id, l, () => rsiArr(s.arr, l));
    const atr      = (l = 14)    => ind('atr', 0, l, () => atrArr(H, L, C, l));
    const stdev    = (s, l)      => ind('sd',  s.__id, l, () => stdevArr(s.arr, l));
    const highest  = (s, l)      => ind('hh',  s.__id, l, () => highestArr(s.arr, l));
    const lowest   = (s, l)      => ind('ll',  s.__id, l, () => lowestArr(s.arr, l));
    const macd = (s, f = 12, sl = 26, sg = 9) => {
      const key = 'macd|' + s.__id + '|' + f + ',' + sl + ',' + sg;
      let r = cache.get(key);
      if (!r) {
        const ef = emaArr(s.arr, f), es = emaArr(s.arr, sl);
        const m = s.arr.map((_, k) => ef[k] - es[k]);
        const g = emaArr(m, sg);
        r = { m: ser(m), g: ser(g), h: ser(m.map((v, k) => v - g[k])) };
        cache.set(key, r);
      }
      return { macd: r.m, signal: r.g, hist: r.h };
    };
    const bollinger = (s, l = 20, mult = 2) => {
      const key = 'bb|' + s.__id + '|' + l + ',' + mult;
      let r = cache.get(key);
      if (!r) {
        const mid = smaArr(s.arr, l), sd = stdevArr(s.arr, l);
        r = { mid: ser(mid),
              up: ser(mid.map((v, k) => v + mult * sd[k])),
              lo: ser(mid.map((v, k) => v - mult * sd[k])) };
        cache.set(key, r);
      }
      return { middle: r.mid, upper: r.up, lower: r.lo };
    };
    const crossover  = (a, b) => a.get(1) <= b.get(1) && a.value > b.value;
    const crossunder = (a, b) => a.get(1) >= b.get(1) && a.value < b.value;
    const ref = (s, k) => s.get(k);

    // ---------------- strategy state (the "EA") ----------------
    const startCash = cfg.startCash || 10000;
    const logs = [];
    const st = {
      cash: startCash, pos: null, pending: null,
      trades: [], equity: [], markers: [], plots: [],

      buy(o = {})  { this.signal(1, o); },
      sell(o = {}) { this.signal(-1, o); },
      signal(dir, o = {}) {
        this.pending = { dir, qty: o.qty ?? 1, sl: o.sl ?? null, tp: o.tp ?? null, comment: o.comment || '' };
      },
      close(comment = 'Close') { if (this.pos) this.pending = { dir: 0, qty: 0, comment }; },
      closeAll(comment = 'End of data') { if (this.pos) doExit(C[i], i, comment); },
      position() {
        if (!this.pos) return { size: 0, entryPrice: NaN, pnl: 0, barsInTrade: 0 };
        const p = this.pos;
        return { size: p.dir * p.qty, entryPrice: p.entry,
                 pnl: (C[i] - p.entry) * p.dir * p.qty, barsInTrade: i - p.entryIndex };
      },
      equityNow() { return this.cash + (this.pos ? (C[i] - this.pos.entry) * this.pos.dir * this.pos.qty : 0); },
      plot(series, color = '#2962ff', title = 'plot') {
        if (!series || !series.arr) return;
        this.plots.push({ color, title,
          data: series.arr.map((v, k) => isNaN(v) ? null : { time: T[k], value: v }).filter(Boolean) });
      },
    };

    function doExit(price, idx, reason) {
      const p = st.pos; if (!p) return;
      const pnl = (price - p.entry) * p.dir * p.qty;
      st.cash += pnl;
      st.trades.push({
        side: p.dir > 0 ? 'long' : 'short', qty: p.qty,
        entry: p.entry, exit: price, pnl,
        entryTime: T[p.entryIndex], exitTime: T[idx],
        entryIndex: p.entryIndex, exitIndex: idx, reason: reason || '',
      });
      st.markers.push({
        time: T[idx], position: p.dir > 0 ? 'aboveBar' : 'belowBar',
        color: '#f0b90b', shape: 'circle',
        text: reason === 'SL' ? 'SL' : (reason === 'TP' ? 'TP' : ''),
      });
      st.pos = null;
    }

    function fillEntry(idx, pend) {
      if (st.pos) {
        if (st.pos.dir === pend.dir) return;      // already in this direction
        doExit(O[idx], idx, 'reverse');            // opposite signal reverses the trade
      }
      st.pos = { dir: pend.dir, qty: pend.qty, entry: O[idx], sl: pend.sl, tp: pend.tp, entryIndex: idx };
      st.markers.push({
        time: T[idx], position: pend.dir > 0 ? 'belowBar' : 'aboveBar',
        color: pend.dir > 0 ? '#26a69a' : '#ef5350',
        shape: pend.dir > 0 ? 'arrowUp' : 'arrowDown',
        text: pend.dir > 0 ? 'B' : 'S',
      });
    }

    function checkStops(idx) { // intrabar SL/TP with gap handling, SL has priority
      const p = st.pos; if (!p) return;
      const o = O[idx], h = H[idx], l = L[idx];
      if (p.dir > 0) {
        if (p.sl != null && (o <= p.sl || l <= p.sl)) { doExit(o <= p.sl ? o : p.sl, idx, 'SL'); return; }
        if (p.tp != null && (o >= p.tp || h >= p.tp)) { doExit(o >= p.tp ? o : p.tp, idx, 'TP'); return; }
      } else {
        if (p.sl != null && (o >= p.sl || h >= p.sl)) { doExit(o >= p.sl ? o : p.sl, idx, 'SL'); return; }
        if (p.tp != null && (o <= p.tp || l <= p.tp)) { doExit(o <= p.tp ? o : p.tp, idx, 'TP'); return; }
      }
    }

    const safeLog = (...a) => logs.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' '));

    const fn = new Function(
      'open', 'high', 'low', 'close', 'volume', 'time', 'bar', 'strategy', 'log',
      'sma', 'ema', 'rma', 'rsi', 'atr', 'stdev', 'highest', 'lowest',
      'crossover', 'crossunder', 'macd', 'bollinger', 'ref', 'plot',
      '"use strict";\n' + code
    );

    const sO = ser(O), sH = ser(H), sL = ser(L), sC = ser(C), sV = ser(V), sT = ser(T);

    try {
      for (i = 0; i < n; i++) {
        // 1) pending order from previous bar fills at THIS bar's open
        if (st.pending) {
          const p = st.pending; st.pending = null;
          if (p.dir === 0) doExit(O[i], i, p.comment); else fillEntry(i, p);
        }
        // 2) intrabar stop / target checks
        checkStops(i);
        // 3) run strategy code on bar close (last bar skipped: nothing left to fill on)
        if (i >= n - 1) break;
        fn(sO, sH, sL, sC, sV, sT, bars[i], st, safeLog,
           sma, ema, rma, rsi, atr, stdev, highest, lowest,
           crossover, crossunder, macd, bollinger, ref,
           (s, c, t) => st.plot(s, c, t));
        // 4) mark-to-market equity at close
        st.equity.push({ time: T[i], value: st.equityNow() });
      }
      st.closeAll();
      st.equity.push({ time: T[n - 1], value: st.equityNow() });
    } catch (e) {
      return { error: e.message, logs };
    }

    // ---------------- metrics ----------------
    const eqVals = st.equity.map(p => p.value);
    let peak = eqVals[0] ?? startCash, maxDD = 0;
    for (const v of eqVals) {
      if (v > peak) peak = v;
      const dd = peak ? (peak - v) / peak * 100 : 0;
      if (dd > maxDD) maxDD = dd;
    }
    const wins   = st.trades.filter(t => t.pnl > 0);
    const losses = st.trades.filter(t => t.pnl <= 0);
    const grossW = wins.reduce((a, t) => a + t.pnl, 0);
    const grossL = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
    const finalEq = eqVals.length ? eqVals[eqVals.length - 1] : startCash;
    const metrics = {
      startCash, finalEquity: finalEq,
      totalReturnPct: (finalEq - startCash) / startCash * 100,
      totalTrades: st.trades.length,
      longTrades: st.trades.filter(t => t.side === 'long').length,
      shortTrades: st.trades.filter(t => t.side === 'short').length,
      winRatePct: st.trades.length ? wins.length / st.trades.length * 100 : 0,
      profitFactor: grossL > 0 ? grossW / grossL : (grossW > 0 ? Infinity : 0),
      maxDrawdownPct: maxDD,
      avgTrade: st.trades.length ? st.trades.reduce((a, t) => a + t.pnl, 0) / st.trades.length : 0,
      avgWin:  wins.length   ? grossW / wins.length : 0,
      avgLoss: losses.length ? -grossL / losses.length : 0,
    };

    return { metrics, trades: st.trades, equity: st.equity, markers: st.markers, plots: st.plots, logs };
  }

  return { run };
})();
