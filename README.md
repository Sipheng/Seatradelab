# ⚡ TradeLab

A **TradingView-style charting web app with a built-in strategy backtester**, designed to be hosted for free on **GitHub Pages**. No build step, no server, no API keys — everything runs in the browser.

![stack](https://img.shields.io/badge/stack-vanilla%20JS%20%2B%20Lightweight%20Charts-2962ff)

## Features

- **Candlestick charts** (TradingView Lightweight Charts engine) with crosshair, OHLC legend, pan/zoom
- **Default pair XAUUSD** (gold), plus BTC, ETH, SOL, EUR/GBP and any custom Binance pair
- **Liquidity heatmap (BookMap-style)** 💧: bright volume-at-price "bubbles" rendered behind the candles, with configurable opacity, decay half-life and resolution
- **Drawing tools**: Trendline, Horizontal line, Box, Fibonacci retracement
  - Click to place, drag points/handles to edit, drag whole shape to move
  - `Del` / ✕ deletes the selected drawing, per-symbol & timeframe persistence via `localStorage`
  - Shortcuts: `V` cursor, `L` line, `H` h-line, `B` box, `F` fibo, `Esc` cancel
- **Strategy backtester** (the "custom indicator / EA" engine):
  - Pine Script–inspired **JavaScript DSL** — write, edit, and re-run instantly in the side panel
  - Orders fill at **next bar open** (realistic, avoids look-ahead bias)
  - **SL/TP checked intrabar** on high/low, with gap handling; SL wins ties (conservative)
  - Buy/sell arrows + SL/TP markers on the chart, `plot()` overlays any indicator on the chart
  - Metrics: net profit %, final equity, win rate, profit factor, max drawdown, avg trade, CSV export

## Quick start (local)

Just open `index.html` in a browser, or serve the folder:

```bash
npx serve .        # or: python3 -m http.server
```

## Deploy to GitHub Pages

1. Create a new repository on GitHub, e.g. `tradelab`.
2. Upload these files to the repo root:
   `index.html`, `style.css`, `app.js`, `backtest.js`, `README.md`
   ```bash
   git init && git add . && git commit -m "TradeLab"
   git remote add origin https://github.com/<you>/tradelab.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch** → pick `main` / `(root)` → **Save**.
4. Wait ~1 minute. Your site is live at `https://<you>.github.io/tradelab/`.

## Liquidity heatmap 💧

Toggle **💧 Liquidity** in the toolbar. The heatmap reconstructs where liquidity sits using **volume-at-price analysis**: each bar's traded volume is distributed across its high→low range (weighted toward the typical price) and faded with an exponential **decay half-life** (default 150 bars) — mimicking how resting order-book liquidity decays in BookMap. Bright yellow/red bubbles = heavy liquidity zones; dark blue = thin liquidity.

Settings (⚙ button):
- **Opacity** — overall heatmap intensity
- **Decay (bars)** — half-life of liquidity memory (shorter = only recent volume glows)
- **Resolution** — number of price bins (Low/Medium/High)

> Honest limitation: this is reconstructed from **traded volume (OHLCV)**, not a live order book. Real BookMap needs a paid depth-of-market data feed. If you add a DOM/WebSocket feed later, the same canvas layer can render true book heat.

## Strategy API (the "EA" language)

Strategies are plain JavaScript executed bar-by-bar (like an EA's `OnTick`). The code runs on every bar close with full history available.

### Data & series
| Object | Meaning |
|---|---|
| `open` `high` `low` `close` `volume` | price series (current bar = `.value`, history = `.get(n)`, e.g. `close.get(1)` is the previous close) |
| `time` | bar time (unix seconds) |
| `bar` | raw `{time, open, high, low, close, volume}` of current bar |
| `log(...)` | write to the console |

### Orders (`strategy` object)
```js
strategy.buy({ qty: 1, sl: 3850, tp: 3950, comment: 'breakout' });  // long
strategy.sell({ qty: 1, sl: ..., tp: ... });                        // short
strategy.close('reason');              // exit at next bar open
strategy.closeAll();                   // force exit now (end of test)
strategy.position();                   // -> {size, entryPrice, pnl, barsInTrade}
```
- Entries and signal-exits fill at the **next bar's open**.
- `sl` / `tp` are absolute prices, checked **intrabar** on high/low (gap-safe; SL priority on ties).
- `qty` = units of the base asset (no margin model). Equity = start cash + realized + floating PnL.

### Indicators & signals
```js
sma(src, len)            ema(src, len)            rma(src, len)   // Wilder
rsi(src, len=14)         atr(len=14)              stdev(src, len)
highest(src, len)        lowest(src, len)
macd(src, 12, 26, 9)     // -> {macd, signal, hist}
bollinger(src, 20, 2)    // -> {middle, upper, lower}
crossover(a, b)          crossunder(a, b)         ref(series, n)
plot(series, '#2196f3', 'EMA 20')   // overlay on chart
```

### Minimal example
```js
const fast = ema(close, 9), slow = ema(close, 21);
if (crossover(fast, slow))  strategy.buy({ qty: 1 });
if (crossunder(fast, slow)) strategy.close();
plot(fast, '#2196f3', 'EMA 9');
plot(slow, '#ff9800', 'EMA 21');
```

More examples are built into the **Load example…** dropdown (EMA cross + ATR stops, RSI mean reversion, turtle breakout).

## Data source & XAUUSD note

Market data comes from the **Binance public klines API** (no key needed). There is no free CORS-enabled spot-gold/forex OHLC feed, so **XAUUSD is proxied by `PAXGUSDT`** (Pax Gold, a gold-backed token that tracks the spot price closely). To use a real broker feed, replace `API_BASE` / `loadData()` in `app.js` with any REST API that returns OHLCV.

> Binance API is geo-blocked in some countries (e.g. the US). If data fails to load, point `API_BASE` to a relay/proxy or another feed.

## Roadmap ideas

- More drawings (text, measure, channels) & alerts on drawing hit
- Optimizer (sweep strategy params, heatmap of results)
- More timeframes / replay mode / multi-pane indicators
- Optional Python strategies via Pyodide (slower, off by default)

## Disclaimer

For research and education only. Backtests are simulated on historical data and never guarantee future results. Not financial advice.
