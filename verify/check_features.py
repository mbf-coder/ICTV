#!/usr/bin/env python3
"""Paso 5: comprueba que el entregable contiene todo lo pedido en la misión
(panel con decisión, footprint con toggle, OB SMC con mitigación, zonas,
ADX/momentum/EMAs/CVD/delta y alertas). No valida sintaxis: eso lo hace el lint.

Uso: python3 verify/check_features.py [archivo.pine]
"""
import os
import re
import sys

TARGET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "quant-flow", "QuantumFlowAnalyzer_v6.pine")

SRC = open(TARGET, encoding="utf-8").read()

CHECKS = [
    ("indicador overlay v6", r"^//@version=6", "falta //@version=6"),
    ("declaración indicator overlay", r'indicator\(\s*"Quantum Flow Analyzer', "falta indicator(...)"),
    ("panel: 29 filas × 4 columnas", r"table\.new\(dashPosition,\s*4,\s*29", "no se crea el panel de 29 filas"),
    ("panel: 5 secciones", r"▌ VOLUMEN & ORDERFLOW[\s\S]*▌ TENDENCIA & MOMENTUM[\s\S]*▌ ZONAS & SMC[\s\S]*▌ VOLATILIDAD & RIESGO[\s\S]*▌ DECISIÓN CUÁNTICA",
     "faltan secciones del panel"),
    ("decisión: 5 estados", r'(?=[\s\S]*"FUERTE COMPRA")(?=[\s\S]*"FUERTE VENTA")(?=[\s\S]*"COMPRA")(?=[\s\S]*"VENTA")(?=[\s\S]*"ESPERAR")',
     "faltan estados de decisión"),
    ("fila de decisión en el panel", r'fCell\(dash, 0, 26, decision,', "no se pinta la fila de decisión"),
    ("control compradores/vendedores", r'buyersInControl\s*=\s*controlPct >= 50', "falta el cálculo de control"),
    ("volumen real + tipo", r"syminfo\.volumetype", "no se informa el tipo de volumen"),
    ("delta de velas", r"buyVol|sellVol", "falta el motor de delta"),
    ("CVD", r"var float cvd", "falta CVD"),
    ("ADX con ta.dmi", r"ta\.dmi\(", "falta ta.dmi"),
    ("momentum", r"ta\.mom\(", "falta ta.mom"),
    ("4 EMAs", r"ta\.ema\(close, lenE1\)[\s\S]*ta\.ema\(close, lenE4\)", "faltan EMAs"),
    ("order blocks SMC", r"box\.new\(bar_index - obIdx", "falta la creación de order blocks"),
    ("mitigación de order blocks", r"mDir == 1 \? close < mBot", "falta la mitigación de OB"),
    ("OB: registro de toques", r"obTouchN|obTouched", "falta el registro de toques del OB"),
    ("OB: mitigación registrada", r"obMitigN|OB alcista.{0,10} mitigado|OB bajista.{0,10} mitigado", "falta el estado de mitigación del OB"),
    ("OB: invalidación", r"obInvalidN|invalidado", "falta la invalidación del OB"),
    ("OB: limpieza automática de rotos", r"box\.delete\(mb\)[\s\S]*array\.remove\(obBoxes", "no se limpian los OBs rotos"),
    ("BOS / CHoCH", r"chochUp|chochDn", "faltan BOS/CHoCH"),
    ("FVG", r"bullFvg|bearFvg", "faltan FVG"),
    ("zonas de interés", r"zoneBuy\s*=|zoneSell\s*=", "faltan zonas de interés"),
    ("premium / discount", r"rangePos", "falta premium/discount"),
    ("footprint con interruptor", r'input\.bool\(false, "Activar footprint', "falta el toggle del footprint"),
    ("footprint: tabla de compra/venta/delta", r'"COMPRA"[\s\S]*"VENTA"[\s\S]*"DELTA"', "falta la tabla de footprint"),
    ("perfil POC/VAH/VAL", r"pocPrice|vahPrice|valPrice", "falta el perfil de volumen"),
    ("alertas", r"alertcondition\(", "faltan alertas"),
    ("warmup / carga de datos", r"CARGANDO DATOS", "falta el estado de carga"),
    ("perfiles por símbolo/timeframe", r'input\.string\("Auto", "Perfil de par', "falta el selector de perfil"),
    ("perfil activo resuelto", r"profKey", "falta la resolución del perfil activo"),
    ("parámetros efectivos del perfil", r"effStrongTh[\s\S]*effAdxMin[\s\S]*effOfDK", "faltan los parámetros efectivos score/ADX/delta"),
    ("filtro de sesiones Londres/NY", r"useSess[\s\S]*londonSess[\s\S]*nySess[\s\S]*sessPenalty", "falta el filtro de sesiones Londres/NY"),
    ("killzones atenúan el score", r"sessMult[\s\S]*scoreRaw \* sessMult", "el score no se atenúa fuera de sesión"),
    ("FUERTE solo en killzone", r"allowStrong", "falta el bloqueo de FUERTE fuera de sesión"),
    ("sesión visible en el panel", r"Sesión LON/NY[\s\S]*sessTxt", "la sesión no se muestra en el panel"),
    ("backtest: banderas SIG FUERTE exportadas", r"SIG FUERTE COMPRA[\s\S]*SIG FUERTE VENTA", "faltan las banderas de señal para el backtest"),
    ("modo de panel Completo/Mobile/Predictor", r'input\.string\("Completo", "Modo de panel"', "falta el selector de modo de panel"),
    ("horizonte de prediccion", r"predHorizon", "falta el horizonte del predictor"),
    ("RSI de confirmacion", r"ta\.rsi\(", "falta RSI"),
    ("fuerza de tendencia", r"trendPower", "falta la fuerza de tendencia"),
    ("direccion de tendencia", r"trendDir", "falta la direccion de tendencia"),
    ("precio predicho", r"predPrice", "falta el precio predicho"),
    ("probabilidad direccional", r"probUp", "falta la probabilidad"),
    ("motivo con pronostico", r"motivoTxt", "el motivo no incluye el pronostico"),
    ("pie con pronostico mobile", r"pieTxt", "el pie no incluye el pronostico"),
]


def main():
    failures = 0
    print(f"archivo: {os.path.relpath(TARGET)}")
    for label, pattern, message in CHECKS:
        ok = re.search(pattern, SRC, re.M) is not None
        print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f" — {message}"))
        failures += 0 if ok else 1
    alerts = len(re.findall(r"alertcondition\(", SRC))
    print(f"  INFO  alertas definidas: {alerts}")
    print(f"\nRESUMEN FEATURES: {len(CHECKS) - failures}/{len(CHECKS)} requisitos presentes")
    print("RESULTADO:", "OK" if failures == 0 else "FALLO")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
