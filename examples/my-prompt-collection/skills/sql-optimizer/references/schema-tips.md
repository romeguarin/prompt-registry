# Schema Discovery Tips

How to locate schema information when analysing queries.

## Finding Table Definitions

### In a SQL file or migration directory

```bash
grep -r "CREATE TABLE" ./migrations/ --include="*.sql" -l
grep -r "class.*Model\|schema(" ./src/ --include="*.py" -l
```

### In an ORM codebase

| ORM | Where to look |
|-----|--------------|
| Sequelize (JS) | `models/` directory, `.define(` calls |
| TypeORM (TS) | `@Entity()` decorated classes |
| SQLAlchemy (Python) | `Base` subclasses, `Column(` definitions |
| ActiveRecord (Ruby) | `db/schema.rb` |
| Prisma | `prisma/schema.prisma` |

## Finding Existing Indexes

```sql
-- PostgreSQL
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'your_table';

-- MySQL
SHOW INDEX FROM your_table;

-- SQLite
SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'your_table';
```

## Interpreting EXPLAIN Output

### PostgreSQL EXPLAIN ANALYZE

Key nodes to look for:

| Node | Meaning |
|------|---------|
| `Seq Scan` | Full table scan — check if an index is missing |
| `Index Scan` | Single index used — generally good |
| `Index Only Scan` | Covering index — best case |
| `Hash Join` / `Merge Join` | Table join strategies |
| `Nested Loop` | May be slow if outer set is large |

Look for high `actual rows` vs `estimated rows` discrepancies — this indicates stale statistics. Run `ANALYZE <table>` to refresh.
