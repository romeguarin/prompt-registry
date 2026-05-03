# SQL Anti-Patterns Reference

Common query anti-patterns to check for during analysis.

## 1. SELECT *

**Problem:** Fetches all columns, including unused ones. Prevents covering indexes.

```sql
-- Bad
SELECT * FROM orders WHERE user_id = 42;

-- Good
SELECT id, status, created_at FROM orders WHERE user_id = 42;
```

## 2. Functions on Indexed Columns in WHERE

**Problem:** Wrapping an indexed column in a function prevents the database from using the index.

```sql
-- Bad (index on created_at is not used)
SELECT * FROM events WHERE YEAR(created_at) = 2024;

-- Good
SELECT * FROM events
WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
```

## 3. Correlated Subqueries

**Problem:** Executes once per row of the outer query — O(n) subquery calls.

```sql
-- Bad
SELECT o.id,
  (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
FROM orders o;

-- Good
SELECT o.id, COALESCE(i.item_count, 0) AS item_count
FROM orders o
LEFT JOIN (
  SELECT order_id, COUNT(*) AS item_count FROM order_items GROUP BY order_id
) i ON i.order_id = o.id;
```

## 4. DISTINCT Used to Hide Bad Joins

**Problem:** `DISTINCT` is expensive and often masks a Cartesian product caused by a missing join condition.

```sql
-- Bad (duplicates caused by missing join condition)
SELECT DISTINCT u.name FROM users u JOIN orders o ON u.id = o.user_id;

-- Good (use EXISTS or aggregation instead)
SELECT u.name FROM users u WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
```

## 5. OR Conditions on Different Columns

**Problem:** `OR` across different columns often results in a full table scan.

```sql
-- Bad
SELECT * FROM users WHERE email = 'a@b.com' OR phone = '555-1234';

-- Good (union two index seeks)
SELECT * FROM users WHERE email = 'a@b.com'
UNION
SELECT * FROM users WHERE phone = '555-1234';
```

## 6. Missing Pagination

**Problem:** Returning unlimited rows can exhaust memory and saturate the network.

```sql
-- Bad
SELECT * FROM audit_log ORDER BY created_at DESC;

-- Good
SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100 OFFSET 0;
```
