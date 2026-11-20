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


class Linter:
    def __init__(self, path, ref):
        self.path = path
        self.raw = open(path, encoding="utf-8").read()
        self.lines = self.raw.split("\n")
        self.masked = mask_strings(self.raw)
        self.code = blank_comments(self.masked)
        self.starts = line_starts(self.code)
        self.ref = ref
        self.functions = ref["functions"]
        self.findings = []
        self._index_declarations()

    # ── utilidades ────────────────────────────────────────────────────────────
    def add(self, code, line, msg, severity="error"):
        self.findings.append(Finding(code, line, msg, severity))

    def is_builtin_name(self, name):
        if name in self.functions or name in CASTS or name in KEYWORDS:
            return True
        if name in self.user_funcs:
            return True
        return False

    # ── índice de declaraciones / funciones de usuario / tipos ───────────────
    def _index_declarations(self):
        self.user_funcs = {}
        self.declared = {}
        self.var_init = {}
        self.var_type = {}
        self.type_decls = {}
        self.bool_vars = set()
        self.intrabar_arrays = []

        type_re = (r"(?:float|int|bool|string|color|line|label|box|table|plot|"
                   r"array<[^>]+>|matrix<[^>]+>|map<[^>]+>|linefill|polyline|chart\.point)")
        decl_typed = re.compile(rf"^\s*(?:var\s+|varip\s+)?({type_re})\s+([A-Za-z_]\w*)\s*=(.*)$")
        decl_var = re.compile(r"^\s*(?:var\s+|varip\s+)([A-Za-z_]\w*)\s*=(.*)$")
        decl_plain = re.compile(r"^\s*([A-Za-z_]\w*)\s*=(?!=)\s*(.*)$")
        decl_tuple = re.compile(r"^\s*\[([^\]]+)\]\s*=(.*)$")
        fundef = re.compile(r"^\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=>")

        for idx, raw in enumerate(self.lines):
            line = strip_comment(raw)
            if not line.strip():
                continue
            indent = len(line) - len(line.lstrip(" "))

            m = fundef.match(line)
            if m:
                name = m.group(1)
                raw_params = [p.strip() for p in m.group(2).split(",") if p.strip()]
                params = [p.split("=")[0].strip() for p in raw_params]
                self.user_funcs[name] = params
                for rp in raw_params:
                    bits = rp.split()
                    if len(bits) >= 2:
                        pname = bits[-1].split("=")[0]
                        ptype = " ".join(bits[:-1])
                        base = ptype.split("<")[0].strip()
                        self.var_type[pname] = base
                        self.type_decls.setdefault(pname, []).append((0, 0, base))
                        self.declared.setdefault(pname, idx + 1)
                continue

            m = decl_tuple.match(line)
            if m:
                rhs = m.group(2)
                names = [n.strip() for n in m.group(1).split(",")]
                for n in names:
                    if re.fullmatch(r"[A-Za-z_]\w*", n):
                        self.declared.setdefault(n, idx + 1)
                        self.var_init[n] = ""
                if "request.security_lower_tf" in rhs:
                    self.intrabar_arrays.extend(names)
                continue

            m = decl_typed.match(line)
            if m:
                typ, name, rhs = m.group(1), m.group(2), m.group(3)
                self.declared.setdefault(name, idx + 1)
                self.var_init[name] = rhs.strip()
                base = typ.split("<")[0].strip()
                self.var_type[name] = base
                self.type_decls.setdefault(name, []).append((idx + 1, indent, base))
                if typ == "bool":
                    self.bool_vars.add(name)
                continue

            m = decl_var.match(line)
            if m:
                name, rhs = m.group(1), m.group(2)
                self.declared.setdefault(name, idx + 1)
                self.var_init[name] = rhs.strip()
                if re.search(r"(>=|<=|==|!=|>|<|\band\b|\bor\b|\bnot\b|\btrue\b|\bfalse\b)", rhs):
                    self.bool_vars.add(name)
                continue

            m = decl_plain.match(line)
            if m and indent == 0:
                name, rhs = m.group(1), m.group(2)
                self.declared.setdefault(name, idx + 1)
                self.var_init[name] = rhs.strip()
                if re.search(r"(>=|<=|==|!=|>|<|\band\b|\bor\b|\bnot\b|\btrue\b|\bfalse\b)", rhs):
                    self.bool_vars.add(name)
                continue

            # variables de bucle
            for fm in re.finditer(r"\bfor\s+([A-Za-z_]\w*)\s*=", line):
                self.declared.setdefault(fm.group(1), idx + 1)
            for fm in re.finditer(r"\bfor\s+\[([^\]]+)\]\s+in\b", line):
                for n in fm.group(1).split(","):
                    self.declared.setdefault(n.strip(), idx + 1)

    # ── extracción de llamadas ───────────────────────────────────────────────
    def calls(self):
        pattern = re.compile(r"(?<![\w.])([A-Za-z_][\w.]*)\s*(?:<[^<>()]*>)?\s*\(")
        for m in pattern.finditer(self.code):
            name = m.group(1)
            if name in ("if", "for", "while", "switch", "and", "or", "not", "in"):
                continue
            open_idx = m.end() - 1
            depth, i = 0, open_idx
            while i < len(self.code):
                ch = self.code[i]
                if ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            if depth != 0:
                yield name, "", line_of(self.starts, m.start()), True, m.start()
                continue
            argtext = self.masked[open_idx + 1:i]
            after = self.code[i + 1:i + 4]
            is_def = after.lstrip().startswith("=>")
            yield name, argtext, line_of(self.starts, m.start()), is_def, m.start()

    # ── resolución de valores enum ───────────────────────────────────────────
    def resolves_to(self, value, allowed, depth=0):
        """True si `value` es un valor permitido o una variable cuyo inicializador
        sólo usa valores permitidos."""
        value = value.strip()
        if not value:
            return False
        if value in allowed:
            return True
        if depth > 3:
            return False
        if re.fullmatch(r"[A-Za-z_]\w*", value) and value in self.var_init:
            init = self.var_init[value]
            if init:
                tokens = re.findall(r"[A-Za-z_][\w.]*", init)
                cand = [t for t in tokens if any(t.startswith(p) for p in ENUM_NAMESPACES)]
                if cand and all(t in allowed for t in cand):
                    return True
                if any(t in allowed for t in tokens):
                    return all(t in allowed or not any(t.startswith(p) for p in ENUM_NAMESPACES) for t in tokens)
        return False

    # ── chequeos ─────────────────────────────────────────────────────────────
    NAMESPACES = {"ta", "math", "str", "array", "box", "line", "label", "table", "color",
                  "input", "plot", "display", "format", "font", "size", "text", "position",
                  "request", "strategy", "alert", "chart", "currency", "session", "ticker",
                  "dayofweek", "extend", "xloc", "yloc", "shape", "location", "scale", "order",
                  "hline", "linefill", "matrix", "map", "polyline", "runtime", "barmerge",
                  "adjustment", "backadjustment", "settlement_as_close", "earnings", "dividends",
                  "splits", "syminfo", "barstate", "timeframe", "plotshape", "hline_style",
                  "log", "polyline_style", "time"}

    def check_identifiers(self):
        known = set(self.declared) | set(self.user_funcs) | set(self.functions) | set(CASTS)
        known |= set(KEYWORDS) | self.NAMESPACES
        for v in self.ref.get("variables", []) + self.ref.get("constants", []):
            known.add(v)
            known.add(v.split(".")[-1])
        for idx, line in enumerate(self.code.split("\n")):
            for m in re.finditer(r"(?<![\w.])([A-Za-z_]\w*)(?![\w.])", line):
                name = m.group(1)
                if name in known:
                    continue
                before = line[max(0, m.start() - 1):m.start()]
                if before in ('"', "#"):
                    continue
                rest = line[m.end():]
                if re.match(r"\s*=(?!=)", rest):  # clave de argumento nombrado
                    continue
                if re.match(r"\s*:=", rest):
                    continue
                self.add("W001", idx + 1, f"identificador no declarado: '{name}'", severity="warning")

    def run(self):
        self.call_count = 0
        self.check_header()
        self.check_indentation()
        self.check_calls()
        self.check_v6_rules()
        self.check_structure()
        self.check_contracts()
        self.check_identifiers()
        return self.findings

    def check_header(self):
        first = self.raw.split("\n", 1)[0].strip()
        if first != "//@version=6":
            self.add("S001", 1, f'la primera línea debe ser "//@version=6" (encontrado: {first!r})')
        decls = re.findall(r"^(indicator|strategy|library)\s*\(", self.raw, re.M)
        if len(decls) != 1:
            self.add("S002", 1, f"debe haber exactamente una declaración global indicator/strategy/library (hay {len(decls)})")

    def check_indentation(self):
        depth = 0
        prev_code = ""
        for idx, raw in enumerate(self.masked.split("\n")):
            code = strip_comment(raw)
            if not code.strip():
                continue
            if depth == 0 and not prev_code.rstrip().endswith(("?", ":", ",", "+", "-", "*", "/", "=", "and", "or")):
                indent = len(code) - len(code.lstrip(" "))
                if indent % 4 != 0:
                    self.add("S003", idx + 1, f"indentación {indent} no es múltiplo de 4")
            depth += code.count("(") + code.count("[") - code.count(")") - code.count("]")
            if depth < 0:
                self.add("S004", idx + 1, "paréntesis/corchetes desbalanceados (cierre de más)")
                depth = 0
            prev_code = code

    RECEIVERS = {"table": "table", "box": "box", "label": "label", "line": "line",
                 "array": "array", "matrix": "matrix", "map": "map"}
    # primer parámetro que identifica al objeto receptor (no aplica a *.new)
    OBJ_FIRST = {"table_id", "id", "array_id", "matrix_id", "map_id"}

    def resolve_type(self, ident, line):
        entries = self.type_decls.get(ident)
        if not entries:
            return None
        before = [e for e in entries if e[0] <= line]
        if not before:
            return None
        before.sort(key=lambda e: (e[0], e[1]))
        return before[-1][2]

    def check_receiver_type(self, name, pos, ln):
        ns = name.split(".")[0]
        expected = self.RECEIVERS.get(ns)
        if not expected or not pos:
            return
        params = self.functions[name]["params"]
        if not params or params[0] not in self.OBJ_FIRST:
            return  # p. ej. box.new(left, top, ...) no recibe un id
        target = pos[0].strip()
        if not re.fullmatch(r"[A-Za-z_]\w*", target):
            return
        got = self.resolve_type(target, ln)
        if got is None or got == expected:
            return
        self.add("T210", ln, f"{name}(): '{target}' es de tipo '{got}' y se espera un '{expected}'")

    def check_calls(self):
        self.call_count = 0
        for name, argtext, ln, is_def, offset in self.calls():
            if is_def:
                continue
            if name in self.user_funcs:
                continue
            # los cast/constructores de tipo (float(x), int(x)...) no son funciones v6
            if "." not in name and name in CASTS:
                continue
            self.call_count += 1
            if name not in self.functions:
                self.add("S010", ln, f"función desconocida: {name}() (no está en la referencia v6)")
                continue

            spec = self.functions[name]
            args = split_args(argtext)
            pos, named, order, dup = classify_args(args)
            self.check_receiver_type(name, pos, ln)

            for d in dup:
                self.add("S011", ln, f"argumento nombrado duplicado en {name}(): {d}")

            seen_named = False
            for kind, key, _val in order:
                if kind == "named":
                    seen_named = True
                elif seen_named:
                    self.add("S012", ln, f"argumento posicional después de uno nombrado en {name}()")

            if len(pos) > spec["max_positional"]:
                self.add("S013", ln,
                         f"demasiados argumentos posicionales en {name}(): {len(pos)} > {spec['max_positional']}")

            valid_params = set(spec["params"])
            for pname in named:
                if pname not in valid_params:
                    if pname == "transp":
                        self.add("V101", ln,
                                 f"{name}() no acepta transp= en v6; usa color.new(color, transp)")
                    elif pname == "when":
                        self.add("V102", ln, f"{name}() no acepta when= en v6")
                    else:
                        self.add("S014", ln, f"argumento inexistente en {name}(): '{pname}' no es parámetro v6")

            if len(args) < MIN_ARGS.get(name, 1):
                self.add("S015", ln, f"{name}() requiere al menos {MIN_ARGS.get(name, 1)} argumento(s)")

            # valores enum documentados
            for pname, pval in named.items():
                allowed = spec["enums"].get(pname)
                if not allowed:
                    continue
                if not self.resolves_to(pval, allowed):
                    if re.fullmatch(r"[A-Za-z_]\w*", pval.strip()):
                        continue  # puede venir de un parámetro de función: lo cubre check_contracts
                    self.add("T206", ln,
                             f"{name}({pname} = {pval}): valor no documentado; permitidos {allowed}")
            # posición 0 con enum (p. ej. table.new(position, ...))
            if spec["enums"] and pos:
                first_param = spec["params"][0]
                allowed = spec["enums"].get(first_param)
                if allowed and not self.resolves_to(pos[0], allowed):
                    if not re.fullmatch(r"[A-Za-z_]\w*", pos[0].strip()):
                        self.add("T206", ln,
                                 f"{name}({first_param} = {pos[0]}): valor no documentado; permitidos {allowed}")

    def check_contracts(self):
        """fCell(...) recibe el tamaño y la alineación como parámetros; valida que
        cada llamada pase constantes size.* / text.align_*."""
        for fname, params in self.user_funcs.items():
            contracts = []
            # contratos: argumentos nombrados de funciones v6 cuyo valor es un parámetro
            body_re = re.compile(
                r"(table\.cell|table\.new|label\.new|line\.new|box\.new)\(([^;]*)\)")
            for idx, raw in enumerate(self.lines):
                for m in body_re.finditer(raw):
                    callee, argtext = m.group(1), m.group(2)
                    spec = self.functions.get(callee)
                    if not spec:
                        continue
                    _p, named, _o, _d = classify_args(split_args(argtext))
                    for pname, pval in named.items():
                        allowed = spec["enums"].get(pname)
                        if allowed and pval.strip() in params:
                            contracts.append((callee, pname, pval.strip(), allowed))
            if not contracts:
                continue
            for idx, raw in enumerate(self.lines):
                for m in re.finditer(rf"(?<![\w.]){re.escape(fname)}\s*\(", raw):
                    open_idx = m.end() - 1
                    depth, i = 0, open_idx
                    while i < len(raw):
                        if raw[i] == "(":
                            depth += 1
                        elif raw[i] == ")":
                            depth -= 1
                            if depth == 0:
                                break
                        i += 1
                    argtext = raw[open_idx + 1:i]
                    args = split_args(argtext)
                    pos, named, _o, _d = classify_args(args)
                    for callee, pname, pval, allowed in contracts:
                        pidx = params.index(pval)
                        value = None
                        if pval in named:
                            value = named[pval]
                        elif pidx < len(pos):
                            value = pos[pidx]
                        if value is None:
                            continue
                        if not self.resolves_to(value, allowed):
                            if re.fullmatch(r"[A-Za-z_]\w*", value.strip()):
                                continue
                            self.add("T207", idx + 1,
                                     f"{fname}(): '{value}' no es un valor válido para {callee}({pname}); "
                                     f"permitidos {allowed}")

    def check_v6_rules(self):
        for idx, raw in enumerate(self.masked.split("\n")):
            line = strip_comment(raw)
            ln = idx + 1

            if re.search(r"(?<![\w.])(study|security)\s*\(", line):
                self.add("V103", ln, "study()/security() son obsoletos; usa indicator()/request.security()")

            for m in re.finditer(r"\bna\s*\(\s*([A-Za-z_]\w*)\s*\)", line):
                if m.group(1) in self.bool_vars:
                    self.add("V104", ln, f"na() sobre el bool '{m.group(1)}': en v6 un bool no puede ser na")
            if re.search(r"(==|!=)\s*na\b", line):
                self.add("V105", ln, "comparación con na: en v6 usa la función na(x)")

            m = re.match(r"^\s*(if|while)\s+(.+)$", line)
            if m:
                cond = m.group(2).strip()
                if re.fullmatch(r"[-+]?\d+(\.\d+)?", cond):
                    self.add("V106", ln, f"condición numérica implícita en '{m.group(1)} {cond}': v6 exige un bool")

            m = re.match(r"^\s*(?:var|varip)\s+([A-Za-z_]\w*)\s*=\s*na\s*$", line)
            if m:
                self.add("V107", ln,
                         f"'{m.group(1)}' se inicializa en na sin tipo explícito; declara float/int/label/line/etc.")

            if re.search(r"str\.tostring\s*\(\s*[^,()]+,\s*([^)]+)\)", line):
                for m2 in re.finditer(r"str\.tostring\s*\(\s*([^,()]+(?:\([^)]*\))?[^,()]*),\s*([^)]+)\)", line):
                    fmt = m2.group(2).strip()
                    if not (fmt.startswith('"') or fmt.startswith("format.")):
                        self.add("T201", ln,
                                 f"str.tostring(..., {fmt}): el formato debe ser literal o constante format.*")

    def check_structure(self):
        # plot/barcolor/alertcondition/hline/fill en ámbito local
        for idx, raw in enumerate(self.masked.split("\n")):
            code = strip_comment(raw)
            if not code.strip():
                continue
            indent = len(code) - len(code.lstrip(" "))
            s = code.strip()
            if indent > 0 and re.match(r"(plot|plotshape|plotchar|plotcandle|plotbar|barcolor|bgcolor|alertcondition|hline|fill)\s*\(", s):
                self.add("R301", idx + 1, f"{s.split('(')[0]}() debe llamarse en el ámbito global")

        plots = len(re.findall(r"^\s*plot\s*\(", self.raw, re.M))
        if plots > 64:
            self.add("R302", 1, f"demasiados plot(): {plots} > 64")
        reqs = len(re.findall(r"request\.", self.raw))
        if reqs > 40:
            self.add("R303", 1, f"demasiadas llamadas request.*: {reqs} > 40")

        # := a variable no declarada
        for idx, raw in enumerate(self.masked.split("\n")):
            code = strip_comment(raw)
            for m in re.finditer(r"(?<![\w.])([A-Za-z_]\w*)\s*:=", code):
                name = m.group(1)
                if name not in self.declared and name not in self.user_funcs:
                    self.add("R304", idx + 1, f"asignación ':=' a variable no declarada: {name}")

        # arrays de intrabars sin comprobación de tamaño
        for arr in self.intrabar_arrays:
            uses = len(re.findall(rf"array\.(?:size|get)\s*\(\s*{re.escape(arr)}\b", self.raw))
            sizes = len(re.findall(rf"array\.size\s*\(\s*{re.escape(arr)}\b", self.raw))
            if uses and not sizes:
                self.add("T208", 1,
                         f"el array intrabar '{arr}' se indexa sin comprobar array.size (puede venir vacío)")

        # request.security_lower_tf debe recibir una tupla
        for idx, raw in enumerate(self.lines):
            if "request.security_lower_tf" not in raw:
                continue
            m = re.search(r"request\.security_lower_tf\s*\((.*)", raw)
            if m:
                args = split_args(m.group(1).rstrip(")\n"))
                if len(args) >= 3 and not args[2].lstrip().startswith("["):
                    self.add("T209", idx + 1,
                             "el 3.er argumento de request.security_lower_tf debe ser una tupla: [open, high, low, close, volume]")

        # funciones de usuario: parámetros duplicados / uso de tables fuera de ámbito
        for name, params in self.user_funcs.items():
            if len(params) != len(set(params)):
                self.add("R305", 1, f"función {name}(): parámetros duplicados")

    # ── informe ──────────────────────────────────────────────────────────────
    def report(self):
        errors = [f for f in self.findings if f.severity == "error"]
        warns = [f for f in self.findings if f.severity != "error"]
        cats = {}
        for f in errors:
            cats[f.code] = cats.get(f.code, 0) + 1
        print(f"archivo: {os.path.relpath(self.path)}")
        print(f"líneas: {len(self.lines)} · {self.call_count} llamadas a funciones v6 contrastadas "
              f"contra {len(self.functions)} firmas de la referencia")
        print(f"errores: {len(errors)} · avisos: {len(warns)}\n")
        if cats:
            print("errores por categoría:")
            for code in sorted(cats):
                print(f"  {code}: {cats[code]}")
            print()
        for f in sorted(errors, key=lambda x: (x.line, x.code)):
            print(" ", f)
        for f in sorted(warns, key=lambda x: (x.line, x.code)):
            print(" ", f)
        return len(errors)


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TARGET
    ref = json.load(open(REF_PATH, encoding="utf-8"))
    lint = Linter(target, ref)
    lint.run()
    errors = lint.report()
    print()
    print("RESULTADO:", "OK (0 errores v6)" if errors == 0 else f"FALLO ({errors} errores)")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
