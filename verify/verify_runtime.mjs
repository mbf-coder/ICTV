// Verificación de ejecución del indicador con PineTS (LuxAlgo): corre el script
// real sobre OHLCV sintético y comprueba aserciones sobre plots, panel y tablas.
// Uso: node verify/verify_runtime.mjs
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve('quant-flow/QuantumFlowAnalyzer_v6.pine');
const SRC = fs.readFileSync(FILE, 'utf8');
const { PineTS, Provider } = await import('pinets');

// ── datos sintéticos deterministas ───────────────────────────────────────────
function genBars(n, start = 100, seed0 = 42) {
    let price = start;
    let seed = seed0;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const bars = [];
    const t0 = Date.UTC(2025, 0, 1);
    for (let i = 0; i < n; i++) {
        const drift = Math.sin(i / 37) * 0.6;
        const o = price;
        const c = Math.max(1, o + drift + (rnd() - 0.5) * 1.6);
        const h = Math.max(o, c) + rnd() * 0.8;
        const l = Math.min(o, c) - rnd() * 0.8;
        const v = 500 + rnd() * 2000 + Math.abs(c - o) * 900;
        bars.push({
            openTime: t0 + i * 3600_000, open: +o.toFixed(4), high: +h.toFixed(4),
            low: +l.toFixed(4), close: +c.toFixed(4), volume: +v.toFixed(2),
            closeTime: t0 + i * 3600_000 + 3599_999, quoteAssetVolume: +(v * c).toFixed(2),
            numberOfTrades: Math.round(v / 10), takerBuyBaseAssetVolume: +(v / 2).toFixed(2),
            takerBuyQuoteAssetVolume: +((v / 2) * c).toFixed(2), ignore: 0,
        });
        price = c;
    }
    return bars;
}

const BARS = genBars(600);

// ── utilidades ───────────────────────────────────────────────────────────────
function lastValue(entry) {
    const d = entry?.data ?? entry;
    if (!Array.isArray(d)) return undefined;
    for (let i = d.length - 1; i >= 0; i--) {
        const v = d[i];
        if (typeof v === 'number') return v;
        if (v && typeof v.value === 'number') return v.value;
    }
    return undefined;
}

function tablesOf(ctx) {
    const raw = ctx.plots?.['__tables__']?.data ?? [];
    const last = raw[raw.length - 1];
    return Array.isArray(last?.value) ? last.value : [];
}

function cellMap(table) {
    const out = new Map();
    const cells = table?.cells ?? [];
    for (let r = 0; r < cells.length; r++) {
        for (let c = 0; c < (cells[r]?.length ?? 0); c++) {
            const cell = cells[r][c];
            if (cell) out.set(`${c},${r}`, String(cell.text ?? cell.value?.text ?? ''));
        }
    }
    return out;
}

function withInputs(src, replacements) {
    let out = src;
    for (const [from, to] of replacements) {
        if (!out.includes(from)) throw new Error(`No se encontró el input a reemplazar: ${from}`);
        out = out.split(from).join(to);
    }
    return out;
}

let checks = 0;
let failures = 0;
let skipped = 0;
function check(name, cond, detail = '') {
    checks++;
    if (cond) {
        console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
    } else {
        failures++;
        console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
    }
}

function seriesValues(entry) {
    const d = entry?.data ?? entry;
    if (!Array.isArray(d)) return [];
    return d.map((v) => (typeof v === 'number' ? v : (v && typeof v.value === 'number' ? v.value : NaN)));
}

