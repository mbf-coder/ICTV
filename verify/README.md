# Verificación del indicador (evidencia reproducible)

```bash
bash verify/verify_all.sh     # exit 0 = todo pasa
```

En GitHub se ejecuta automáticamente vía [`.github/workflows/verify.yml`](../.github/workflows/verify.yml)
(push, pull request y ejecución manual). El propio workflow instala `pynescript==0.3.0` y
`pinets@0.13.1`, y publica el resumen en la pestaña del run + el log como artefacto. Si quieres
lanzarlo igual que el CI en local: `PYTHON=python3 NO_COLOR=1 bash verify/verify_all.sh`.

| Script | Qué hace |
|---|---|
| `verify_all.sh` | Orquesta los 5 pasos e instala lo que falte (`pynescript`, `pinets`). Si falta `verify/v6_reference.json` (no se versiona), lo reconstruye con `build_ref.py` desde el espejo de la referencia oficial v6. |
| `parse_pynescript.py` | Parsea el `.pine` con la gramática Pine de `pynescript` (AST real, 323 sentencias / 13 172 nodos). |
| `build_ref.py` | Descarga el espejo markdown de la referencia oficial v6 y genera `v6_reference.json` (475 funciones con parámetros, tipos y valores enum). Sólo hace falta para regenerar la base. |
| `pine_v6_lint.py` | Lint estático: contrasta las 374 llamadas del script contra las firmas v6 + reglas de tipos/migración. |
| `selftest_lint.py` | Inyecta 18 defectos conocidos y comprueba que el lint los detecta (evita un validador vacuo). |
| `verify_runtime.mjs` | 12 escenarios con PineTS (LuxAlgo): 5 sobre 600 barras sintéticas (plots, panel de 29 filas, footprint ON/OFF, proxy, todo apagado, warmup) + presupuesto de objetos TV (labels/boxes/lines/tablas bajo el 80 % del límite) + perfiles por símbolo/timeframe (los 5 compilan en sintético con sus umbrales) + 2 con datos reales de Binance (BTCUSDT 15m: delta con ~15 intrabars por vela, cero NaN post-warmup, `VOL REAL`, footprint) + cada perfil contra datos reales (BTCUSDT 15m, N=250; se omiten con SKIP si no hay red) + filtro de sesiones Londres/NY (OFF, fuera de sesión y en sesión) + ciclo de vida del OB (toque → mitigación → invalidación + limpieza automática) + backtest mínimo de señales FUERTE (nº, win-rate a H=10 y MFE/MAE; sintético determinista + BTCUSDT 15m N=500 con SKIP sin red). |
| `check_features.py` | Checklist de los 36 requisitos funcionales de la misión (incluye perfiles por símbolo/timeframe, filtro de sesiones, ciclo de vida del OB con toque/mitigación/invalidación/limpieza y banderas SIG FUERTE para backtest). |
