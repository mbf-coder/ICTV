#!/usr/bin/env bash
# Verificación completa y reproducible del indicador Pine v6.
#
#   bash verify/verify_all.sh
#
# Pasos:
#   0. ensamblado determinista de los entregables desde sus partes
#   1. parse AST con pynescript (gramática Pine real)
#   2. lint estático v6 contra 475 firmas de la referencia oficial
#   3. autoprueba del lint (18 defectos inyectados que debe detectar)
#   4. ejecución real con PineTS: 600 barras sintéticas + datos reales Binance
#   5. checklist de requisitos de la misión
#
# Sale con código 0 sólo si todos los pasos pasan.
#
# Entorno:
#   PYTHON   intérprete a usar (por defecto .venv/bin/python, creándolo si falta).
#            En CI se pasa el Python de actions/setup-python:  PYTHON=python3
#
# Idempotente: instala lo que falte (pip pynescript, npm pinets).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then
    step() { printf '\n══ %s ══\n' "$1"; }
    fail() { printf '\n✗ %s\n' "$1" >&2; exit 1; }
    ok()   { printf '\n✓ %s\n' "$1"; }
else
    step() { printf '\n\033[1m══ %s ══\033[0m\n' "$1"; }
    fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
    ok()   { printf '\n\033[32m✓ %s\033[0m\n' "$1"; }
fi

# ── ensamblado de entregables (partes versionadas → archivos completos) ─────
# Los archivos grandes viven como partes (verify/parts/*, quant-flow/src/*);
# aquí se reconstruyen y se verifica su sha256 antes de comprobar nada.
python3 verify/assemble.py || { printf '\n✗ no se pudieron ensamblar los entregables\n' >&2; exit 1; }

# ── intérprete de Python ─────────────────────────────────────────────────────
PY="${PYTHON:-.venv/bin/python}"
if [ ! -x "$PY" ] && ! command -v "$PY" >/dev/null 2>&1; then
    echo "· creando venv e instalando pynescript…"
    python3 -m venv .venv >/dev/null 2>&1
    PY=.venv/bin/python
fi
"$PY" -c "import pynescript" 2>/dev/null \
    || "$PY" -m pip install --quiet --disable-pip-version-check pynescript

# ── dependencias de Node ─────────────────────────────────────────────────────
if [ ! -d node_modules/pinets ]; then
    echo "· instalando pinets (runtime Pine Script para Node)…"
    if [ -f package-lock.json ]; then
        npm ci --no-audit --no-fund --silent
    else
        npm install --no-audit --no-fund --silent --no-save --no-package-lock pinets
    fi
fi

# ── base de firmas v6 (artefacto generado; se reconstruye bajo demanda) ───────
# verify/v6_reference.json no se versiona (pesa ~340 KB y se regenera desde el
# espejo de la referencia oficial). En un clon fresco se descarga y construye aquí.
if [ ! -f verify/v6_reference.json ]; then
    echo "· generando verify/v6_reference.json desde la referencia oficial v6…"
    "$PY" verify/build_ref.py
fi

step "1/5 · Sintaxis: parse AST (pynescript)"
"$PY" verify/parse_pynescript.py || fail "el parser rechazó el indicador"
"$PY" verify/parse_pynescript.py quant-flow/QuantumFlowStrategy_v6.pine || fail "el parser rechazó la estrategia"

step "2/5 · Lint estático Pine v6 (firmas + tipos + reglas de migración)"
"$PY" verify/pine_v6_lint.py || fail "el lint reportó errores en el indicador"
"$PY" verify/pine_v6_lint.py quant-flow/QuantumFlowStrategy_v6.pine || fail "el lint reportó errores en la estrategia"

step "3/5 · Autoprueba del lint (debe detectar 18/18 defectos)"
"$PY" verify/selftest_lint.py || fail "el lint no detecta defectos inyectados"

step "4/5 · Runtime: PineTS (600 barras sintéticas + datos reales Binance)"
node verify/verify_runtime.mjs || fail "falló la verificación de ejecución"

step "5/5 · Checklist de requisitos de la misión"
"$PY" verify/check_features.py || fail "faltan requisitos del indicador"
"$PY" verify/check_strategy.py || fail "faltan requisitos de la estrategia"

ok "TODO OK: sintaxis, tipos v6, ejecución, panel, footprint y requisitos"