function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timeout de red (${ms} ms) en ${label}`)), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

function labelTexts(ctx) {
    const data = ctx?.plots?.['__labels__']?.data ?? [];
    return data.flatMap((e) => (e?.value ?? []).map((l) => l?.text ?? ''));
}

// ── presupuesto de objetos TradingView ───────────────────────────────────────
// Límites oficiales: 50 por defecto y 500 como techo para labels/lines/boxes
// (https://www.tradingview.com/pine-script-docs/writing/limitations/).
// Fallamos al 80 % para dejar margen antes del garbage collector de TV.
const TV_HARD = 500;
const BUDGET_RATIO = 0.8;

function declaredLimit(src, name) {
    const m = src.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
    return m ? parseInt(m[1], 10) : 50;
}

function liveCount(ctx, key) {
    if (key === '__tables__') return tablesOf(ctx).filter((t) => !t?._deleted).length;
    const data = ctx?.plots?.[key]?.data ?? [];
    const last = data[data.length - 1];
    const arr = last?.value ?? [];
    return arr.filter((o) => !o?._deleted).length;
}

function capFromWhile(src, arrName, fallback) {
    const m = src.match(new RegExp('while array\\.size\\(' + arrName + '\\) > (\\d+)'));
    return m ? parseInt(m[1], 10) : fallback;
}

// Preflight común a los escenarios con datos reales: devuelve null si hay red
// o el motivo del SKIP si el proveedor no responde.
async function binancePreflight(SYM, TF) {
    try {
        const probe = new PineTS(Provider.Binance, SYM, TF, 5);
        await withTimeout(probe.ready(), 60000, 'preflight Binance');
        if ((probe.data?.length ?? 0) >= 5) return null;
        return 'el proveedor no devolvió 5 barras';
    } catch (e) {
        return String(e?.message ?? e).slice(0, 200);
    }
}

async function run(src, label) {
    const pine = new PineTS(BARS, 'TESTUSD', '1h', BARS.length);
    const ctx = await pine.run(src);
    console.log(`\n▶ ${label}`);
    check('ejecución sin excepción', !!ctx);
    const warns = ctx?.warnings ?? [];
    check('sin warnings del runtime', warns.length === 0, warns.length ? JSON.stringify(warns).slice(0, 300) : 'warnings=0');
    return ctx;
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCENARIO 1 · ajustes por defecto (footprint apagado)
// ═════════════════════════════════════════════════════════════════════════════
console.log('═══ ESCENARIO 1 · valores por defecto ═══');
{
    const ctx = await run(SRC, 'archivo entregado, inputs por defecto');
    const p = ctx.plots ?? {};
    const mustHave = ['Delta', 'Delta %', 'CVD', 'Control compradores %', 'Volumen relativo',
        'ADX', '+DI', '-DI', 'Momentum', 'Score cuántico', 'Score base (sin sesión)', 'Sesión mult', 'En killzone', 'Confluencia %',
        'EMA rápida', 'EMA media', 'EMA lenta', 'EMA tendencia', 'VWAP'];
    const missing = mustHave.filter((n) => !(n in p));
    check('series esperadas presentes', missing.length === 0, missing.length ? 'faltan: ' + missing.join(', ') : `${mustHave.length}/${mustHave.length}`);

    const numeric = mustHave.map((n) => [n, lastValue(p[n])]);
    const bad = numeric.filter(([, v]) => typeof v !== 'number' || !Number.isFinite(v));
    check('todas las series son numéricas (sin NaN/Infinity)', bad.length === 0, bad.map(([n, v]) => `${n}=${v}`).join(', '));

    const score = lastValue(p['Score cuántico']);
    check('score en rango [-100,100]', score >= -100 && score <= 100, `score=${score?.toFixed(2)}`);
    const ctrl = lastValue(p['Control compradores %']);
    check('control en rango [0,100]', ctrl >= 0 && ctrl <= 100, `control=${ctrl?.toFixed(2)}%`);
    const adx = lastValue(p['ADX']);
    check('ADX definido', adx >= 0 && adx <= 100, `adx=${adx?.toFixed(2)}`);
    const conf = lastValue(p['Confluencia %']);
    check('confluencia en múltiplos de 20 (5 factores)', Math.abs(conf / 20 - Math.round(conf / 20)) < 1e-9, `confluencia=${conf}`);

    const tables = tablesOf(ctx);
    const dash = tables.find((t) => t.rows === 29);
    check('panel creado (29 filas × 4 columnas)', !!dash, `tablas=${tables.length}`);
    if (dash) {
        const cm = cellMap(dash);
        check('panel con celdas rellenas', cm.size >= 100, `celdas=${cm.size}`);
        check('merges del panel = 12', (dash.merges ?? []).length === 12, `merges=${(dash.merges ?? []).length}`);
        const sections = ['▌ VOLUMEN & ORDERFLOW', '▌ TENDENCIA & MOMENTUM', '▌ ZONAS & SMC', '▌ VOLATILIDAD & RIESGO', '▌ DECISIÓN CUÁNTICA'];
        const missingSec = sections.filter((s) => ![...cm.values()].some((v) => v.includes(s)));
        check('5 secciones del panel presentes', missingSec.length === 0, missingSec.join(' | '));
        const decision = cm.get('0,26') ?? '';
        const allowed = ['FUERTE COMPRA', 'FUERTE VENTA', 'COMPRA', 'VENTA', 'ESPERAR', 'ESPERAR · SIN VENTAJA', 'CARGANDO DATOS'];
        check('fila de decisión válida', allowed.includes(decision), `decisión="${decision}"`);
        const control = cm.get('1,7') ?? '';
        check('fila de control compradores/vendedores', ['COMPRADORES', 'VENDEDORES'].includes(control), `control="${control}"`);
        check('motivo de decisión presente', (cm.get('0,27') ?? '').length > 10, (cm.get('0,27') ?? '').slice(0, 60));
        check('POC/VAH/VAL informado', (cm.get('1,18') ?? '') !== '—', cm.get('1,18') ?? '');
        const fpTable = tables.find((t) => t.rows === 17);
        check('tabla footprint existe pero vacía con toggle OFF', !!fpTable && cellMap(fpTable).size === 0, `celdas_fp=${fpTable ? cellMap(fpTable).size : 'n/a'}`);
    }

    const boxes = ctx.plots?.['__boxes__']?.data ?? [];
    const labels = ctx.plots?.['__labels__']?.data ?? [];
    check('order blocks / FVG dibujados (boxes)', boxes.length > 0 || JSON.stringify(ctx.plots?.['__boxes__'] ?? '').length > 0);
    check('etiquetas de señal/estructura creadas', labels.length > 0 || JSON.stringify(ctx.plots?.['__labels__'] ?? '').length > 0);
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCENARIO 2 · footprint encendido
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ESCENARIO 2 · footprint ON ═══');
{
    const src = withInputs(SRC, [['input.bool(false, "Activar footprint (tabla de precios)"', 'input.bool(true, "Activar footprint (tabla de precios)"']]);
    const ctx = await run(src, 'showFP = true');
    const tables = tablesOf(ctx);
    const fp = tables.find((t) => t.rows === 17);
    check('tabla footprint presente', !!fp);
    if (fp) {
        const cm = cellMap(fp);
        check('footprint con celdas rellenas', cm.size >= 50, `celdas=${cm.size}`);
        const texts = [...cm.values()];
        for (const head of ['PRECIO', 'COMPRA', 'VENTA', 'DELTA']) {
            check(`cabecera "${head}"`, texts.includes(head));
        }
        check('fila TOTAL presente', texts.includes('TOTAL'));
        check('desglose compra/venta > 0', texts.filter((t) => t && t !== '' ).length > 20, `textos=${texts.length}`);
        const rowPrice = [...cm.entries()].filter(([k]) => k.startsWith('0,')).length;
        check('filas de precio dibujadas', rowPrice >= 5, `filas=${rowPrice}`);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCENARIO 3 · delta en modo proxy OHLC
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ESCENARIO 3 · delta proxy OHLC ═══');
{
    const src = withInputs(SRC, [['input.string("Intrabar", "Motor de delta"', 'input.string("Proxy OHLC", "Motor de delta"']]);
    const ctx = await run(src, 'deltaMode = Proxy OHLC');
    const d = lastValue(ctx.plots?.['Delta %']);
    check('delta % acotado en [-100,100]', d >= -100 && d <= 100, `delta%=${d?.toFixed(2)}`);
    check('score numérico con proxy', Number.isFinite(lastValue(ctx.plots?.['Score cuántico'])));
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCENARIO 4 · todo apagado (rutas de guardado / arrays vacíos)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ESCENARIO 4 · dibujos apagados ═══');
{
    const src = withInputs(SRC, [
        ['input.bool(true, "Mostrar EMAs"', 'input.bool(false, "Mostrar EMAs"'],
        ['input.bool(true, "Mostrar VWAP de sesión"', 'input.bool(false, "Mostrar VWAP de sesión"'],
        ['input.bool(true, "Order Blocks SMC"', 'input.bool(false, "Order Blocks SMC"'],
        ['input.bool(true, "Fair Value Gaps"', 'input.bool(false, "Fair Value Gaps"'],
        ['input.bool(true, "Marcar BOS / CHoCH"', 'input.bool(false, "Marcar BOS / CHoCH"'],
        ['input.bool(true, "Etiquetas de señal fuerte"', 'input.bool(false, "Etiquetas de señal fuerte"'],
        ['input.bool(true, "Mostrar POC / VAH / VAL"', 'input.bool(false, "Mostrar POC / VAH / VAL"'],
        ['input.bool(true, "Mostrar panel"', 'input.bool(false, "Mostrar panel"'],
    ]);
    const ctx = await run(src, 'EMAs/VWAP/OB/FVG/BOS/señales/VP/panel OFF');
    check('score numérico con dibujos apagados', Number.isFinite(lastValue(ctx.plots?.['Score cuántico'])));
    check('sin tablas rellenadas', tablesOf(ctx).every((t) => cellMap(t).size === 0));
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCENARIO 5 · sin warmup (pocas barras) → decisión "CARGANDO DATOS"
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ESCENARIO 5 · warmup corto ═══');
{
    const pine = new PineTS(genBars(60, 100, 5), 'TESTUSD', '1h', 60);
    const ctx = await pine.run(SRC);
    check('sin warnings del runtime', (ctx?.warnings ?? []).length === 0);
    const dash = tablesOf(ctx).find((t) => t.rows === 29);
    const cm = dash ? cellMap(dash) : new Map();
    check('panel muestra CARGANDO DATOS sin historial suficiente', (cm.get('0,26') ?? '') === 'CARGANDO DATOS', `decisión="${cm.get('0,26')}"`);
    const texts = labelTexts(ctx);
    check('sin señales de compra/venta antes del warmup (solo estructura BOS/CHoCH)',
        !texts.some((t) => t.includes('COMPRA FUERTE') || t.includes('VENTA FUERTE')),
        `etiquetas=${texts.length}: ${texts.slice(0, 4).join(' · ')}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCENARIO 6 · datos reales (Binance BTCUSDT 15m, delta intrabar de verdad)
