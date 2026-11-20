#!/usr/bin/env python3
"""Ensambla los entregables grandes desde sus partes versionadas.

Los archivos >10KB se guardan en el repo como partes (verify/parts/*,
quant-flow/src/*) y este script los concatena de forma determinista,
verificando el sha256 final. verify_all.sh lo ejecuta como paso 0 y el
workflow de CI lo usa para publicar los archivos ensamblados.

Uso: python3 verify/assemble.py [--check]   (--check: solo verifica)
"""
import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# (salida, [partes en orden], sha256 esperado del ensamblado)
TARGETS = [
    ("verify/pine_v6_lint.py",
     ["verify/parts/lint.01", "verify/parts/lint.02", "verify/parts/lint.03"],
     "596f675c93cf20d088e38c5060128934e43133bffc810d3438c11a98f5de5bfa"),
    ("verify/verify_runtime.mjs",
     ["verify/parts/rt.01", "verify/parts/rt.02", "verify/parts/rt.03",
      "verify/parts/rt.04", "verify/parts/rt.05"],
     "dceae37152140ece0bea800343978f478416b1f8ee0854a3712e6becf90d6b46"),
    ("quant-flow/QuantumFlowAnalyzer_v6.pine",
     ["quant-flow/src/qfa.01", "quant-flow/src/qfa.02", "quant-flow/src/qfa.03",
      "quant-flow/src/qfa.04", "quant-flow/src/qfa.05", "quant-flow/src/qfa.06"],
     "faf6f523b00f3d8c41b54a40b662dbbd5ea0d5b570596ebc29b1382cfdafb791"),
]


def assemble(check_only=False):
    ok = True
    for rel, parts, want in TARGETS:
        blob = b"".join(open(os.path.join(ROOT, p), "rb").read() for p in parts)
        got = hashlib.sha256(blob).hexdigest()
        if got != want:
            print(f"ASSEMBLE FAIL {rel}: sha256 {got} != esperado {want}")
            ok = False
            continue
        if not check_only:
            with open(os.path.join(ROOT, rel), "wb") as fh:
                fh.write(blob)
        print(f"OK {rel} ({len(blob)} bytes, sha256 {got[:16]}...)")
    return ok


if __name__ == "__main__":
    only_check = "--check" in sys.argv[1:]
    sys.exit(0 if assemble(only_check) else 1)
