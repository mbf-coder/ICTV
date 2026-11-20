# Quantum Flow Analyzer v6 — Indicator, Verification & Signal Station

Pine Script v6 indicator for TradingView that combines **orderflow (delta + CVD),
ADX/DI, momentum, 4 EMAs, SMC (Order Blocks, BOS/CHoCH, FVG, Premium/Discount),
volume profile (POC/VAH/VAL), intrabar footprint and a decision panel**
(`STRONG BUY / BUY / WAIT / SELL / STRONG SELL`), plus a reproducible
verification suite and a modern web **Signal Trading Station** for retailers,
quantum traders and institutional traders.

> Not financial advice. The delta/footprint are **estimated** from intrabar price
> movement, not real bid/ask data. Symbols with tick volume only are shown as
> `TICK VOL` (directional delta loses meaning there).

## Repository layout

| Path | What it is |
|---|---|
| `quant-flow/QuantumFlowAnalyzer_v6.pine` | The deliverable indicator (single script, no external libraries). **1036 lines, ~64.7 KB**, assembled from `quant-flow/src/qfa.01`–`qfa.06`. |
| `quant-flow/src/qfa.*` | Versioned parts of the indicator (files >10 KB live as parts). |
| `quant-flow/README.md` | Indicator manual (settings groups, profiles, panel modes, predictor). |
| `verify/` | Reproducible verification suite (`verify_all.sh` + parser, lint, runtime, checklist). |
| `verify/parts/` | Versioned parts of the two other large files (`lint.*`, `rt.*`). |
| `verify/assemble.py` | Deterministically concatenates the parts and gates them by sha256. |
| `station/` | Signal Trading Station: modern web UI (retail / quantum / institutional). |
| `preview/index.html` | Visual OB life-cycle reviewer (virgin → touched → mitigated → invalidated). |
| `.github/workflows/verify.yml` | CI: runs the suite on every push and PR. |

## Indicator (TradingView)