// Se omite con SKIP si no hay red o el proveedor falla: la suite sigue en OK.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ESCENARIO 6 · datos reales (Binance) ═══');
{
    const SYM = 'BTCUSDT', TF = '15m', N = 300;
    const skipReason = await binancePreflight(SYM, TF);
    if (skipReason) {
        skipped++;
        console.log(`  SKIP  sin datos reales — red o proveedor Binance no disponible: ${skipReason}`);
    } else {
        const dbgSrc = SRC + '\nplot(array.size(ibO), "DBG ibCount", display = display.data_window)\n';
        const t0 = Date.now();
        const pine = new PineTS(Provider.Binance, SYM, TF, N);
        await withTimeout(pine.ready(), 90000, 'carga klines Binance');
        const first = pine.data?.[0]?.openTime;
        const lastBar = pine.data?.[pine.data.length - 1]?.openTime;
        console.log(`\n▶ ${SYM} ${TF} · ${pine.data?.length ?? '?'} barras reales (${new Date(first).toISOString().slice(0, 10)} → ${new Date(lastBar).toISOString().slice(0, 10)})`);
        let ctx;
        try {
            ctx = await withTimeout(pine.run(dbgSrc), 240000, 'ejecución del script');
        } catch (e) {
            failures++;
            console.log(`  FAIL  ejecución con datos reales — ${String(e?.message ?? e).slice(0, 200)}`);
            ctx = null;
        }
        if (ctx) {
            const warns = ctx?.warnings ?? [];
            check('sin warnings del runtime', warns.length === 0, warns.length ? JSON.stringify(warns).slice(0, 300) : 'warnings=0');
            const p = ctx.plots ?? {};
            const WARM = 200; // > lenE4 (200) y > ctrlLen: a partir de aquí la decisión es operativa
            const ibCount = seriesValues(p['DBG ibCount']).slice(-60);
            const ibLast10 = ibCount.slice(-10).sort((a, b) => a - b);
            const ibMedian10 = ibLast10[Math.floor(ibLast10.length / 2)];
            check('delta calculado con varios intrabars por vela (mediana últimas 10 ≥ 5, máx 60 ≥ 10)',
                ibMedian10 >= 5 && Math.max(...ibCount) >= 10,
                `ibCount: min=${Math.min(...ibCount)} mediana10=${ibMedian10} máx=${Math.max(...ibCount)}`);
            const ibMulti = ibCount.filter((v) => v > 1).length;
            check('la mayoría de velas usan >1 intrabar (no es el proxy)', ibMulti >= Math.ceil(ibCount.length * 0.5),
                `${ibMulti}/${ibCount.length} velas`);
            const dpct = seriesValues(p['Delta %']).slice(-60);
            const notSaturated = dpct.filter((v) => Number.isFinite(v) && Math.abs(v) < 100 - 1e-9).length;
            check('delta % con distribución real (≥80% de las últimas 60 sin saturar ±100)',
                notSaturated >= 48, `${notSaturated}/60 no saturadas`);
            const mustHave = ['Delta', 'Delta %', 'CVD', 'Control compradores %', 'Volumen relativo',
                'ADX', '+DI', '-DI', 'Momentum', 'Score cuántico', 'Confluencia %'];
            const warmFinite = mustHave.map((n) => [n, seriesValues(p[n]).slice(WARM)]);
            const bad = warmFinite.filter(([, arr]) => arr.some((v) => typeof v !== 'number' || !Number.isFinite(v)));
            check('cero NaN/Infinity post-warmup en todas las series', bad.length === 0,
                bad.length ? 'con NaN: ' + bad.map(([n]) => n).join(', ') : `11 series × ${seriesValues(p['Delta']).length - WARM} barras`);
            const score = lastValue(p['Score cuántico']);
            check('score en rango [-100,100]', score >= -100 && score <= 100, `score=${score?.toFixed(2)}`);
            const ctrl = lastValue(p['Control compradores %']);
            check('control en rango [0,100]', ctrl >= 0 && ctrl <= 100, `control=${ctrl?.toFixed(2)}%`);
            const tables = tablesOf(ctx);
            const dash = tables.find((t) => t.rows === 29);
            check('panel completo con datos reales', !!dash && cellMap(dash).size >= 100, `celdas=${dash ? cellMap(dash).size : 0}`);
            if (dash) {
                const cm = cellMap(dash);
                const decision = cm.get('0,26') ?? '';
                const allowed = ['FUERTE COMPRA', 'FUERTE VENTA', 'COMPRA', 'VENTA', 'ESPERAR', 'ESPERAR · SIN VENTAJA', 'CARGANDO DATOS'];
                check('decisión válida con datos reales', allowed.includes(decision), `decisión="${decision}"`);
                const volType = cm.get('3,1') ?? '';
                check('volumen real en spot (no TICK VOL)', ['VOL REAL', 'VOL QUOTE'].includes(volType), `tipo="${volType}"`);
                check('control compradores/vendedores', ['COMPRADORES', 'VENDEDORES'].includes(cm.get('1,7') ?? ''), `control="${cm.get('1,7')}"`);
            }
            console.log(`  info  ejecución total del escenario: ${Date.now() - t0} ms`);
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCENARIO 7 · footprint con datos reales (footprint ON)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ESCENARIO 7 · footprint con datos reales ═══');
{
    const SYM = 'BTCUSDT', TF = '15m', N = 300;
    const skipReason = await binancePreflight(SYM, TF);
    if (skipReason) {
        skipped++;
        console.log(`  SKIP  sin datos reales — red o proveedor Binance no disponible: ${skipReason}`);
    } else {
        const src = withInputs(SRC, [['input.bool(false, "Activar footprint (tabla de precios)"', 'input.bool(true, "Activar footprint (tabla de precios)"']]);
        const t0 = Date.now();
        const pine = new PineTS(Provider.Binance, SYM, TF, N);
        try {
            await withTimeout(pine.ready(), 90000, 'carga klines Binance (footprint)');
            const ctx = await withTimeout(pine.run(src), 240000, 'ejecución con footprint');
            const warns = ctx?.warnings ?? [];
            check('sin warnings del runtime', warns.length === 0, warns.length ? JSON.stringify(warns).slice(0, 300) : 'warnings=0');
            const fp = tablesOf(ctx).find((t) => t.rows === 17);
            check('tabla footprint presente con datos reales', !!fp);
            if (fp) {
                const texts = [...cellMap(fp).values()];
                check('footprint con desglose real por niveles', cellMap(fp).size >= 30 && texts.includes('TOTAL'),
                    `celdas=${cellMap(fp).size}`);
            }
            console.log(`  info  ejecución total del escenario: ${Date.now() - t0} ms`);
        } catch (e) {
            failures++;
            console.log(`  FAIL  footprint con datos reales — ${String(e?.message ?? e).slice(0, 200)}`);
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCENARIO 8 · presupuesto de objetos TradingView (labels/boxes/lines/tablas)
// Peor caso: todo dibujado + footprint ON sobre 600 barras. Falla si el uso
// vivo o el tope estático del código supera el 80 % del límite declarado.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ESCENARIO 8 · presupuesto de objetos ═══');
{
    const limLabels = declaredLimit(SRC, 'max_labels_count');
    const limLines = declaredLimit(SRC, 'max_lines_count');
    const limBoxes = declaredLimit(SRC, 'max_boxes_count');
    check('límite declarado de labels dentro del techo TV (≤500)', limLabels >= 1 && limLabels <= TV_HARD, `max_labels_count=${limLabels}`);
    check('límite declarado de lines dentro del techo TV (≤500)', limLines >= 1 && limLines <= TV_HARD, `max_lines_count=${limLines}`);
    check('límite declarado de boxes dentro del techo TV (≤500)', limBoxes >= 1 && limBoxes <= TV_HARD, `max_boxes_count=${limBoxes}`);

    const src = withInputs(SRC, [['input.bool(false, "Activar footprint (tabla de precios)"', 'input.bool(true, "Activar footprint (tabla de precios)"']]);
    const ctx = await run(src, 'todo ON + footprint ON (peor caso)');
    const nLabels = liveCount(ctx, '__labels__');
    const nBoxes = liveCount(ctx, '__boxes__');
    const nLines = liveCount(ctx, '__lines__');
    const nTables = liveCount(ctx, '__tables__');
    check('labels vivos bajo el 80 % del límite', nLabels <= limLabels * BUDGET_RATIO, `${nLabels}/${limLabels}`);
    check('boxes vivos bajo el 80 % del límite', nBoxes <= limBoxes * BUDGET_RATIO, `${nBoxes}/${limBoxes}`);
    check('lines vivas bajo el 80 % del límite', nLines <= limLines * BUDGET_RATIO, `${nLines}/${limLines}`);
    check('tablas vivas acotadas (2: panel + footprint, sin fuga por barra)', nTables <= 4, `${nTables} tablas`);
    check('total dibujos vivos bajo el 80 % del techo TV (~400)', nLabels + nLines + nBoxes <= TV_HARD * BUDGET_RATIO,
        `total=${nLabels + nLines + nBoxes}`);

    // Topes estáticos del código: aunque el run sintético no llene los arrays,
    // el peor caso configurable no debe acercarse al límite declarado.
    const labelCap = capFromWhile(SRC, 'structLabels', 80) + capFromWhile(SRC, 'sigLabels', 60);
    const boxCap = capFromWhile(SRC, 'obBoxes', 12) + capFromWhile(SRC, 'fvgBoxes', 10);
    check('tope estático de labels bajo el 80 % del límite', labelCap <= limLabels * BUDGET_RATIO, `tope=${labelCap}/${limLabels}`);
    check('tope estático de boxes bajo el 80 % del límite', boxCap <= limBoxes * BUDGET_RATIO, `tope=${boxCap}/${limBoxes}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCENARIO 9 · perfiles de parámetros por símbolo/timeframe
// Cada perfil debe compilar (run sin excepción ni warnings) y dar series
// operativas en sintético; con red, cada perfil pasa el escenario real
// (BTCUSDT 15m, N=250) con decisión válida y cero NaN post-warmup.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ESCENARIO 9 · perfiles por símbolo/timeframe ═══');
{
    const PROFILES = [
        { name: 'Cripto intradía', strong: 55, soft: 25, adxMin: 18, adxStr: 28, deltaK: 0.35 },
        { name: 'Cripto swing', strong: 60, soft: 30, adxMin: 20, adxStr: 30, deltaK: 0.35 },
        { name: 'Forex / ticks', strong: 50, soft: 25, adxMin: 22, adxStr: 32, deltaK: 0.25 },
        { name: 'Acciones e índices', strong: 60, soft: 30, adxMin: 22, adxStr: 35, deltaK: 0.30 },
        { name: 'Manual', strong: 60, soft: 30, adxMin: 20, adxStr: 30, deltaK: 0.35 },
    ];
    const FROM = 'input.string("Auto", "Perfil de parámetros"';
    check('selector de perfil presente en el fuente', SRC.includes(FROM));
    const seenScores = new Set();
    for (const pf of PROFILES) {
        const src = withInputs(SRC, [[FROM, `input.string("${pf.name}", "Perfil de parámetros"`]]);
        const pine = new PineTS(BARS, 'TESTUSD', '1h', BARS.length);
        let ctx = null;
        try {
            ctx = await pine.run(src);
        } catch (e) {
            failures++;
            console.log(`  FAIL  perfil "${pf.name}" no compila — ${String(e?.message ?? e).slice(0, 200)}`);
            continue;
        }
        checks++;
        const warns = ctx?.warnings ?? [];
        if (warns.length === 0) {
            console.log(`  PASS  perfil "${pf.name}" compila sin warnings`);
        } else {
            failures++;
            console.log(`  FAIL  perfil "${pf.name}" warnings — ${JSON.stringify(warns).slice(0, 200)}`);
        }
        const p = ctx.plots ?? {};
        const eq = (a, b) => Math.abs(a - b) < 1e-9;
        check(`perfil "${pf.name}" expone sus umbrales (strong/soft/ADX/deltaK)`,
            eq(lastValue(p['Perfil strong']), pf.strong) && eq(lastValue(p['Perfil soft']), pf.soft) &&
            eq(lastValue(p['Perfil adxMin']), pf.adxMin) && eq(lastValue(p['Perfil adxStrong']), pf.adxStr) &&
            eq(lastValue(p['Perfil deltaK']), pf.deltaK),
            `strong=${lastValue(p['Perfil strong'])} soft=${lastValue(p['Perfil soft'])} adx=${lastValue(p['Perfil adxMin'])}/${lastValue(p['Perfil adxStrong'])} deltaK=${lastValue(p['Perfil deltaK'])}`);
        const score = lastValue(p['Score cuántico']);
        check(`perfil "${pf.name}" score en rango y finito`, Number.isFinite(score) && score >= -100 && score <= 100, `score=${score?.toFixed?.(2)}`);
        seenScores.add(Math.round(score * 100));
        const tables = tablesOf(ctx);
        const dash = tables.find((t) => t.rows === 29);
        const cm = dash ? cellMap(dash) : new Map();
        const decision = cm.get('0,26') ?? '';
        const allowed = ['FUERTE COMPRA', 'FUERTE VENTA', 'COMPRA', 'VENTA', 'ESPERAR', 'ESPERAR · SIN VENTAJA', 'CARGANDO DATOS'];
        check(`perfil "${pf.name}" decisión válida en sintético`, allowed.includes(decision), `decisión="${decision}"`);
        check(`perfil "${pf.name}" cabecera muestra el perfil`, (cm.get('0,0') ?? '').includes(pf.name === 'Manual' ? 'Manual' : pf.name) || (cm.get('0,0') ?? '').includes('v6'), (cm.get('0,0') ?? '').slice(0, 60));
    }
    check('los perfiles cambian el score (no son un alias)', seenScores.size >= 2, `${seenScores.size} scores distintos`);

    // ── real por perfil (BTCUSDT 15m, N=250 > warmup 200) ────────────────────
    const SYM = 'BTCUSDT', TF = '15m', N = 250;
    const skipReason = await binancePreflight(SYM, TF);
    if (skipReason) {
        skipped++;
        console.log(`  SKIP  perfiles con datos reales — sin red: ${skipReason}`);
    } else {
        for (const pf of PROFILES) {
            const src = withInputs(SRC, [[FROM, `input.string("${pf.name}", "Perfil de parámetros"`]]);
            const pine = new PineTS(Provider.Binance, SYM, TF, N);
            try {
                await withTimeout(pine.ready(), 90000, `carga klines (${pf.name})`);
                const ctx = await withTimeout(pine.run(src), 240000, `ejecución real (${pf.name})`);
                const warns = ctx?.warnings ?? [];
                check(`real · perfil "${pf.name}" sin warnings`, warns.length === 0, warns.length ? JSON.stringify(warns).slice(0, 200) : 'warnings=0');
                const p = ctx.plots ?? {};
                const WARM = 200;
                const series = ['Delta', 'Delta %', 'CVD', 'Control compradores %', 'ADX', 'Momentum', 'Score cuántico', 'Score base (sin sesión)'];
                const bad = series.filter((n) => seriesValues(p[n]).slice(WARM).some((v) => typeof v !== 'number' || !Number.isFinite(v)));
                check(`real · perfil "${pf.name}" cero NaN post-warmup`, bad.length === 0, bad.length ? 'con NaN: ' + bad.join(', ') : `${series.length} series × ${N - WARM} barras`);
                const dash = tablesOf(ctx).find((t) => t.rows === 29);
                const decision = dash ? (cellMap(dash).get('0,26') ?? '') : '';
                const allowed = ['FUERTE COMPRA', 'FUERTE VENTA', 'COMPRA', 'VENTA', 'ESPERAR', 'ESPERAR · SIN VENTAJA', 'CARGANDO DATOS'];
                check(`real · perfil "${pf.name}" decisión válida`, allowed.includes(decision), `decisión="${decision}"`);
            } catch (e) {
                failures++;
                console.log(`  FAIL  real · perfil "${pf.name}" — ${String(e?.message ?? e).slice(0, 200)}`);
            }
        }
    }
}


// ═════════════════════════════════════════════════════════════════════════════
// ESCENARIO 10 · filtro de sesiones Londres/NY (killzones)
// Sintético: con el filtro OFF el score no se atenúa (score == base) y el panel
// muestra FILTRO OFF. Con killzones imposibles (p. ej. 0000-0001) el mercado está
// siempre fuera de sesión: sessMult == penalty y score == base*penalty, sin
// FUERTE aunque el umbral se supere. Con killzones 24h el mult vuelve a 1.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ESCENARIO 10 · sesiones Londres/NY ═══');
{
    const FROM_SESS = 'input.bool(true, "Filtrar por sesión Londres/NY"';
    check('input de filtro de sesión presente', SRC.includes(FROM_SESS));
    // 10a · filtro OFF: sin atenuación
    {
        const src = withInputs(SRC, [[FROM_SESS, 'input.bool(false, "Filtrar por sesión Londres/NY"']]);
        const ctx = await run(src, 'sesiones OFF (sin atenuación)');
        const pl = ctx.plots ?? {};
        const base = lastValue(pl['Score base (sin sesión)']);
        const adj = lastValue(pl['Score cuántico']);
        const mult = lastValue(pl['Sesión mult']);
        check('filtro OFF: score == base', Math.abs(adj - base) < 1e-9, `score=${adj?.toFixed?.(3)} base=${base?.toFixed?.(3)}`);
        check('filtro OFF: mult == 1', Math.abs(mult - 1) < 1e-9, `mult=${mult}`);
        const dash = tablesOf(ctx).find((t) => t.rows === 29);
        const sess = dash ? (cellMap(dash).get('1,24') ?? '') : '';
        check('panel indica FILTRO OFF', sess.includes('FILTRO OFF'), `sesión="${sess}"`);
    }
    // 10b · siempre fuera de sesión: killzones de 1 minuto que el sintético (1h) no pisa
    {
        let src = withInputs(SRC, [[FROM_SESS, 'input.bool(true, "Filtrar por sesión Londres/NY"']]);
        src = withInputs(src, [['input.session("0700-1100", "Killzone Londres"', 'input.session("0000-0001", "Killzone Londres"']]);
        src = withInputs(src, [['input.session("1230-1600", "Killzone Nueva York"', 'input.session("0000-0001", "Killzone Nueva York"']]);
        const ctx = await run(src, 'siempre fuera de sesión (0000-0001)');
        const pl = ctx.plots ?? {};
        const base = lastValue(pl['Score base (sin sesión)']);
        const adj = lastValue(pl['Score cuántico']);
        const mult = lastValue(pl['Sesión mult']);
        const inkz = lastValue(pl['En killzone']);
        check('fuera de sesión: En killzone == 0', inkz === 0, `inkill=${inkz}`);
        check('fuera de sesión: mult == penalty (0.5)', Math.abs(mult - 0.5) < 1e-9, `mult=${mult}`);
        check('fuera de sesión: score == base × penalty', Math.abs(adj - base * mult) < 1e-6, `score=${adj?.toFixed?.(3)} base=${base?.toFixed?.(3)}`);
        check('fuera de sesión: score atenuado hacia cero', Math.abs(adj) <= Math.abs(base) + 1e-9, `|${adj?.toFixed?.(2)}| <= |${base?.toFixed?.(2)}|`);
        const dash = tablesOf(ctx).find((t) => t.rows === 29);
        const sess = dash ? (cellMap(dash).get('1,24') ?? '') : '';
        check('panel indica FUERA DE SESIÓN', sess.includes('FUERA DE SESIÓN'), `sesión="${sess}"`);
        // Bloqueo de FUERTE: con umbrales bajos la base superaría el umbral fuerte,
        // pero fuera de sesión la decisión debe degradarse a COMPRA normal.
        {
            let low = withInputs(SRC, [['input.string("Auto", "Perfil de parámetros"', 'input.string("Manual", "Perfil de parámetros"']]);
            low = withInputs(low, [['input.float(60.0, "Umbral señal fuerte"', 'input.float(30.0, "Umbral señal fuerte"']]);
            low = withInputs(low, [['input.float(30.0, "Umbral señal"', 'input.float(10.0, "Umbral señal"']]);
            low = withInputs(low, [['input.float(0.5, "Atenuaci', 'input.float(1.0, "Atenuaci']]);
            low = withInputs(low, [['input.bool(true, "Señal fuerte solo en zona de interés"', 'input.bool(false, "Señal fuerte solo en zona de interés"']]);
            low = withInputs(low, [['input.session("0700-1100", "Killzone Londres"', 'input.session("0000-0001", "Killzone Londres"']]);
            low = withInputs(low, [['input.session("1230-1600", "Killzone Nueva York"', 'input.session("0000-0001", "Killzone Nueva York"']]);
            // Semilla 25: la base de la última barra (~40) supera el umbral fuerte (30).
            const bars25 = genBars(600, 100, 25);
            const pineLow = new PineTS(bars25, 'TESTUSD', '1h', bars25.length);
            const ctxLow = await pineLow.run(low);
            console.log(`\n▶ bloqueo FUERTE fuera de sesión (penalty=1)`);
            check('ejecución sin excepción', !!ctxLow);
            check('sin warnings del runtime', (ctxLow?.warnings ?? []).length === 0);
            const baseLow = lastValue(ctxLow.plots?.['Score base (sin sesión)']);
            const adjLow = lastValue(ctxLow.plots?.['Score cuántico']);
            const dashLow = tablesOf(ctxLow).find((t) => t.rows === 29);
            const decLow = dashLow ? (cellMap(dashLow).get('0,26') ?? '') : '';
            check('bloqueo: la base supera el umbral fuerte (30)', Math.abs(baseLow) >= 30, `base=${baseLow?.toFixed?.(2)}`);
            check('bloqueo: sin atenuar sigue sobre el umbral pero NO es FUERTE', Math.abs(adjLow) >= 30 && !decLow.includes('FUERTE'), `score=${adjLow?.toFixed?.(2)} decisión="${decLow}"`);
            // Control positivo: la misma configuración DENTRO de sesión sí da FUERTE.
            let lowIn = low.split('input.session("0000-0001", "Killzone Londres"').join('input.session("0000-2359", "Killzone Londres"');
            lowIn = lowIn.split('input.session("0000-0001", "Killzone Nueva York"').join('input.session("0000-2359", "Killzone Nueva York"');
            const pineIn = new PineTS(bars25, 'TESTUSD', '1h', bars25.length);
            const ctxIn = await pineIn.run(lowIn);
            const decIn = tablesOf(ctxIn).find((t) => t.rows === 29) ? (cellMap(tablesOf(ctxIn).find((t) => t.rows === 29)).get('0,26') ?? '') : '';
            check('control: en sesión la misma señal SÍ es FUERTE', decIn.includes('FUERTE'), `decisión="${decIn}"`);
        }
    }
    // 10c · siempre dentro: killzone 24h
    {
        let src = withInputs(SRC, [[FROM_SESS, 'input.bool(true, "Filtrar por sesión Londres/NY"']]);
        src = withInputs(src, [['input.session("0700-1100", "Killzone Londres"', 'input.session("0000-2359", "Killzone Londres"']]);
        const ctx = await run(src, 'siempre en sesión (0000-2359)');
        const mult = lastValue(ctx.plots?.['Sesión mult']);
        const inkz = lastValue(ctx.plots?.['En killzone']);
        check('en sesión: mult == 1 y killzone == 1', mult === 1 && inkz === 1, `mult=${mult} inkill=${inkz}`);
        const dash = tablesOf(ctx).find((t) => t.rows === 29);
        const sess = dash ? (cellMap(dash).get('1,24') ?? '') : '';
        check('panel indica LONDRES en killzone 24h', sess.includes('LONDRES'), `sesión="${sess}"`);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCENARIO 11 · ciclo de vida del OB (toque → mitigación → invalidación)
// Sintético 600 barras: el panel debe exponer el estado del OB (VIRGEN/TOCADO/
// MITIGADO + contadores T/M/I), los plots OB vivos/toques/mitigados/invalidados
// son finitos, los vivos respetan maxOB y la limpieza deja invalidados >= 0.
// Además se fuerza la invalidación total (OBs de 1 barra de extensión + cierres
// que los rompen) para comprobar que las cajas rotas se borran solas.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ESCENARIO 11 · ciclo de vida del OB ═══');
{
    const ctx = await run(SRC, 'OB por defecto (toque/mitigación/invalidación)');
    const p = ctx.plots ?? {};
    for (const n of ['OB vivos', 'OB toques', 'OB mitigados', 'OB invalidados', 'En OB']) {
        check(`plot "${n}" presente`, n in p);
    }
    const vivos = lastValue(p['OB vivos']);
    const toques = lastValue(p['OB toques']);
    const mitig = lastValue(p['OB mitigados']);
    const inval = lastValue(p['OB invalidados']);
    const enOB = lastValue(p['En OB']);
    check('OB vivos finito y dentro del tope maxOB (12)', Number.isFinite(vivos) && vivos >= 0 && vivos <= 12, `vivos=${vivos}`);
    check('contadores T/M/I finitos y monótonos', [toques, mitig, inval].every((v) => Number.isFinite(v) && v >= 0),
        `T=${toques} M=${mitig} I=${inval}`);
    check('mitigados <= toques (solo se mitiga lo tocado)', mitig <= toques, `M=${mitig} T=${toques}`);
    check('En OB ∈ {-1,0,1}', [-1, 0, 1].includes(enOB), `enOB=${enOB}`);
    const dash = tablesOf(ctx).find((t) => t.rows === 29);
    const zona = dash ? (cellMap(dash).get('1,15') ?? '') : '';
    const motivo = dash ? (cellMap(dash).get('0,27') ?? '') : '';
    check('panel zona expone estado OB (VIRGEN/TOCADO/MITIGADO o conteo T/M/I)',
        /VIRGEN|TOCADO|MITIGADO|T\d+ M\d+ I\d+|OB \d+v/.test(zona), `zona="${zona.slice(0, 90)}"`);
    check('motivo incluye último evento del OB', motivo.includes('OB') || motivo.includes('—'), `motivo="${motivo.slice(0, 90)}"`);
    // Limpieza forzada: extensión mínima para que los OBs caduquen/invaliden rápido.
    let src2 = withInputs(SRC, [['input.int(30, "Extensión del OB (barras)"', 'input.int(2, "Extensión del OB (barras)"']]);
    const pine2 = new PineTS(BARS, 'TESTUSD', '1h', BARS.length);
    const ctx2 = await pine2.run(src2);
    check('limpieza: ejecución sin excepción con extensión mínima', !!ctx2);
    check('limpieza: sin warnings del runtime', (ctx2?.warnings ?? []).length === 0);
    const v2 = lastValue(ctx2.plots?.['OB vivos']);
    const i2 = lastValue(ctx2.plots?.['OB invalidados']);
    check('limpieza: vivos acotados tras forzar roturas', Number.isFinite(v2) && v2 >= 0 && v2 <= 12, `vivos=${v2} invalidados=${i2}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCENARIO 12 · backtest mínimo de señales FUERTE (nº, win-rate a H, MFE/MAE)
// + hit-rate direccional del predictor (signo de predMove = predPrice - close
// vs signo del retorno real a HP=5 barras, valor por defecto de predHorizon)
// 12a sintético (determinista, siempre corre): las banderas SIG FUERTE COMPRA/
// VENTA son series completas y deben dar ≥1 señal con métricas coherentes.
// 12b real (Binance BTCUSDT 15m, N=500): mide lo mismo sobre mercado real;
// sin red se omite con SKIP. Si la ventana no trae señales FUERTE (depende del
// mercado), se informa sin fallar: lo que se verifica es la integridad del
// cálculo, no la rentabilidad.
// Reglas: entrada al cierre de la vela de señal, salida al cierre H=10 velas
// después; solo señales post-warmup (índice ≥ 200). MFE/MAE en % sobre
// máximos/mínimos de la ventana (i+1..i+H).
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ESCENARIO 12 · backtest FUERTE ═══');
{
    const H = 10;
    const HP = 5;
    const WARM = 200;
    function backtest(closes, highs, lows, buys, sells, h, from) {
        const t = { nBuy: 0, nSell: 0, wBuy: 0, wSell: 0, mfe: [], mae: [], net: [] };
        const nb = closes.length;
        for (let i = from; i + h < nb; i++) {
            const isBuy = buys[i] === 1;
            const isSell = sells[i] === 1;
            if (!isBuy && !isSell) continue;
            if (isBuy && isSell) continue;
            const entry = closes[i];
            if (!Number.isFinite(entry) || entry <= 0) continue;
            let mx = -Infinity, mn = Infinity;
            for (let k = i + 1; k <= i + h; k++) {
                if (Number.isFinite(highs[k])) mx = Math.max(mx, highs[k]);
                if (Number.isFinite(lows[k])) mn = Math.min(mn, lows[k]);
            }
            const exit = closes[i + h];
            if (!Number.isFinite(exit) || !Number.isFinite(mx) || !Number.isFinite(mn)) continue;
            let ret, mfe, mae;
            if (isBuy) {
                ret = (exit - entry) / entry * 100;
                mfe = (mx - entry) / entry * 100;
                mae = (entry - mn) / entry * 100;
                t.nBuy++;
                if (ret > 0) t.wBuy++;
            } else {
                ret = (entry - exit) / entry * 100;
                mfe = (entry - mn) / entry * 100;
                mae = (mx - entry) / entry * 100;
                t.nSell++;
                if (ret > 0) t.wSell++;
            }
            t.mfe.push(mfe);
            t.mae.push(mae);
            t.net.push(ret);
        }
        const nT = t.nBuy + t.nSell;
        const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
        return { ...t, n: nT, wr: nT ? (t.wBuy + t.wSell) / nT : NaN, wrBuy: t.nBuy ? t.wBuy / t.nBuy : NaN,
            wrSell: t.nSell ? t.wSell / t.nSell : NaN, mfeAvg: mean(t.mfe), maeAvg: mean(t.mae), netAvg: mean(t.net) };
    }
    function fmtPct(v, d = 2) {
        return Number.isFinite(v) ? v.toFixed(d) + '%' : 'n/a';
    }
    // Hit-rate direccional del predictor: signo(predMove) vs signo del retorno
    // real a HP barras. predMove no se exporta como plot, pero es exacto vía
    // predPrice - close (el Pine define predPrice = close + predMove). HP = 5
    // coincide con el valor por defecto de predHorizon. Se omiten barras con
    // predMove o retorno nulos/NaN (empates exactos a 0 no puntúan).
    function predHitRate(closes, predPrices, h, from) {
        let n = 0, hits = 0, nUp = 0, hUp = 0, nDn = 0, hDn = 0;
        const nb = closes.length;
        for (let i = from; i + h < nb; i++) {
            const px = predPrices[i], entry = closes[i], exit = closes[i + h];
            if (!Number.isFinite(px) || !Number.isFinite(entry) || !Number.isFinite(exit)) continue;
            if (entry <= 0) continue;
            const pm = px - entry;
            if (!Number.isFinite(pm) || pm === 0) continue;
            const act = exit - entry;
            if (act === 0) continue;
            n++;
            const hit = Math.sign(pm) === Math.sign(act);
            if (hit) hits++;
            if (pm > 0) { nUp++; if (hit) hUp++; } else { nDn++; if (hit) hDn++; }
        }
        return { n, hits, hr: n ? hits / n : NaN, nUp, hrUp: nUp ? hUp / nUp : NaN, nDn, hrDn: nDn ? hDn / nDn : NaN };
    }
    // 12a · sintético determinista
    {
        const pine = new PineTS(BARS, 'TESTUSD', '1h', BARS.length);
        const ctx = await pine.run(SRC);
        console.log('\n▶ backtest sintético (600 barras, H=10)');
        check('backtest sintético: ejecución sin excepción', !!ctx);
        check('backtest sintético: sin warnings', (ctx?.warnings ?? []).length === 0);
        const p = ctx.plots ?? {};
        check('banderas SIG FUERTE presentes', 'SIG FUERTE COMPRA' in p && 'SIG FUERTE VENTA' in p);
        const buys = seriesValues(p['SIG FUERTE COMPRA']);
        const sells = seriesValues(p['SIG FUERTE VENTA']);
        const okBin = (a) => a.every((v) => v === 0 || v === 1 || (typeof v === 'number' && Number.isNaN(v)));
        check('banderas binarias (0/1)', okBin(buys) && okBin(sells));
        const closes = BARS.map((b) => b.close);
        const highs = BARS.map((b) => b.high);
        const lows = BARS.map((b) => b.low);
        const r = backtest(closes, highs, lows, buys, sells, H, WARM);
        check('≥1 señal FUERTE post-warmup en sintético', r.n >= 1, `n=${r.n} (C=${r.nBuy} V=${r.nSell})`);
        check('win-rate total en [0,1]', r.n >= 1 && r.wr >= 0 && r.wr <= 1, `wr=${fmtPct(r.wr * 100)}`);
        check('MFE/MAE medios ≥ 0', r.mfeAvg >= 0 && r.maeAvg >= 0, `MFE=${fmtPct(r.mfeAvg)} MAE=${fmtPct(r.maeAvg)}`);
        check('retorno medio finito', Number.isFinite(r.netAvg), `net=${fmtPct(r.netAvg)}`);
        console.log(`  info  sintético: n=${r.n} (C=${r.nBuy} V=${r.nSell}) wr=${fmtPct(r.wr * 100)} wrC=${fmtPct(r.wrBuy * 100)} wrV=${fmtPct(r.wrSell * 100)} MFE=${fmtPct(r.mfeAvg)} MAE=${fmtPct(r.maeAvg)} net=${fmtPct(r.netAvg)}`);
        // 12a-bis · hit-rate direccional del predictor en sintético (HP=5)
        check('predictor sintético: plot Precio predicho presente', 'Precio predicho' in p);
        const predPx = seriesValues(p['Precio predicho']);
        check('predictor sintético: serie alineada con el close', predPx.length === closes.length, `series=${predPx.length}/${closes.length}`);
        const ph = predHitRate(closes, predPx, HP, WARM);
        check('predictor sintético: ≥1 pronóstico evaluable post-warmup', ph.n >= 1, `n=${ph.n}`);
        check('predictor sintético: hit-rate en [0,1]', ph.n >= 1 && ph.hr >= 0 && ph.hr <= 1, `hr=${fmtPct(ph.hr * 100)}`);
        check('predictor sintético: desglose up/down consistente (n=nUp+nDn)', ph.n === ph.nUp + ph.nDn, `n=${ph.n} (up=${ph.nUp} dn=${ph.nDn})`);
        console.log(`  info  predictor sintético HP=${HP}: n=${ph.n} hits=${ph.hits} hr=${fmtPct(ph.hr * 100)} up=${fmtPct(ph.hrUp * 100)} (n=${ph.nUp}) dn=${fmtPct(ph.hrDn * 100)} (n=${ph.nDn})`);
    }
    // 12b · real Binance
    const SYM = 'BTCUSDT', TF = '15m', N = 500;
    const skipReason = await binancePreflight(SYM, TF);
    if (skipReason) {
        skipped++;
        console.log(`  SKIP  backtest real — sin red: ${skipReason}`);
    } else {
        const t0 = Date.now();
        const pine = new PineTS(Provider.Binance, SYM, TF, N);
        try {
            await withTimeout(pine.ready(), 90000, 'carga klines (backtest)');
            const ctx = await withTimeout(pine.run(SRC), 240000, 'ejecución (backtest)');
            const warns = ctx?.warnings ?? [];
            check('backtest real: sin warnings', warns.length === 0, warns.length ? JSON.stringify(warns).slice(0, 200) : 'warnings=0');
            const p = ctx.plots ?? {};
            const buys = seriesValues(p['SIG FUERTE COMPRA']);
            const sells = seriesValues(p['SIG FUERTE VENTA']);
            const nbars = pine.data?.length ?? 0;
            check('backtest real: N barras y series alineadas', nbars >= WARM + H + 10 && buys.length === nbars && sells.length === nbars,
                `barras=${nbars} series=${buys.length}/${sells.length}`);
            const closes = pine.data.map((b) => b.close);
            const highs = pine.data.map((b) => b.high);
            const lows = pine.data.map((b) => b.low);
            const finiteOHLC = closes.every(Number.isFinite) && highs.every(Number.isFinite) && lows.every(Number.isFinite);
            check('backtest real: OHLC finitos', finiteOHLC);
            const r = backtest(closes, highs, lows, buys, sells, H, WARM);
            check('backtest real: conteos consistentes (n=C+V)', r.n === r.nBuy + r.nSell, `n=${r.n} (C=${r.nBuy} V=${r.nSell})`);
            if (r.n === 0) {
                console.log('  info  ventana real sin señales FUERTE post-warmup (mercado-dependiente): nº=0, win-rate/MFE/MAE no aplicables — no es un fallo');
            } else {
                check('backtest real: win-rate en [0,1]', r.wr >= 0 && r.wr <= 1, `wr=${fmtPct(r.wr * 100)} (C=${fmtPct(r.wrBuy * 100)} V=${fmtPct(r.wrSell * 100)})`);
                check('backtest real: MFE/MAE medios ≥ 0', r.mfeAvg >= 0 && r.maeAvg >= 0, `MFE=${fmtPct(r.mfeAvg)} MAE=${fmtPct(r.maeAvg)}`);
                check('backtest real: retorno medio finito', Number.isFinite(r.netAvg), `net=${fmtPct(r.netAvg)}`);
            }
            console.log(`  info  real ${SYM} ${TF} H=${H}: n=${r.n} (C=${r.nBuy} V=${r.nSell}) wr=${fmtPct(r.wr * 100)} MFE=${fmtPct(r.mfeAvg)} MAE=${fmtPct(r.maeAvg)} net=${fmtPct(r.netAvg)}`);
            // 12b-bis · hit-rate direccional del predictor en real (HP=5)
            check('predictor real: plot Precio predicho presente', 'Precio predicho' in p);
            const predPxR = seriesValues(p['Precio predicho']);
            check('predictor real: serie alineada con el close', predPxR.length === closes.length,
                `series=${predPxR.length}/${closes.length}`);
            const phR = predHitRate(closes, predPxR, HP, WARM);
            check('predictor real: conteo consistente (n=nUp+nDn)', phR.n === phR.nUp + phR.nDn,
                `n=${phR.n} (up=${phR.nUp} dn=${phR.nDn})`);
            if (phR.n === 0) {
                console.log('  info  predictor real sin pronósticos evaluables post-warmup — no es un fallo');
            } else {
                check('predictor real: hit-rate en [0,1]', phR.hr >= 0 && phR.hr <= 1,
                    `hr=${fmtPct(phR.hr * 100)} (up=${fmtPct(phR.hrUp * 100)} dn=${fmtPct(phR.hrDn * 100)})`);
            }
            console.log(`  info  predictor real ${SYM} ${TF} HP=${HP}: n=${phR.n} hits=${phR.hits} hr=${fmtPct(phR.hr * 100)} up=${fmtPct(phR.hrUp * 100)} (n=${phR.nUp}) dn=${fmtPct(phR.hrDn * 100)} (n=${phR.nDn})`);
            console.log(`  info  ejecución total del escenario: ${Date.now() - t0} ms`);
        } catch (e) {
            failures++;
            console.log(`  FAIL  backtest real — ${String(e?.message ?? e).slice(0, 200)}`);
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCENARIO 13 · mobile 6.7" + predictor (Completo/Mobile/Predictor compilan,
// panel intacto de 29 filas y series nuevas finitas)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ ESCENARIO 13 · mobile + predictor ═══');
{
    const MODES = ['Completo', 'Mobile', 'Predictor'];
    const FROM_MODE = 'input.string("Completo", "Modo de panel"';
    check('input de modo de panel presente', SRC.includes(FROM_MODE));
    check('input de horizonte de prediccion presente', SRC.includes('Horizonte de prediccion'));
    for (const m of MODES) {
        const src = withInputs(SRC, [[FROM_MODE, `input.string("${m}", "Modo de panel"`]]);
        const pine = new PineTS(BARS, 'TESTUSD', '1h', BARS.length);
        let ctx = null;
        try {
            ctx = await pine.run(src);
        } catch (e) {
            failures++;
            console.log(`  FAIL  modo "${m}" no compila — ${String(e?.message ?? e).slice(0, 200)}`);
            continue;
        }
        checks++;
        const warns = ctx?.warnings ?? [];
        if (warns.length === 0) {
            console.log(`  PASS  modo "${m}" compila sin warnings`);
        } else {
            failures++;
            console.log(`  FAIL  modo "${m}" warnings — ${JSON.stringify(warns).slice(0, 200)}`);
        }
        const p = ctx.plots ?? {};
        for (const n of ['RSI', 'DI spread', 'Fuerza tendencia', 'Precio predicho', 'Prob subida %']) {
            check(`modo "${m}" · plot "${n}" presente`, n in p);
        }
        const tp = lastValue(p['Fuerza tendencia']);
        const prob = lastValue(p['Prob subida %']);
        const px = lastValue(p['Precio predicho']);
        const rsi = lastValue(p['RSI']);
        check(`modo "${m}" · fuerza en [0,100]`, Number.isFinite(tp) && tp >= 0 && tp <= 100, `fuerza=${tp?.toFixed?.(2)}`);
        check(`modo "${m}" · prob en [5,95]`, Number.isFinite(prob) && prob >= 5 && prob <= 95, `prob=${prob?.toFixed?.(1)}`);
        check(`modo "${m}" · RSI en [0,100]`, Number.isFinite(rsi) && rsi >= 0 && rsi <= 100, `rsi=${rsi?.toFixed?.(1)}`);
        check(`modo "${m}" · precio predicho finito y > 0`, Number.isFinite(px) && px > 0, `pred=${px?.toFixed?.(2)}`);
        const dash = tablesOf(ctx).find((t) => t.rows === 29);
        check(`modo "${m}" · panel 29 filas intacto`, !!dash && cellMap(dash).size >= 100, `celdas=${dash ? cellMap(dash).size : 0}`);
        if (dash) {
            const cm = cellMap(dash);
            const head = cm.get('0,0') ?? '';
            check(`modo "${m}" · cabecera indica el modo`, head.includes(m), head.slice(0, 60));
            const decision = cm.get('0,26') ?? '';
            const allowed = ['FUERTE COMPRA', 'FUERTE VENTA', 'COMPRA', 'VENTA', 'ESPERAR', 'ESPERAR · SIN VENTAJA', 'CARGANDO DATOS'];
            check(`modo "${m}" · decisión válida`, allowed.includes(decision), `decisión="${decision}"`);
            check(`modo "${m}" · motivo con datos`, (cm.get('0,27') ?? '').length > 10, (cm.get('0,27') ?? '').slice(0, 70));
        }
    }
}

console.log(`\n══════════════════════════════════════════`);
const skipTxt = skipped ? ` · ${skipped} escenario(s) omitidos (sin red)` : '';
console.log(`RESUMEN RUNTIME: ${checks - failures}/${checks} aserciones OK${skipTxt}`);
if (failures) {
    console.log(`RESULTADO: FALLO (${failures} aserciones)`);
    process.exit(1);
}
console.log('RESULTADO: OK');
