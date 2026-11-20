# Quantum Flow Analyzer v6

Indicador de TradingView en Pine Script v6 para análisis de orderflow + SMC con panel de decisión:
volumen real, delta de velas y CVD, ADX/DI, momentum, 4 EMAs, zonas de interés (Order Blocks, FVG,
premium/discount, VWAP), perfil de volumen (POC/VAH/VAL), footprint intrabar con interruptor,
y una fila final que resume **FUERTE COMPRA / COMPRA / ESPERAR / VENTA / FUERTE VENTA**.

Archivo: `QuantumFlowAnalyzer_v6.pine` (un solo script, sin librerías externas).

## Instalación

1. TradingView → **Pine Editor** → pega el contenido de `QuantumFlowAnalyzer_v6.pine`.
2. **Guardar** → **Añadir al gráfico**.
3. Abre los ajustes del indicador y revisa el grupo `2 · Orderflow y Delta` (timeframe intrabar)
   y el grupo `7 · Footprint`.

## Grupos de ajustes

| **0 · Perfil símbolo/timeframe** | Perfil de parámetros (`Auto`, uno fijo o `Manual`). En `Auto` se resuelve por símbolo y timeframe (ver tabla de abajo); cada perfil ajusta umbrales del score, ADX, pesos y sensibilidad del delta. |
|---|---|
| **1 · Visual** | EMAs (longitudes), VWAP, colores alcista/bajista, colorear velas por delta, dibujar OB/FVG/BOS y etiquetas de señal. |
| **2 · Orderflow y Delta** | Timeframe intrabar usado para delta y footprint (debe ser menor que el del gráfico), motor de delta (`Intrabar` o `Proxy OHLC`), máximo de intrabars por vela, media de volumen, ventana de control compradores/vendedores, reset del CVD por sesión y umbral de absorción. |
| **3 · Tendencia y Momentum** | Longitudes de DI/ADX/ATR y momentum, y umbrales de ADX (tendencia mínima y fuerza alta). |
| **4 · SMC y Zonas** | Fuerza del swing, barras para localizar el Order Block, máximo de OB y FVG, extensión de las cajas, lookback de premium/discount y tolerancia de zona (× ATR). |
| **5 · Perfil de Volumen** | Mostrar POC/VAH/VAL, número de bins, barras del perfil y % de value area. |
| **6 · Panel y Decisión** | Mostrar panel, posición, tamaño de texto, **modo de panel** (`Completo` / `Mobile` / `Predictor`), **horizonte de predicción** (velas), umbrales de señal (fuerte y normal), exigir zona de interés para señales fuertes, y los 5 pesos del score. |
| **7 · Footprint** | **Activar/desactivar** la tabla de footprint, filas de precio, posición y ratio de desequilibrio. |
| **8 · Sesiones Londres/NY** | Filtro por killzones de Londres y Nueva York (sesiones + zona horaria): fuera de sesión el score se atenúa (× penalización) y las señales FUERTE exigen estar en killzone. |

## Perfiles por símbolo y timeframe

El grupo `0 · Perfil símbolo/timeframe` evita retocar umbrales a mano al cambiar
de activo. `Auto` (por defecto) resuelve así: volumen de ticks → `Forex / ticks`;
temporalidad diaria o superior → `Acciones e índices`; intradía ≤ 30 min →
`Cripto intradía`; intradía mayor → `Cripto swing`. Elegir un perfil fijo lo fuerza;
`Manual` usa los valores de los grupos 2/3/6 tal cual.

| Perfil | Score fuerte/normal | ADX mín/fuerte | Pesos tendencia/ADX/mom/orderflow/estructura | Delta (δ/CVD/control) | Absorción |
|---|---|---|---|---|---|
| **Cripto intradía** | 55 / 25 | 18 / 28 | 25 / 20 / 15 / 25 / 15 | 0.35 / 2.5 / 1.6 | 1.5x |
| **Cripto swing** | 60 / 30 | 20 / 30 | 30 / 20 / 15 / 20 / 15 | 0.35 / 2.5 / 1.6 | 1.8x |
| **Forex / ticks** | 50 / 25 | 22 / 32 | 30 / 25 / 20 / 10 / 15 | 0.25 / 1.5 / 1.0 | 1.3x |
| **Acciones e índices** | 60 / 30 | 22 / 35 | 30 / 20 / 15 / 20 / 15 | 0.30 / 2.0 / 1.4 | 1.6x |
| **Manual** | inputs | inputs | inputs | 0.35 / 2.5 / 1.6 | input |

