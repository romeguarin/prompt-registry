#!/usr/bin/env bash
# discover-routes.sh
# Scans a project directory and prints a summary of detected API routes.
# Supports Express/Fastify (JS/TS), FastAPI/Flask (Python), Spring Boot (Java).
#
# Usage:
#   bash scripts/discover-routes.sh [project-root]
#   bash scripts/discover-routes.sh ./my-api

set -euo pipefail

ROOT="${1:-.}"

echo "🔍 Scanning for API routes in: $ROOT"
echo "========================================"

# Express / Fastify (JavaScript / TypeScript)
JS_ROUTES=$(grep -rn \
  --include="*.js" --include="*.ts" --include="*.mjs" \
  -E "router\.(get|post|put|patch|delete)\s*\(|app\.(get|post|put|patch|delete)\s*\(|fastify\.(get|post|put|patch|delete)\s*\(" \
  "$ROOT" 2>/dev/null || true)

if [[ -n "$JS_ROUTES" ]]; then
  echo ""
  echo "### JavaScript / TypeScript Routes"
  echo "$JS_ROUTES"
fi

# FastAPI / Flask (Python)
PY_ROUTES=$(grep -rn \
  --include="*.py" \
  -E "@(app|router)\.(get|post|put|patch|delete)\s*\(" \
  "$ROOT" 2>/dev/null || true)

if [[ -n "$PY_ROUTES" ]]; then
  echo ""
  echo "### Python Routes"
  echo "$PY_ROUTES"
fi

# Spring Boot (Java)
JAVA_ROUTES=$(grep -rn \
  --include="*.java" \
  -E "@(Get|Post|Put|Patch|Delete|Request)Mapping" \
  "$ROOT" 2>/dev/null || true)

if [[ -n "$JAVA_ROUTES" ]]; then
  echo ""
  echo "### Java (Spring Boot) Routes"
  echo "$JAVA_ROUTES"
fi

if [[ -z "$JS_ROUTES" && -z "$PY_ROUTES" && -z "$JAVA_ROUTES" ]]; then
  echo "No recognised route patterns found."
  echo "Supported: Express/Fastify (JS/TS), FastAPI/Flask (Python), Spring Boot (Java)"
fi

echo ""
echo "========================================"
echo "Done. Pipe this output to the api-doc-generator skill for documentation."
