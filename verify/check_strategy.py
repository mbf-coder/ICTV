#!/usr/bin/env python3
"""Checklist de la estrategia QuantumFlowStrategy_v6.pine: entradas por impulso
de volumen + fuerza ADX + dominancia, score con los pesos del indicador,
salidas ATR/trailing/cierres y gestion de riesgo de cuenta.

Uso: python3 verify/check_strategy.py [archivo.pine]
"""
import os
import re
import sys

TARGET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "quant-flow", "QuantumFlowStrategy_v6.pine")

SRC = open(TARGET, encoding="utf-8").read()

CHECKS = [
    ("estrategia v6", r"^//@version=6", "falta //@version=6"),
    ("declaracion strategy overlay", r'strategy\(\s*"Quantum Flow Strategy', "falta strategy(...)"),
    ("sizing % equity", r"default_qty_type\s*=\s*strategy\.percent_of_equity", "falta sizing % equity"),
    ("comision % + slippage", r"commission_type\s*=\s*strategy\.commission\.percent[\s\S]*slippage\s*=", "falta comision/slippage"),
    ("sin piramidado", r"pyramiding\s*=\s*0", "falta pyramiding = 0"),
    ("riesgo: max drawdown", r"strategy\.risk\.max_drawdown\(", "falta max_drawdown"),
    ("riesgo: max perdida intradia", r"strategy\.risk\.max_intraday_loss\(", "falta max_intraday_loss"),
    ("ventana de fechas", r"fromDate[\s\S]*toDate", "falta ventana de backtest"),
    ("interruptores long/short", r"allowLng[\s\S]*allowSht", "faltan toggles de direccion"),
    ("impulso de volumen", r"relVol\s*>=\s*impMin[\s\S]*atrVal\s*\*\s*rangeK", "falta impulso volumen+rango"),
    ("ADX con ta.dmi", r"ta\.dmi\(", "falta ta.dmi"),
    ("ADX minimo + creciente + gap DI", r"adxVal\s*>=\s*adxMin[\s\S]*adxRise[\s\S]*diGap", "falta filtro ADX completo"),
    ("dominancia compradora/vendedora", r"control\s*>=\s*domLong[\s\S]*control\s*<=\s*domShrt", "falta dominancia"),
    ("score 5 factores con pesos", r"tScore\s*\*\s*wTrend[\s\S]*aScore\s*\*\s*wAdx[\s\S]*oScore\s*\*\s*wOF", "falta score ponderado"),
    ("entradas long/short", r'strategy\.entry\("QFL",\s*strategy\.long[\s\S]*strategy\.entry\("QFS",\s*strategy\.short', "faltan entradas"),
    ("salidas stop/limit ATR", r"strategy\.exit\([\s\S]*?from_entry[\s\S]*?stop\s*=[\s\S]*?limit\s*=", "falta stop/limit ATR"),
    ("trailing", r"trail_price[\s\S]*trail_offset", "falta trailing"),
    ("cierre en senal opuesta", r"oppExit[\s\S]*strategy\.close\(", "falta cierre por giro"),
    ("cierre fuera de sesion", r"sesExit[\s\S]*strategy\.close_all\(", "falta cierre por sesion"),
    ("cierre por tiempo/max barras", r"maxBars[\s\S]*strategy\.opentrades\.entry_bar_index", "falta cierre por tiempo"),
    ("filtro killzone LON/NY", r"lonSess[\s\S]*nySess[\s\S]*inKill", "falta filtro de sesion"),
    ("marcas de entrada", r"plotshape\(longSig[\s\S]*plotshape\(shortSig", "faltan marcas"),
    ("alertas", r"alertcondition\(", "faltan alertas"),
]


def main():
    failures = 0
    print(f"archivo: {os.path.relpath(TARGET)}")
    for label, pattern, message in CHECKS:
        ok = re.search(pattern, SRC, re.M) is not None
        print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f" — {message}"))
        failures += 0 if ok else 1
    print(f"\nRESUMEN STRATEGY: {len(CHECKS) - failures}/{len(CHECKS)} requisitos presentes")
    print("RESULTADO:", "OK" if failures == 0 else "FALLO")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
