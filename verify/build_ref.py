#!/usr/bin/env python3
"""Construye verify/v6_reference.json a partir del espejo markdown de la
referencia oficial Pine Script v6 (pine-script-reference de TradingView).

Fuente: https://github.com/chris-c-thomas/pine-script-v6-md
(replica de https://www.tradingview.com/pine-script-reference/v6/)

Salida: {"functions": {...}, "variables": [...], "constants": [...], "keywords": [...]}
"""
import json
import os
import re
import subprocess
import sys

REF_DIR = os.path.join(os.path.dirname(__file__), "ref")
REF = os.path.join(REF_DIR, "pine_ref", "pine-script-reference")
OUT = os.path.join(os.path.dirname(__file__), "v6_reference.json")
TARBALL_URL = "https://codeload.github.com/chris-c-thomas/pine-script-v6-md/tar.gz/refs/heads/main"


def ensure_reference():
    """Descarga el espejo markdown de la referencia v6 si aún no está extraído."""
    if os.path.isdir(REF):
        return
    os.makedirs(REF_DIR, exist_ok=True)
    tgz = os.path.join(REF_DIR, "repo.tgz")
    print("· descargando referencia v6 (espejo GitHub)…")
    subprocess.run(["curl", "-fsSL", "-o", tgz, TARBALL_URL], check=True)
    subprocess.run(["tar", "xzf", tgz, "-C", REF_DIR], check=True)
    extracted = os.path.join(REF_DIR, "pine-script-v6-md-main")
    os.rename(extracted, os.path.join(REF_DIR, "pine_ref"))
    os.unlink(tgz)

ARG_RE = re.compile(r"^\*\*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\*\*\s*(.*)$")


def parse_function(path):
    text = open(path, encoding="utf-8").read()
    title = re.search(r"^#\s+(.+?)\(\)\s*$", text, re.M)
    if not title:
        return None, None
    name = title.group(1).strip()

    # bloques de sintaxis
    syntax_blocks = re.findall(r"```\n([^\n]*?\([^\n]*?\)\s*→[^\n]*?)\n```", text)
    overloads = []
    for block in syntax_blocks:
        m = re.match(r"^([A-Za-z_][\w.]*(?:<[^>]*>)?)\s*\((.*)\)\s*→\s*(.+)$", block.strip())
        if not m:
            continue
        params_raw = m.group(2).strip()
        params = []
        variadic = False
        if params_raw:
            depth = 0
            cur = ""
            for ch in params_raw:
                if ch in "(<[":
                    depth += 1
                elif ch in ")>]":
                    depth -= 1
                if ch == "," and depth == 0:
                    params.append(cur.strip())
                    cur = ""
                else:
                    cur += ch
            params.append(cur.strip())
        clean = []
        for p in params:
            if p == "...":
                variadic = True
                continue
            clean.append(p.split("=")[0].strip())
        fname = re.sub(r"<[^>]*>", "", m.group(1)).strip()
        overloads.append({"params": clean, "ret": m.group(3).strip(), "name": fname})

    # argumentos: tipo, opcional, valores posibles
    args = {}
    for line in text.splitlines():
        m = ARG_RE.match(line.strip())
        if not m:
            continue
        pname, ptype, desc = m.group(1), m.group(2), m.group(3)
        optional = "Optional." in desc
        required = not optional
        possibles = []
        pm = re.search(r"Possible values(?: are)?:\s*(.+)$", desc)
        if pm:
            possibles = re.findall(r"([A-Za-z_][\w.]*\.[A-Za-z_]\w*)", pm.group(1))
        args[pname] = {"type": ptype, "optional": optional,
                       "required": required, "possible": possibles}

    if not overloads:
        return name, None
    # formas genéricas documentadas como array.new<type>(...), matrix.new<type>(...)
    name = re.sub(r"<[^>]*>", "", overloads[0].get("name", name)).strip()

    all_params = []
    for ov in overloads:
        for p in ov["params"]:
            if p not in all_params:
                all_params.append(p)
    required = [p for p in all_params if args.get(p, {}).get("required")]
    # requeridos por sobrecarga (los que no aparecen en "Arguments" se asumen requeridos)
    for ov in overloads:
        ov["required"] = [p for p in ov["params"] if args.get(p, {}).get("required", True)]
    return name, {
        "overloads": overloads,
        "params": all_params,
        "variadic": any("..." in s for s in syntax_blocks),
        "required": required,
        "enums": {p: a["possible"] for p, a in args.items() if a["possible"]},
        "types": {p: a["type"] for p, a in args.items()},
        "max_positional": max(len(ov["params"]) for ov in overloads),
    }


def parse_names(folder):
    out = []
    base = os.path.join(REF, folder)
    if not os.path.isdir(base):
        return out
    for fn in sorted(os.listdir(base)):
        if not fn.endswith(".md"):
            continue
        text = open(os.path.join(base, fn), encoding="utf-8").read()
        m = re.search(r"^#\s+(.+?)\s*$", text, re.M)
        if m:
            out.append(m.group(1).strip())
    return out


def main():
    ensure_reference()
    fdir = os.path.join(REF, "functions")
    functions = {}
    skipped = []
    for fn in sorted(os.listdir(fdir)):
        if not fn.endswith(".md"):
            continue
        try:
            name, data = parse_function(os.path.join(fdir, fn))
        except Exception as exc:  # noqa: BLE001
            skipped.append((fn, str(exc)))
            continue
        if not name or not data:
            skipped.append((fn, "sin sintaxis"))
            continue
        functions[name] = data

    payload = {
        "source": "TradingView Pine Script v6 reference (mirror chris-c-thomas/pine-script-v6-md)",
        "functions": functions,
        "variables": parse_names("variables"),
        "constants": parse_names("constants"),
        "keywords": parse_names("keywords"),
        "types": parse_names("types"),
    }
    json.dump(payload, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"funciones: {len(functions)}  variables: {len(payload['variables'])}  "
          f"constantes: {len(payload['constants'])}  tipos: {len(payload['types'])}")
    if skipped:
        print(f"omitidas: {len(skipped)}")
        for s in skipped[:10]:
            print("  ", s)
    # muestra de control
    for probe in ["table.cell", "ta.dmi", "request.security_lower_tf", "str.tostring", "box.new", "input.int"]:
        d = functions.get(probe)
        if d:
            print(f"  {probe}: max_pos={d['max_positional']} required={d['required']} "
                  f"enums={list(d['enums'])[:3]}")
        else:
            print(f"  {probe}: NO ENCONTRADA")


if __name__ == "__main__":
    sys.exit(main())