**Install:** TradingView → **Pine Editor** → paste the contents of
`quant-flow/QuantumFlowAnalyzer_v6.pine` → **Save** → **Add to chart**.
Review setting group `2 · Orderflow y Delta` (intrabar timeframe, must be lower
than the chart's) and group `7 · Footprint`.

**Setting groups:** `0 · Perfil símbolo/timeframe` · `1 · Visual` ·
`2 · Orderflow y Delta` · `3 · Tendencia y Momentum` · `4 · SMC y Zonas` ·
`5 · Perfil de Volumen` · `6 · Panel y Decisión` · `7 · Footprint` ·
`8 · Sesiones Londres/NY`.

**Symbol/timeframe profiles** (`Auto` resolves by volume type and timeframe;
`Manual` uses the raw group 2/3/6 values):

| Profile | Strong/normal score | ADX min/strong | Trend/ADX/mom/orderflow/structure weights | Delta (δ/CVD/control) | Absorption |
|---|---|---|---|---|---|
| Cripto intradía | 55 / 25 | 18 / 28 | 25 / 20 / 15 / 25 / 15 | 0.35 / 2.5 / 1.6 | 1.5x |
| Cripto swing | 60 / 30 | 20 / 30 | 30 / 20 / 15 / 20 / 15 | 0.35 / 2.5 / 1.6 | 1.8x |
| Forex / ticks | 50 / 25 | 22 / 32 | 30 / 25 / 20 / 10 / 15 | 0.25 / 1.5 / 1.0 | 1.3x |
| Acciones e índices | 60 / 30 | 22 / 35 | 30 / 20 / 15 / 20 / 15 | 0.30 / 2.0 / 1.4 | 1.6x |

**Panel:** 29 rows × 4 columns (12 merged cells), 5 sections
(Volumen & Orderflow · Tendencia & Momentum · Zonas & SMC ·
Volatilidad & Riesgo · Decisión Cuántica), decision row, motive row and footer.
Three display modes, same 29 rows: `Completo` (desktop), `Mobile` (short labels
for 6.7" screens), `Predictor` (motive/footer lead with the forecast).

**Price predictor (linear projection, not magic):**

- `predMove = mom/momLen·H + score/100·ATR·0.8`, `predPrice = close + predMove`,
  range `pred ± ATR/2`, horizon `H = predHorizon` (default 5 bars).
- Directional probability `probUp = clamp(50 + score·0.35 + (control−50)·0.3, 5, 95)`.
- Trend strength `0–100 %` from EMAs + ADX + DI spread + EMA slope; direction
  `ALCISTA FUERTE / ALCISTA / LATERAL / BAJISTA / BAJISTA FUERTE`.
- RSI (14) confirmation, DI spread with rising/falling ADX arrow, VWAP, ATR
  regime, 1.5 ATR stops, London/NY killzone filter (out-of-session score ×
  penalty, default 0.5; STRONG signals require killzone + interest zone).

**Alerts:** 4 `alertcondition()` (strong buy/sell in zone, buy/sell in zone) +
exported `SIG FUERTE COMPRA/VENTA` flags used by the backtest.

## Backtest — scenario 12 (STRONG signals + predictor hit-rate)

Scenario 12 of `verify_runtime.mjs` runs two backtests over the same engine
output, both post-warmup (bar index ≥ 200; NaN/exact-zero forecasts excluded):

- **STRONG signals (H=10):** entry at the signal bar close, exit 10 bars later;
  reports count, win-rate (total + buy/sell split), mean MFE/MAE and mean net
  return.
- **Predictor directional hit-rate (HP=5 = `predHorizon` default):**
  `predMove` is not exported as a plot, but it is exactly recoverable as
  `Precio predicho − close` (the Pine defines `predPrice = close + predMove`).
  A forecast scores a hit when `sign(predMove) == sign(close[i+5] − close[i])`;
  reports evaluable count, hit-rate and the up/down split.
- **12a synthetic (600 deterministic bars, always runs)** and **12b real
  (Binance BTCUSDT 15m, N=500)**. The real leg is gated by a preflight probe:
  without network it prints `SKIP` and passes. If the live window carries no
  STRONG signals (market-dependent), that is reported, not failed — what is
  verified is the integrity of the computation.

Latest measured values (2026-11-20; the synthetic leg is deterministic, the
real leg depends on the live window and will vary run to run):

| Leg | STRONG (H=10) | Predictor hit-rate (HP=5) |
|---|---|---|
| Synthetic | n=31 (B=12 S=19), wr=70.97 %, MFE=2.56 %, MAE=0.72 %, net=1.71 % | n=395, hr=85.06 % (up=86.86 % n=236, dn=82.39 % n=159) |
| BTCUSDT 15m | n=5 (B=1 S=4), wr=80.00 %, MFE=1.49 %, MAE=0.49 %, net=0.45 % | n=295, hr=50.17 % (up=43.75 % n=128, dn=55.09 % n=167) |

## Verification suite

```bash
bash verify/verify_all.sh   # exit 0 = everything passes
```

Five steps (step 0 assembles the three large files from parts, gated by sha256):

1. **AST parse** with `pynescript` (real Pine grammar).
2. **Static v6 lint** — every call checked against **475 signatures** from the
   official reference (params, arity, enum values) plus v6 migration/type rules.
3. **Lint self-test** — 18 injected defects, all must be detected.
4. **Runtime with PineTS** — **13 scenarios**: 5 on 600 synthetic bars, TV object
   budget (<80 % of limits), all 5 profiles on synthetic + real data, 2 with
   real Binance data (BTCUSDT 15m), London/NY sessions, OB life-cycle, 3 panel
   modes, and a minimum backtest of STRONG signals (count, H=10 win-rate,
   MFE/MAE; synthetic deterministic + BTCUSDT 15m N=500, SKIP without network)
   plus the predictor directional hit-rate (sign of `predMove` vs the real
   H=5 return, synthetic + BTCUSDT 15m N=500, SKIP without network).
5. **Mission checklist** — **45 requirements** (panel, decision, footprint, OB
   touch/mitigation/invalidation/cleanup, zones, indicators, alerts, profiles,
   sessions, backtest flags, Mobile/Predictor, RSI, trend strength/direction,
   predictor with probability).

Pinned tools: `pynescript==0.3.0`, `pinets@0.13.1`. Last verified state
(2026-11-20): **runtime 215/215 assertions, features 45/45, exit 0.**
CI (`.github/workflows/verify.yml`) runs the same suite on every push/PR,
publishes the summary and the `verify-report` log artifact, and commits the
assembled files with `[skip ci]`.

**Not verified here:** TradingView's proprietary compiler (PineTS is an
independent runtime, not 100 % parity). Final step is pasting into Pine Editor.
Not tested on a Premium account. `request.footprint()` is intentionally not
used so the script loads on basic plans.

## Signal Trading Station (`station/`)

Modern, responsive web station (no build step) with three audience views over
the same engine output:

- `station/index.html` + `station/app.js` + `station/styles.css`.
- Run: `python3 -m http.server 3002` in the repo root, then open
  `http://localhost:3002/station/`.
- Symbol/timeframe selectors with live Binance klines and an offline synthetic
  fallback; candlestick canvas with EMAs and predicted price; score gauge;
  signal feed; Retail (plain-language plan), Quantum (factor breakdown,
  confluence, predictor math) and Institutional (orderflow proxy, killzones,
  ATR regime, stops, position-size calculator) tabs; mobile-first layout.
- The browser engine is a **simplified educational proxy** of the Pine logic
  (same score weights, predictor and probability formulas); the authoritative
  signal always comes from the TradingView indicator.

## Preview (`preview/index.html`)

Static visual reviewer of the Order Block life-cycle
(virgin → touched → mitigated → invalidated + auto-cleanup) with KPIs, a canvas
simulation and a mapping of where each state appears on the chart, panel and
data window.

## Risk notice

Educational and analytical software. Nothing here is financial advice, a
solicitation, or a guarantee of any outcome. Validate every signal on your own
data before risking capital.
