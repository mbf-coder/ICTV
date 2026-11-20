#!/usr/bin/env python3
"""Paso 1 de verificación: parsea el .pine con pynescript (gramática Pine real)
y falla si hay cualquier error de sintaxis.

Uso: .venv/bin/python verify/parse_pynescript.py [archivo.pine]
"""
import dataclasses
import os
import sys

TARGET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "quant-flow", "QuantumFlowAnalyzer_v6.pine")

try:
    from pynescript.ast import parse
except ImportError:
    print("FALTA pynescript: instala con  .venv/bin/pip install pynescript")
    sys.exit(2)


def count_nodes(node, depth=0):
    if depth > 80:
        return 0
    total = 1
    if dataclasses.is_dataclass(node):
        for f in dataclasses.fields(node):
            val = getattr(node, f.name)
            if isinstance(val, list):
                for item in val:
                    total += count_nodes(item, depth + 1)
            elif dataclasses.is_dataclass(val):
                total += count_nodes(val, depth + 1)
    return total


def main():
    src = open(TARGET, encoding="utf-8").read()
    print(f"archivo: {os.path.relpath(TARGET)} · {len(src.splitlines())} líneas")
    print(f"versión declarada: {src.splitlines()[0].strip()}")
    try:
        tree = parse(src, os.path.basename(TARGET))
    except Exception as exc:  # noqa: BLE001
        print(f"PARSE FALLO: {type(exc).__name__}: {exc}")
        return 1
    body = getattr(tree, "body", [])
    print(f"PARSE OK · sentencias de nivel superior: {len(body)} · nodos AST: {count_nodes(tree)}")
    print("RESULTADO: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
