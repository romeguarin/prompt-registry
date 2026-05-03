#!/usr/bin/env bash
# validate-sql.sh
# Lightweight SQL syntax check using psql in --command mode (dry-run).
# Requires psql to be installed and a TEST_DATABASE_URL environment variable.
#
# Usage:
#   bash scripts/validate-sql.sh "SELECT id FROM users LIMIT 1"

set -euo pipefail

QUERY="${1:-}"

if [[ -z "$QUERY" ]]; then
  echo "Usage: $0 \"<sql query>\"" >&2
  exit 1
fi

if ! command -v psql &>/dev/null; then
  echo "psql not found — skipping syntax validation" >&2
  exit 0
fi

DB_URL="${TEST_DATABASE_URL:-}"
if [[ -z "$DB_URL" ]]; then
  echo "TEST_DATABASE_URL not set — skipping syntax validation" >&2
  exit 0
fi

# Wrap in EXPLAIN to validate syntax without executing
EXPLAIN_QUERY="EXPLAIN ${QUERY}"

if psql "$DB_URL" --no-psqlrc --quiet --command "$EXPLAIN_QUERY" > /dev/null 2>&1; then
  echo "✅ SQL syntax is valid"
else
  echo "❌ SQL syntax error detected. Run the query manually for details." >&2
  exit 1
fi
