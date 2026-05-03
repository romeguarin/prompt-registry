---
name: sql-optimizer
description: Analyses SQL queries for correctness and performance issues, then rewrites them with explanations. Use when you have a slow or complex SQL query that needs improvement.
metadata:
  author: Your Team
  version: 1.0.0
  license: MIT
allowed-tools:
  - read_file
  - grep_search
  - semantic_search
  - run_in_terminal
---

# SQL Query Optimizer

This skill analyses SQL queries for performance problems and correctness issues, then rewrites them with a full explanation of every change made.

## When to Use This Skill

- A query is running slowly and you need to understand why
- You want to refactor a complex query for readability
- You need to ensure a query uses indexes effectively
- You are reviewing a query before it goes to production

## Analysis Process

### Step 1 — Understand the Schema

Before rewriting, use `read_file` or `grep_search` to locate:
- Table definitions (CREATE TABLE statements or ORM models)
- Existing indexes
- Foreign key relationships

Refer to [schema reference](./references/schema-tips.md) for common patterns.

### Step 2 — Identify Issues

Check for the common anti-patterns listed in [anti-patterns.md](./references/anti-patterns.md):

- `SELECT *` — fetches unnecessary columns
- Missing `WHERE` clause on large tables
- Implicit type coercions that prevent index use
- `OR` conditions that prevent index range scans
- Correlated subqueries that run once per row
- `DISTINCT` used to hide bad joins
- Functions on indexed columns in `WHERE` clauses
- Missing composite index order

### Step 3 — Rewrite

Use the helper script to validate syntax before presenting the rewrite:

```bash
bash scripts/validate-sql.sh "<query>"
```

### Step 4 — Report

Use the format in [report-template.md](./assets/report-template.md):

1. **Original query** (quoted verbatim)
2. **Issues found** (numbered list with explanations)
3. **Optimised query** (fully rewritten)
4. **Changes explained** (bullet list mapping old → new)
5. **Index recommendations** (if applicable)

## Supported Dialects

- PostgreSQL (primary)
- MySQL / MariaDB
- SQLite
- Microsoft SQL Server (limited)

When dialect cannot be inferred, ask the user before proceeding.