El perfil activo aparece en la cabecera del panel y sus umbrales en la ventana de
datos (`Perfil strong/soft/adxMin/adxStrong/deltaK`). Solo cambian umbrales,
pesos y sensibilidad del delta: las longitudes de cálculo no se tocan. El
escenario 9 de la suite compila cada perfil y lo pasa por datos sintéticos y
reales (BTCUSDT 15m).

## Modos de panel (incluye Mobile 6.7")

El ajuste **Modo de panel** (grupo 6) cambia cómo se presenta la misma información,
sin quitar ninguna fila (29 filas × 4 columnas en los tres modos):

| Modo | Para qué sirve | Qué cambia |
|---|---|---|
| **Completo** | Escritorio / análisis a fondo | Todo el detalle: zona completa, motivo largo, pie estándar. |
| **Mobile** | Pantallas de **6.7 pulgadas** o menores | Textos cortos (`OB ALC`, `DISC 40%`, `RSI 55`, reloj `HH:mm`), cabecera con el modo, y el motivo/pie resumidos con el pronóstico. Usa tamaño `Normal` o `Grande` para leerlo bien en el móvil. |
| **Predictor** | Operativa guiada por pronóstico | El motivo y el pie **priorizan el pronóstico** (`BAJA a 148.66 (-0.41%) · P58%`), la fila de estructura muestra la dirección (`ALCISTA FUERTE`…), y la fila de stops muestra el **rango predicho** en vez de `long / short`. |

## Radar de tendencia y predictor de precio

Además del score, cada vela calcula:

- **RSI (14)** de confirmación, **DI spread** (`+DI − −DI` con flecha ▲/▼ si el ADX sube o baja) y **pendiente de la EMA media** (% del ATR).
- **Fuerza de tendencia 0–100 %** (EMAs + ADX + DI + pendiente) y **dirección** (`ALCISTA FUERTE` / `ALCISTA` / `LATERAL` / `BAJISTA` / `BAJISTA FUERTE`), visibles en las filas de ADX, Momentum, EMAs y Estructura.
- **Precio predicho**: extrapola el momentum a `Horizonte de predicción` velas (por defecto 5) y lo combina con el score (`predMove = mom/n·H + score/100·ATR·0.8`); el panel muestra precio, retorno %, **rango** (`pred ± ATR/2`) y **probabilidad direccional** (`50 + score·0.35 + (control−50)·0.3`, acotada 5–95 %). Todo queda también en la ventana de datos (`RSI`, `DI spread`, `Fuerza tendencia`, `Precio predicho`, `Predicho alto/bajo`, `Prob subida %`).

Es una **proyección lineal del estado actual** (no magia): úsala como brújula de
dirección y fuerza, no como garantía. No es asesoramiento financiero.

## Cómo leer el panel

Filas por sección, con semáforo de color:

- **Volumen & Orderflow** — volumen y su media, delta de la vela y delta %, CVD y su pendiente,
  **control** (COMPRADORES/VENDEDORES con barra), absorción.
- **Tendencia & Momentum** — ADX con +DI/−DI y clasificación, momentum y ROC %, estado de las EMAs
  (alineadas ↑/↓ o mixtas), estructura (BOS alcista/bajista).
- **Zonas & SMC** — zona actual (Order Block con estado VIRGEN/TOCADO/MITIGADO + conteo `Nv · Tx Mx Ix`, FVG, discount/premium), ubicación en el rango, VWAP, POC/VAH/VAL. El motivo añade el último evento (`OB alcista tocado / mitigado / invalidado · limpiado`).
- **Volatilidad & Riesgo** — ATR, ATR % del precio, régimen (expansión/compresión), stops a 1.5 ATR.
- **Sesión LON/NY** — killzone activa (LONDRES / NUEVA YORK) o `FUERA DE SESIÓN ×penalización`
  con el multiplicador aplicado al score.
- **Decisión cuántica** — score −100…+100 (ya atenuado fuera de sesión), barra de fuerza,
  confluencia (0–100 %) y la fila grande con la decisión. Umbrales por defecto: ±30 señal,
  ±60 señal fuerte (y, si está activado, solo dentro de zona de interés y de killzone).

## Footprint

El footprint se calcula **reconstruyéndolo con intrabars** (`request.security_lower_tf`): reparte el
volumen de cada barra menor entre los niveles de precio que recorre y lo separa en compra/venta según
la dirección de esa barra. Por eso:

