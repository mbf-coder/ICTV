/* Quantum Flow — Signal Trading Station engine (simplified educational proxy).
   Same score weights / predictor / probability formulas as the Pine indicator.
   Authoritative signal lives in quant-flow/QuantumFlowAnalyzer_v6.pine. */
"use strict";
const $ = (id) => document.getElementById(id);
const H = 5; // prediction horizon (bars), matches Pine predHorizon default
const W = { trend: 25, adx: 20, mom: 15, of: 25, st: 15 };
const TH = { strong: 55, soft: 25, adxMin: 18, adxStr: 28 };
const OFK = { d: 0.35, c: 2.5, w: 1.6 };

// ---------- data ----------
function seededBars(n, start, seed) {
  let price = start, s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const t0 = Date.UTC(2025, 0, 1), out = [];
  for (let i = 0; i < n; i++) {
    const o = price, drift = Math.sin(i / 37) * 0.6;
    const c = Math.max(1, o + drift + (rnd() - 0.5) * 1.6);
    const h = Math.max(o, c) + rnd() * 0.8, l = Math.min(o, c) - rnd() * 0.8;
    const v = 500 + rnd() * 2000 + Math.abs(c - o) * 900;
    out.push({ t: t0 + i * 3600000, o, h, l, c, v }); price = c;
  }
  return out;
}
async function loadKlines(symbol, interval) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=300`;
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error("http " + r.status);
    const j = await r.json();
    if (!Array.isArray(j) || j.length < 60) throw new Error("short");
    return { bars: j.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })), live: true };
  } catch (e) { return { bars: seededBars(300, 100, 42), live: false }; }
  finally { clearTimeout(to); }
}

// ---------- indicators ----------
const sma = (a, n, i) => { let s = 0; for (let k = i - n + 1; k <= i; k++) s += a[k]; return s / n; };
function emaArr(c, n) {
  const k = 2 / (n + 1), out = new Array(c.length).fill(NaN);
  let e = sma(c, n, n - 1); out[n - 1] = e;
  for (let i = n; i < c.length; i++) { e = c[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
function atrArr(b, n) {
  const tr = b.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)));
  const out = new Array(b.length).fill(NaN);
  let a = sma(tr, n, n - 1); out[n - 1] = a;
  for (let i = n; i < b.length; i++) { a = (a * (n - 1) + tr[i]) / n; out[i] = a; }
  return out;
}
function rsiArr(c, n) {
  const out = new Array(c.length).fill(NaN);
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; g += Math.max(d, 0); l += Math.max(-d, 0); }
  g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
function dmiArr(b, n) {
  const pD = [], mD = [], tr = [];
  for (let i = 1; i < b.length; i++) {
    const up = b[i].h - b[i - 1].h, dn = b[i - 1].l - b[i].l;
    pD.push(up > dn && up > 0 ? up : 0); mD.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)));
  }
  const sm = (a) => { const o = [a.slice(0, n).reduce((x, y) => x + y, 0)]; for (let i = n; i < a.length; i++) o.push((o[o.length - 1] * (n - 1) + a[i]) / n); return o; };
  const sP = sm(pD), sM = sm(mD), sT = sm(tr), diP = [], diM = [], dx = [];
  for (let i = 0; i < sT.length; i++) {
    const p = sT[i] ? (sP[i] / sT[i]) * 100 : 0, m = sT[i] ? (sM[i] / sT[i]) * 100 : 0;
    diP.push(p); diM.push(m); dx.push(p + m ? (Math.abs(p - m) / (p + m)) * 100 : 0);
  }
  const adx = new Array(b.length).fill(NaN), P = new Array(b.length).fill(NaN), M = new Array(b.length).fill(NaN);
  const off = (b.length - 1) - dx.length;
  dx.forEach((v, k) => { const i = off + 1 + k; P[i] = diP[k]; M[i] = diM[k]; });
  let a = dx.slice(0, n).reduce((x, y) => x + y, 0) / n;
  adx[off + n] = a;
  for (let i = n; i < dx.length; i++) { a = (a * (n - 1) + dx[i]) / n; adx[off + 1 + i] = a; }
  return { diP: P, diM: M, adx };
}
function proxyDelta(o, h, l, c, v) { // same OHLC proxy as the Pine fallback
  const body = c - o, up = h - Math.max(o, c), dn = Math.min(o, c) - l, r = Math.max(h - l, 1e-10);
  const buy = v * (Math.max(body, 0) + dn) / r, sell = v * (Math.max(-body, 0) + up) / r;
  return { buy, sell };
}

// ---------- QFA-proxy state per bar ----------
function engine(bars) {
  const c = bars.map((b) => b.c), v = bars.map((b) => b.v);
  const e1 = emaArr(c, 9), e2 = emaArr(c, 21), e3 = emaArr(c, 50), e4 = emaArr(c, 200);
  const atr = atrArr(bars, 14), rsi = rsiArr(c, 14), { diP, diM, adx } = dmiArr(bars, 14);
  const n = bars.length, S = [];
  let cvd = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i], d = proxyDelta(b.o, b.h, b.l, b.c, b.v);
    cvd += d.buy - d.sell;
    const tot = d.buy + d.sell, dp = tot ? ((d.buy - d.sell) / tot) * 100 : 0;
    // control window (last 50, proxy delta — approximation of intrabar sums)
    let bs = 0, ss = 0, ds = 0;
    for (let k = Math.max(0, i - 49); k <= i; k++) {
      const q = proxyDelta(bars[k].o, bars[k].h, bars[k].l, bars[k].c, bars[k].v);
      bs += q.buy; ss += q.sell; ds += q.buy - q.sell;
    }
    const ctrl = bs + ss ? (bs / (bs + ss)) * 100 : 50;
    const cvdSlope = bs + ss ? (ds / (bs + ss)) * 100 : 0;
    const mom = i >= 12 ? c[i] - c[i - 12] : 0;
    const roc = i >= 12 && c[i - 12] ? (mom / c[i - 12]) * 100 : 0;
    const t = isNaN(e4[i]) ? null : [
      (c[i] > e4[i] ? 25 : -25), (e1[i] > e2[i] ? 25 : -25),
      (e2[i] > e3[i] ? 25 : -25), (e3[i] > e4[i] ? 25 : -25)].reduce((a, x) => a + x, 0);
    const adxK = isNaN(adx[i]) ? 0 : Math.min(adx[i] / TH.adxStr, 1);
    const dd = isNaN(diP[i]) ? 0 : diP[i] - diM[i];
    const aS = ((diP[i] + diM[i]) > 0 ? (diP[i] - diM[i]) / (diP[i] + diM[i]) : 0) * 100 * adxK;
    const mS = Math.max(-100, Math.min(100, (atr[i] ? mom / atr[i] : 0) * 40));
    const oS = Math.max(-100, Math.min(100, dp * OFK.d + cvdSlope * OFK.c + (ctrl - 50) * OFK.w));
    let hi = -Infinity, lo = Infinity;
    for (let k = Math.max(0, i - 99); k <= i; k++) { hi = Math.max(hi, bars[k].h); lo = Math.min(lo, bars[k].l); }
    const rp = hi - lo > 0 ? ((c[i] - lo) / (hi - lo)) * 100 : 50;
    const sS = Math.max(-100, Math.min(100, (50 - rp) * 1.2));
    if (t !== null && !isNaN(adx[i])) {
      const score = Math.max(-100, Math.min(100, (t * W.trend + aS * W.adx + mS * W.mom + oS * W.of + sS * W.st) / (W.trend + W.adx + W.mom + W.of + W.st)));
      const sgn = score >= 0 ? 1 : -1;
      const conf = [t, aS, mS, oS, sS].filter((x) => (x * sgn) > 10).length / 5 * 100;
      const slope = atr[i] ? ((e2[i] - e2[i - 1]) / atr[i]) * 100 : 0;
      const stack = (c[i] > e4[i] ? 1 : 0) + (e1[i] > e2[i] ? 1 : 0) + (e2[i] > e3[i] ? 1 : 0) + (e3[i] > e4[i] ? 1 : 0);
      const power = Math.min(100, Math.abs(t) / 100 * 40 + adxK * 30 + Math.min(Math.abs(dd) / 20, 1) * 20 + Math.min(Math.abs(slope) / 2, 1) * 10);
      const trend = power >= 60 && adx[i] >= TH.adxMin ? (score >= 0 ? "STRONGLY BULLISH" : "STRONGLY BEARISH")
        : score >= TH.soft ? "BULLISH" : score <= -TH.soft ? "BEARISH" : "RANGE";
      const pm = mom / 12 * H + score / 100 * atr[i] * 0.8;
      S[i] = { t, aS, mS, oS, sS, score, conf, power, trend, rsi: rsi[i], spread: dd, dp, ctrl, cvd, mom, roc, atr: atr[i], adx: adx[i], diP: diP[i], diM: diM[i], e1: e1[i], e2: e2[i], e4: e4[i], rp,
        pm, pp: c[i] + pm, ph: c[i] + pm + atr[i] * 0.5, pl: c[i] + pm - atr[i] * 0.5,
        pr: c[i] ? (pm / c[i]) * 100 : 0, prob: Math.max(5, Math.min(95, 50 + score * 0.35 + (ctrl - 50) * 0.3)),
        pdir: pm > atr[i] * 0.2 ? "UP" : pm < -atr[i] * 0.2 ? "DOWN" : "FLAT" };
    } else S[i] = null;
  }
  return S;
}
function decisionAt(s, i, bars, S) {
  if (!S[i]) return "LOADING";
  const z = zoneAt(bars, S, i);
  if (S[i].score >= TH.strong && z.buy) return "STRONG BUY";
  if (S[i].score <= -TH.strong && z.sell) return "STRONG SELL";
  if (S[i].score >= TH.soft) return "BUY";
  if (S[i].score <= -TH.soft) return "SELL";
  return Math.abs(S[i].score) < 15 ? "WAIT · FLAT" : "WAIT";
}
function zoneAt(bars, S, i) { // simplified interest-zone proxy
  const s = S[i], b = bars[i];
  const disc = s.rp <= 40, prem = s.rp >= 60;
  const nearE = s.atr ? Math.abs(b.c - s.e2) <= s.atr * 0.35 : false;
  return { buy: disc || nearE, sell: prem || nearE, label: disc ? "DISCOUNT " + s.rp.toFixed(0) + "%" : prem ? "PREMIUM " + s.rp.toFixed(0) + "%" : "MID-RANGE " + s.rp.toFixed(0) + "%" };
}
function killzone(now) {
  const m = now.getUTCHours() * 60 + now.getUTCMinutes();
  const lon = m >= 420 && m < 660, ny = m >= 750 && m < 960;
  return { lon, ny, in: lon || ny, label: lon && ny ? "LONDON + NEW YORK" : lon ? "LONDON" : ny ? "NEW YORK" : "OUT OF SESSION ×0.5" };
}

// ---------- render ----------
let BARS = [], ST = [];
function fmt(n, d = 2) { return isNaN(n) || !isFinite(n) ? "—" : n.toFixed(d); }
function cls(x) { return x > 0 ? "bull" : x < 0 ? "bear" : "mut"; }
async function refresh() {
  $("conn").textContent = "loading…"; $("conn").className = "badge";
  const { bars, live } = await loadKlines($("symbol").value, $("interval").value);
  BARS = bars; ST = engine(bars);
  $("conn").textContent = live ? "● BINANCE LIVE" : "● OFFLINE SYNTHETIC";
  $("conn").className = "badge " + (live ? "live" : "off");
  render();
}
function render() {
  const i = BARS.length - 1, s = ST[i], b = BARS[i];
  if (!s) return;
  const dec = decisionAt(s, i, BARS, ST), z = zoneAt(BARS, ST, i), kz = killzone(new Date());
  const chg = (b.c - b.o) / b.o * 100;
  $("kPrice").textContent = b.c.toLocaleString("en-US", { maximumFractionDigits: 2 });
  $("kChg").textContent = (chg >= 0 ? "+" : "") + chg.toFixed(2) + "% candle";
  $("kChg").className = "s " + cls(chg);
  $("kDec").textContent = dec; $("kDec").className = "v " + (dec.includes("BUY") ? "bull" : dec.includes("SELL") ? "bear" : "mut");
  $("kScore").textContent = "score " + s.score.toFixed(0) + " / 100 · conf " + s.conf.toFixed(0) + "%";
  $("kPred").textContent = s.pp.toLocaleString("en-US", { maximumFractionDigits: 2 });
  $("kPred").className = "v " + (s.pdir === "UP" ? "bull" : s.pdir === "DOWN" ? "bear" : "mut");
  $("kProb").textContent = s.pdir + " " + (s.pr >= 0 ? "+" : "") + s.pr.toFixed(2) + "% · P" + s.prob.toFixed(0) + "%";
  $("kTrend").textContent = s.trend; $("kForce").textContent = "strength " + s.power.toFixed(0) + "% · RSI " + s.rsi.toFixed(0);
  const pill = $("pill"); pill.textContent = dec;
  pill.className = "pill " + (dec.includes("BUY") ? "buy" : dec.includes("SELL") ? "sell" : "wait");
  $("sess").textContent = (kz.in ? "IN SESSION · " : "") + kz.label;
  $("gmark").style.left = ((s.score + 100) / 200 * 100).toFixed(1) + "%";
  const F = [["EMA trend", s.t, W.trend], ["ADX", s.aS, W.adx], ["Momentum", s.mS, W.mom], ["Orderflow", s.oS, W.of], ["Structure/range", s.sS, W.st]];
  $("factors").innerHTML = F.map(([n, x, w]) => {
    const p = Math.abs(x) / 2, left = x >= 0 ? 50 : 50 - p;
    return `<div class="factor"><div class="t"><span>${n} <span class="mut">×${w}</span></span><span class="${cls(x)}">${x >= 0 ? "+" : ""}${x.toFixed(1)}</span></div><div class="bar"><i style="left:${left}%;width:${p}%;background:${x >= 0 ? "var(--bull)" : "var(--bear)"}"></i></div></div>`;
  }).join("");
  // retail plan
  const dir = dec.includes("BUY") ? "buyers" : dec.includes("SELL") ? "sellers" : "neither side";
  $("plan").innerHTML = `<b>Bottom line:</b> ${dec} — ${dir} are in control.<br>` +
    `Price is <b>${z.label}</b>; session: <b>${kz.label}</b>.<br>` +
    `Forecast ${H} bars: <b class="${s.pdir === "UP" ? "bull" : s.pdir === "DOWN" ? "bear" : "mut"}">${s.pdir}</b> to ~${s.pp.toLocaleString("en-US", { maximumFractionDigits: 2 })} ` +
    `(range ${s.pl.toLocaleString("en-US", { maximumFractionDigits: 2 })} – ${s.ph.toLocaleString("en-US", { maximumFractionDigits: 2 })}).<br>` +
    `<span class="mut">Simple rule: only consider entries with the decision, never against a STRONG signal, and always with a stop. Nothing here is financial advice.</span>`;
  // feed: last 120 bars events
  const ev = [];
  for (let k = Math.max(1, BARS.length - 120); k < BARS.length; k++) {
    if (!ST[k] || !ST[k - 1]) continue;
    const d0 = decisionAt(ST[k - 1], k - 1, BARS, ST), d1 = decisionAt(ST[k], k, BARS, ST);
    if (d1 !== d0 && (d1.includes("STRONG") || d1 === "BUY" || d1 === "SELL"))
      ev.push({ k, d: d1, p: BARS[k].c, t: new Date(BARS[k].t).toISOString().slice(5, 16).replace("T", " ") });
  }
  $("feed").innerHTML = ev.length ? ev.slice(-14).reverse().map((e) =>
    `<div><span class="${e.d.includes("BUY") ? "bull" : "bear"}">◆ ${e.d}</span><span>${e.p.toLocaleString("en-US", { maximumFractionDigits: 2 })} · ${e.t}</span></div>`).join("")
    : `<div><span class="mut">No fresh BUY/SELL flips in the window — patience is also a position.</span><span></span></div>`;
  // quantum
  $("qbreak").innerHTML = F.map(([n, x, w]) =>
    `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0"><span>${n} × ${w}</span><span class="${cls(x)}">${x >= 0 ? "+" : ""}${x.toFixed(2)} → ${(x * w / 100).toFixed(2)}</span></div>`).join("") +
    `<div style="display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:6px;font-size:13px"><span>Score</span><b>${s.score.toFixed(2)}</b></div>`;
  $("qpred").innerHTML = `mom = ${s.mom.toFixed(4)} / 12 × ${H} = ${(s.mom / 12 * H).toFixed(4)}<br>` +
    `score term = ${s.score.toFixed(1)}/100 × ATR ${s.atr.toFixed(4)} × 0.8 = ${(s.score / 100 * s.atr * 0.8).toFixed(4)}<br>` +
    `predMove = ${(s.pm).toFixed(4)} → <b>${s.pp.toLocaleString("en-US", { maximumFractionDigits: 2 })}</b> (${(s.pr >= 0 ? "+" : "") + s.pr.toFixed(2)}%)<br>` +
    `range = ±ATR/2 → ${s.pl.toLocaleString("en-US", { maximumFractionDigits: 2 })} – ${s.ph.toLocaleString("en-US", { maximumFractionDigits: 2 })}<br>` +
    `P(up) = 50 + ${s.score.toFixed(1)}×0.35 + (${s.ctrl.toFixed(1)}−50)×0.3 = <b>${s.prob.toFixed(1)}%</b>`;
  // institutional
  const atrs = BARS.map((x, j) => ST[j] ? ST[j].atr : NaN).filter((x) => !isNaN(x)).slice(-50);
  const reg = atrs.length >= 50 ? (s.atr > sma(atrs, 50, atrs.length - 1) * 1.2 ? "EXPANSION" : "steady") : "—";
  $("instFlow").innerHTML = `<table><tr><th>Metric</th><th>Value</th></tr>` +
    `<tr><td>Buyers control</td><td>${s.ctrl.toFixed(1)} % ${s.ctrl >= 50 ? "BUYERS" : "SELLERS"}</td></tr>` +
    `<tr><td>Candle delta % (proxy)</td><td>${(s.dp >= 0 ? "+" : "") + s.dp.toFixed(1)} %</td></tr>` +
    `<tr><td>ADX / +DI / −DI</td><td>${s.adx.toFixed(1)} / ${s.diP.toFixed(1)} / ${s.diM.toFixed(1)}</td></tr>` +
    `<tr><td>ATR / regime</td><td>${s.atr.toFixed(4)} · ${reg}</td></tr>` +
    `<tr><td>Stops (1.5 ATR)</td><td>${(b.c - s.atr * 1.5).toLocaleString("en-US", { maximumFractionDigits: 2 })} / ${(b.c + s.atr * 1.5).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td></tr>` +
    `<tr><td>Killzone (UTC)</td><td>${kz.label}</td></tr></table>`;
  calc();
  drawChart();
}
function calc() {
  const i = BARS.length - 1; if (!ST[i]) return;
  const eq = +$("eq").value || 0, r = (+$("risk").value || 0) / 100, k = +$("stopK").value;
  const stop = ST[i].atr * k, riskUsd = eq * r, units = stop ? riskUsd / stop : 0;
  $("posOut").innerHTML = `Stop distance ${stop.toLocaleString("en-US", { maximumFractionDigits: 2 })} (${k}×ATR) · ` +
    `risking $${riskUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} → size ≈ <b>${units.toLocaleString("en-US", { maximumFractionDigits: 4 })} units</b> ` +
    `(≈ $${(units * BARS[i].c).toLocaleString("en-US", { maximumFractionDigits: 0 })} notional).`;
}
function drawChart() {
  const cv = $("chart"), ctx = cv.getContext("2d"), dpr = window.devicePixelRatio || 1;
  const Wpx = cv.clientWidth || 800, Hpx = 320;
  cv.width = Wpx * dpr; cv.height = Hpx * dpr; ctx.scale(dpr, dpr);
  const N = 120, i0 = BARS.length - N, sl = BARS.slice(i0), ss = ST.slice(i0);
  let hi = -Infinity, lo = Infinity;
  sl.forEach((b, k) => { if (ss[k]) { hi = Math.max(hi, b.h, ss[k].ph); lo = Math.min(lo, b.l, ss[k].pl); } });
  const pad = (hi - lo) * 0.08; hi += pad; lo -= pad;
  const X = (k) => 8 + (k / (N - 1)) * (Wpx - 16), Y = (p) => 8 + (1 - (p - lo) / (hi - lo)) * (Hpx - 16);
  ctx.clearRect(0, 0, Wpx, Hpx);
  const cw = Math.max(2, (Wpx - 16) / N * 0.6);
  sl.forEach((b, k) => {
    const up = b.c >= b.o;
    ctx.strokeStyle = up ? "#00c853" : "#ff4d5e"; ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.moveTo(X(k), Y(b.h)); ctx.lineTo(X(k), Y(b.l)); ctx.stroke();
    ctx.fillRect(X(k) - cw / 2, Y(Math.max(b.o, b.c)), cw, Math.max(1, Math.abs(Y(b.o) - Y(b.c))));
  });
  const line = (f, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.beginPath();
    let started = false;
    ss.forEach((s, k) => { if (!s) return; const y = Y(f(s)); if (!started) { ctx.moveTo(X(k), y); started = true; } else ctx.lineTo(X(k), y); });
    ctx.stroke();
  };
  line((s) => s.e2, "#ffb300"); line((s) => s.e4, "#78909c");
  const last = ss[N - 1];
  if (last) {
    ctx.strokeStyle = "#4d7cff"; ctx.setLineDash([5, 4]); ctx.beginPath();
    ctx.moveTo(X(N - 1), Y(last.pp));
    ctx.lineTo(Math.min(Wpx - 8, X(N - 1) + 40), Y(last.pp)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#fff"; ctx.font = "11px ui-monospace,monospace";
    ctx.fillText("pred " + last.pp.toLocaleString("en-US", { maximumFractionDigits: 2 }), Math.max(8, X(N - 1) - 120), Y(last.pp) - 6);
  }
  $("chartNote").textContent = `Last ${N} candles · yellow EMA21 · grey EMA200 · dashed blue = +${H}-bar projection. ` +
    (document.querySelector("#conn").textContent.includes("LIVE") ? "Live Binance klines." : "Offline synthetic fallback (Binance unreachable).");
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.remove("on"));
  t.classList.add("on");
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("on"));
  $("view-" + t.dataset.view).classList.add("on");
}));
$("refresh").addEventListener("click", refresh);
$("symbol").addEventListener("change", refresh);
$("interval").addEventListener("change", refresh);
$("calc").addEventListener("click", calc);
window.addEventListener("resize", () => { if (BARS.length) drawChart(); });
refresh();
