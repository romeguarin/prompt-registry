# SQL Optimization Report Template

Use this template when reporting findings from the sql-optimizer skill.

---

## Original Query

```sql
-- Paste the original query verbatim here
```

## Issues Found

1. **Issue title** — Explanation of why this is a problem and its likely impact (e.g., "full table scan on `orders`, ~500k rows").
2. **Issue title** — ...

## Optimised Query

```sql
-- The rewritten query
```

## Changes Explained

- **Line X** — Replaced `SELECT *` with explicit column list to enable a covering index on `(user_id, status, created_at)`.
- **Line Y** — Moved subquery to a `LEFT JOIN` to eliminate per-row execution.
- **Line Z** — Added `LIMIT 100` to prevent unbounded result sets.

## Index Recommendations

| Table | Suggested Index | Reason |
|-------|----------------|--------|
| `orders` | `CREATE INDEX idx_orders_user_status ON orders(user_id, status)` | Supports the `WHERE user_id = ? AND status = ?` filter |

## Estimated Impact

> Based on the schema and query shape, the rewrite should reduce execution time from O(n) to O(log n) for typical dataset sizes. Validate with `EXPLAIN ANALYZE` in your environment.
