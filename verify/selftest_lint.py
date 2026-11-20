#!/usr/bin/env python3
"""Autoprueba del validador: inyecta defectos conocidos en copias del script y
comprueba que el linter los detecta con el código esperado.

Sin esto, un linter que no encontrara ninguna llamada también daría 0 errores.
Uso: python3 verify/selftest_lint.py
"""
import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "..", "quant-flow", "QuantumFlowAnalyzer_v6.pine")
REF = json.load(open(os.path.join(HERE, "v6_reference.json"), encoding="utf-8"))

spec = importlib.util.spec_from_file_location("pine_v6_lint", os.path.join(HERE, "pine_v6_lint.py"))
lint_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lint_mod)

SRC = open(TARGET, encoding="utf-8").read()

# (etiqueta, fragmento base en el entregable o None, parche o fuente completa, código esperado)
# Con base: se reemplaza 1 vez en el .pine. Sin base (None): la fuente es un script mínimo.
CASES = [
    ("S010 función inexistente", "ta.ema(close, lenE1)", "ta.emma(close, lenE1)", "S010"),
    ("S013 demasiados posicionales", "ta.ema(close, lenE1)", "ta.ema(close, lenE1, 3)", "S013"),
    ("S014 argumento inexistente", "ta.ema(close, lenE1)", "ta.ema(close, lenE1, foo = 3)", "S014"),
    ("S011 nombrado duplicado", "ta.ema(close, lenE1)", "ta.ema(close, lenE1, length = 1, length = 2)", "S011"),
    ("S012 posicional tras nombrado", "ta.ema(close, lenE1)", "ta.ema(source = close, lenE1)", "S012"),
    ("V101 transp= eliminado", "plot(showEMA ? ema1 : na, \"EMA rápida\"",
     "plot(showEMA ? ema1 : na, \"EMA rápida\", transp = 10", "V101"),
    ("V102 when= eliminado", "plot(showEMA ? ema1 : na, \"EMA rápida\"",
     "plot(showEMA ? ema1 : na, \"EMA rápida\", when = barstate.islast", "V102"),
    ("V104 na() sobre bool", "var bool dashInit = false",
     "var bool dashInit = false\n\nbool zzFlag = true\n\nplot(na(zzFlag) ? 1 : 0, \"zzFlag\")", "V104"),
    ("V105 comparación con na", "var bool dashInit = false",
     "var bool dashInit = false\n\nplot(close == na ? 1 : 0, \"zzNaCmp\")", "V105"),
    ("V106 condición numérica", "if not warmupOk", "if 1", "V106"),
    ("V107 var sin tipo inicializado en na", "var bool dashInit = false",
     "var bool dashInit = false\n\nvar zzNoType = na", "V107"),
    ("T201 formato no constante en str.tostring", "var bool dashInit = false",
     "var bool dashInit = false\n\nplot(str.tostring(close, zzFmt) == \"\" ? 1 : 0, \"zzFmt\")", "T201"),
    ("T206 enum inválido en table.cell", "var bool dashInit = false",
     "var bool dashInit = false\n\nif barstate.islast\n    table.cell(dash, 0, 1, \"zz\", text_halign = \"left\")", "T206"),
    ("T210 receptor con tipo incorrecto", "var bool dashInit = false",
     "var bool dashInit = false\n\nfloat zzBox = box.get_top(dash)", "T210"),
    ("R301 plot en ámbito local", "var bool dashInit = false",
     "var bool dashInit = false\n\nif barstate.islast\n    plot(close, \"zzPlot\")", "R301"),
    ("R304 := a variable no declarada", "var bool dashInit = false",
     "var bool dashInit = false\n\nzzNoDeclarada := 1", "R304"),
    ("T209 security_lower_tf sin tupla", "var bool dashInit = false",
     "var bool dashInit = false\n\nzz = request.security_lower_tf(syminfo.tickerid, \"1\", close)", "T209"),
    ("T208 array intrabar sin guarda de tamaño", None, """
//@version=6
indicator("t208")
[a, b] = request.security_lower_tf(syminfo.tickerid, "1", [open, close], ignore_invalid_timeframe = true)
plot(array.get(a, 0), "x")
""", "T208"),
]


def run_lint(path):
    linter = lint_mod.Linter(path, REF)
    linter.run()
    return linter.findings


def main():
    failures = 0
    print(f"autoprueba del validador · {len(CASES)} defectos inyectados\n")
    for label, old, new, expected in CASES:
        if old is None:
            mutated = new
        elif old not in SRC:
            print(f"  SKIP  {label}: no se encontró el fragmento base")
            failures += 1
            continue
        else:
            mutated = SRC.replace(old, new, 1)
        with tempfile.NamedTemporaryFile("w", suffix=".pine", delete=False, encoding="utf-8") as fh:
            fh.write(mutated)
            tmp = fh.name
        try:
            findings = run_lint(tmp)
            codes = {f.code for f in findings if f.severity == "error"}
            ok = expected in codes
            print(f"  {'PASS' if ok else 'FAIL'}  {label}: esperado {expected} · detectado {sorted(codes) if codes else 'nada'}")
            failures += 0 if ok else 1
        finally:
            os.unlink(tmp)

    total = len(CASES)
    print(f"\nRESUMEN AUTOPRUEBA: {total - failures}/{total} defectos detectados")
    print("RESULTADO:", "OK" if failures == 0 else "FALLO")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
