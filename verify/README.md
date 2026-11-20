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

## Falsos positivos encontrados (y por qué se corrigió el validador, no el script)

Durante el desarrollo el lint marcó tres cosas que **no** eran errores del `.pine`. Se corrigió el
validador, no el indicador:

1. **`array.new<type>` “no existe”.** La referencia documenta la forma genérica
   `array.new<type>(size, initial_value) → array<type>`
   ([v6 · array.new<type>](https://www.tradingview.com/pine-script-reference/v6/#fun_array.new%3Ctype%3E)).
   El parser de la base de firmas no aceptaba `<…>` en el nombre; ahora lo normaliza a `array.new`.
2. **`line.new(x1, y1, x2, y2, …)` tratado como receptor de línea.** La referencia tiene dos
   sobrecargas: `line.new(first_point, second_point, …)` y `line.new(x1, y1, x2, y2, …)`
   ([v6 · line.new](https://www.tradingview.com/pine-script-reference/v6/#fun_line.new)).
   El primer argumento son coordenadas, no un id, así que la comprobación de tipo de receptor ahora
   sólo aplica a funciones cuyo primer parámetro es `table_id`/`id`/`array_id`… (nunca a `*.new`).
3. **`fb` tipado como `float` cuando era un `box`.** El script declara `box fb` dentro del bloque de
   FVG y `float fb` dentro del bucle del footprint: son variables distintas porque Pine usa ámbitos
   locales por bloque ([v6 · Variable declarations](https://www.tradingview.com/pine-script-docs/language/variable-declarations/)).
   El lint guarda ahora la línea de cada declaración y resuelve por la más cercana anterior al uso.

## Límites conocidos del lint

- La referencia no marca de forma fiable los parámetros obligatorios, así que la aridad mínima se
  comprueba con una tabla curada (`MIN_ARGS`) para ~60 funciones; el máximo posicional y los nombres
  de argumentos sí se validan contra las 475 firmas.
- Los valores enum se validan de forma directa o por inicializador de variable; una expresión
  arbitraria se deja pasar (no es un error) para no generar falsos positivos.
- No hace inferencia completa de tipos ni análisis de flujo de datos: sólo receptores
  (`table/box/line/label/array/matrix/map`), formatos de `str.tostring` y enums documentados.

## Qué no se puede verificar aquí

El compilador propietario de TradingView. PineTS es un runtime independiente (experimental para v6
nativo) y no garantiza el 100 % de paridad con el motor de TradingView. El paso que queda fuera del
sandbox es pegar el archivo en el Pine Editor y pulsar *Guardar*.

## Entregables por partes (ensamblado determinista)

Los tres archivos grandes viven como partes (`verify/parts/lint.*`, `verify/parts/rt.*`,
`quant-flow/src/qfa.*`) y `verify/assemble.py` los concatena verificando su sha256.
`bash verify/verify_all.sh` ensambla primero (paso 0); el CI publica los ensamblados en `main`.
Para regenerar el `.pine` desde un clon fresco basta con correr la suite.