- Funciona en **cualquier plan** y se enciende/apaga con un check (grupo 7).
- En planes con datos de segundos puedes bajar el timeframe intrabar para más resolución.
- **No** usa `request.footprint()` (nativo, solo Premium/Ultimate): incluirlo impediría cargar el
  script en cuentas básicas. La fila inferior del panel muestra cuántos intrabars se usaron.

## Alertas

Cuatro condiciones listas para crear alertas: compra fuerte en zona, venta fuerte en zona,
compra en zona y venta en zona.

## Verificación

```bash
bash verify/verify_all.sh
```

Ejecuta 5 pasos y devuelve código 0 solo si todos pasan:

1. **Parse AST** con `pynescript` (gramática Pine) → sin errores de sintaxis.
2. **Lint estático v6** → contrasta cada llamada contra **475 firmas** de la referencia oficial
   (parámetros, aridad, valores enum) y aplica reglas v6 (sin `transp=`, sin `when=`, bool no `na`,
   sin condiciones numéricas, `var … = na` con tipo, formatos de `str.tostring`, `security_lower_tf`
   con tupla y arrays con guarda de tamaño, tipos de receptor `table/box/line/array`).
3. **Autoprueba del lint** → inyecta 18 defectos y comprueba que los detecta.
4. **Runtime con PineTS** → 13 escenarios: 5 sobre 600 barras sintéticas (series sin NaN,
   panel de 29 filas con 12 merges y decisión válida, footprint ON/OFF, modo proxy, todo
   apagado, warmup corto) + presupuesto de objetos TV (labels/boxes/lines/tablas bajo el 80 %
   del límite) + perfiles por símbolo/timeframe (los 5 compilan en sintético con sus umbrales)
   + 2 con datos reales de Binance (BTCUSDT 15m: delta con ~15 intrabars por vela, cero NaN
   post-warmup, `VOL REAL` y footprint) + cada perfil contra datos reales (BTCUSDT 15m, N=250,
   decisión válida y cero NaN post-warmup) + filtro de sesiones Londres/NY (OFF sin atenuar,
   fuera de sesión con score × penalización y FUERTE bloqueado, en sesión sin atenuar)
   + ciclo de vida del OB (toque → mitigación → invalidación + limpieza automática)
   + modos Completo/Mobile/Predictor (los 3 compilan sin warnings, panel de 29 filas
   intacto, RSI/fuerza/probabilidad/precio predicho finitos y en rango)
   + backtest mínimo de señales FUERTE (nº de señales, win-rate a H=10 barras y MFE/MAE
   medios; sintético determinista + BTCUSDT 15m N=500 con SKIP sin red). Sin red,
   los escenarios reales se omiten con SKIP sin romper la suite.
5. **Checklist de misión** → 45 requisitos (panel, decisión, footprint, OB con toque/mitigación/invalidación/limpieza, zonas,
   indicadores, alertas, perfiles por símbolo/timeframe, filtro de sesiones, banderas SIG FUERTE para backtest,
   modo de panel Mobile/Predictor, RSI, fuerza/dirección de tendencia y predictor con probabilidad).

## Qué está verificado y qué no

**Verificado en este repositorio:** sintaxis (parser), firmas/tipos v6 (lint + autoprueba) y ejecución
real de la lógica, el panel y el footprint (PineTS, datos sintéticos **y** datos reales de
Binance: BTCUSDT 15m con delta intrabar, panel coherente y cero NaN post-warmup).

### Integración continua (GitHub Actions)

El workflow [`.github/workflows/verify.yml`](../.github/workflows/verify.yml) ejecuta
`bash verify/verify_all.sh` en **cada push y pull request** (y a mano con *Run workflow*):

- el resultado aparece como **check** en el PR y en la pestaña **Actions** del repo;
- la pestaña del run muestra un **resumen** con el resultado de los 5 pasos;
- el **log completo** queda como artefacto `verify-report` (14 días).

Fija las versiones de las herramientas (`pynescript==0.3.0`, `pinets@0.13.1`) para que el CI no
dependa de instalar nada a mano; si la verificación falla, el check se pone en rojo y el job corta.

**No verificado:** la compilación en el compilador de TradingView. PineTS es un runtime independiente
y puede no cubrir al 100 % detalles del motor propietario; el paso final es pegar el script en el Pine
Editor y pulsar *Guardar*. Tampoco se ha probado con una cuenta Premium.

## Avisos

- El **delta es estimado** por movimiento de precio intrabar (igual que el CVD de TradingView), no
  volumen bid/ask real.
- En símbolos sin volumen real (muchos forex/CFD) el volumen es de ticks: el panel lo indica como
  `TICK VOL` y el delta pierde significado direccional.
