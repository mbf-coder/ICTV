#!/usr/bin/env python3
"""Validador estático de Pine Script v6 para QuantumFlowAnalyzer_v6.pine.

Compara cada llamada del script contra las firmas reales extraídas de la
referencia oficial v6 (verify/v6_reference.json, generado por build_ref.py) y
aplica las reglas de tipos/migración de v6.

Uso:  python3 verify/pine_v6_lint.py [archivo.pine]
Salida: informe por categoría + lista archivo:línea. Exit 0 solo si errores == 0.

Códigos
  S0xx sintaxis/estructura      V1xx migración y reglas v6
  T2xx tipos                    R3xx estructura del script
"""
import bisect
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REF_PATH = os.path.join(HERE, "v6_reference.json")
DEFAULT_TARGET = os.path.join(HERE, "..", "quant-flow", "QuantumFlowAnalyzer_v6.pine")

# argumentos mínimos curados (la referencia no marca "required" de forma fiable
# en todos los casos; sólo se exige lo que Pine rechaza con seguridad)
MIN_ARGS = {
    "indicator": 0, "strategy": 0, "plot": 1, "plotshape": 1, "plotchar": 1,
    "table.new": 3, "table.cell": 3, "table.merge_cells": 5, "table.delete": 1,
    "box.new": 2, "box.delete": 1, "line.new": 2, "line.delete": 1,
    "label.new": 2, "label.delete": 1, "array.new": 0, "array.push": 2,
    "array.get": 2, "array.set": 3, "array.shift": 1, "array.remove": 2,
    "alertcondition": 1, "request.security_lower_tf": 3, "request.security": 3,
    "input.int": 1, "input.float": 1, "input.bool": 1, "input.string": 1,
    "input.timeframe": 1, "input.color": 1, "str.tostring": 1, "str.format": 1,
    "math.max": 2, "math.min": 2, "math.round": 1, "math.abs": 1,
    "ta.sma": 2, "ta.ema": 2, "ta.rma": 2, "ta.atr": 1, "ta.dmi": 2,
    "ta.mom": 2, "ta.roc": 2, "ta.vwap": 1, "ta.highest": 2, "ta.lowest": 2,
    "ta.pivothigh": 3, "ta.pivotlow": 3, "ta.crossover": 2, "ta.crossunder": 2,
    "color.new": 1, "color.rgb": 3, "timeframe.change": 1,
}

# funciones permitidas como "cast"/constructor de tipos
CASTS = {"float", "int", "bool", "string", "color", "line", "label", "box", "table",
         "array", "matrix", "map", "polyline", "linefill", "chart.point",
         "series", "simple", "const", "input"}

KEYWORDS = {"if", "else", "for", "while", "switch", "and", "or", "not", "in", "to",
            "by", "break", "continue", "var", "varip", "import", "export", "type",
            "method", "enum", "true", "false", "na", "return"}

ENUM_NAMESPACES = ("text.align_", "size.", "position.", "plot.style_", "label.style_",
                   "line.style_", "shape.", "location.", "extend.", "xloc.", "yloc.",
                   "display.", "format.", "font.family_", "barmerge.", "scale.",
                   "order.", "alert.freq_", "hline.style_", "currency.", "session.",
                   "strategy.", "math.")


class Finding:
    __slots__ = ("code", "line", "col", "msg", "severity")

    def __init__(self, code, line, msg, severity="error", col=0):
        self.code, self.line, self.msg, self.severity, self.col = code, line, msg, severity, col

    def __str__(self):
        return f"{self.severity.upper():7} {self.code} línea {self.line}: {self.msg}"


def line_starts(text):
    starts = [0]
    for m in re.finditer("\n", text):
        starts.append(m.end())
    return starts


def line_of(starts, offset):
    return bisect.bisect_right(starts, offset)


def mask_strings(text):
    """Sustituye el contenido de los literales por \x01 para poder parsear
    sin que comas/paréntesis dentro de strings rompan el análisis."""
    return re.sub(r'"(?:[^"\\]|\\.)*"', '"\x01"', text)


def strip_comment(line):
    out, in_str = [], False
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == '"':
            in_str = not in_str
        if not in_str and ch == "/" and i + 1 < len(line) and line[i + 1] == "/":
            break
        out.append(ch)
        i += 1
    return "".join(out)


def blank_comments(text):
    """Reemplaza los comentarios por espacios conservando offsets y líneas."""
    out = []
    for line in text.split("\n"):
        code = strip_comment(line)
        out.append(code + " " * (len(line) - len(code)))
    return "\n".join(out)


def split_args(argtext):
    """Divide argumentos de nivel superior respetando paréntesis/corchetes."""
    args, depth, cur = [], 0, ""
    for ch in argtext:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            args.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip() or argtext.strip():
        args.append(cur.strip())
    return [a for a in args if a != ""]


NAMED_RE = re.compile(r"^([A-Za-z_]\w*)\s*=(?!=)\s*(.*)$", re.S)


def classify_args(args):
    pos, named, order, dup = [], {}, [], []
    seen_named = False
    for a in args:
        m = NAMED_RE.match(a)
        if m and not a.lstrip().startswith(("==", ">=", "<=", "!=")):
            name, val = m.group(1), m.group(2).strip()
            if name in named:
                dup.append(name)
            named[name] = val
            order.append(("named", name, val))
            seen_named = True
        else:
            pos.append(a)
            order.append(("pos", a, a))
    return pos, named, order, dup
