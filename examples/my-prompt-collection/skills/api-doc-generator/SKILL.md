---
name: api-doc-generator
description: Reads source code and generates structured API reference documentation in Markdown. Use when you need to document REST endpoints, GraphQL schemas, or library APIs.
metadata:
  author: Your Team
  version: 1.0.0
  license: MIT
allowed-tools:
  - read_file
  - list_dir
  - grep_search
  - semantic_search
  - create_file
---

# API Documentation Generator

This skill inspects source code and produces comprehensive, structured API reference documentation.

## When to Use This Skill

- A REST API or library lacks documentation
- Documentation is out of date and needs to be regenerated
- You are onboarding a new team member and need reference material quickly
- You want to publish OpenAPI/Swagger-style documentation from code

## Process

### Step 1 — Discover Endpoints or Exports

Use `list_dir` and `grep_search` to locate:

```bash
# Find route definitions (Express.js)
grep -r "router\.\(get\|post\|put\|patch\|delete\)" ./src --include="*.ts" -n

# Find FastAPI routes (Python)
grep -r "@app\.\|@router\." ./src --include="*.py" -n

# Find exported functions (TypeScript library)
grep -r "^export function\|^export const\|^export class" ./src --include="*.ts" -n
```

### Step 2 — Read Implementation Details

For each discovered endpoint or export, use `read_file` to capture:
- Parameter names and types
- Request/response body shapes
- Authentication requirements
- Error codes and their meanings
- JSDoc / docstring comments

Refer to [doc-standards.md](./references/doc-standards.md) for style guidelines.

### Step 3 — Generate Documentation

Use the template at [endpoint-template.md](./references/endpoint-template.md) for REST endpoints,
or [function-template.md](./references/function-template.md) for library exports.

### Step 4 — Write Output

Use `create_file` to write the generated documentation to `docs/api/` unless the user specifies otherwise.

Produce one file per resource or module:
- `docs/api/users.md`
- `docs/api/orders.md`
- `docs/api/README.md` — index listing all documented resources

## Supported Frameworks

| Framework | Language | Route pattern detected |
|-----------|----------|----------------------|
| Express.js | JavaScript/TypeScript | `router.get(`, `app.post(` |
| Fastify | JavaScript/TypeScript | `fastify.route(`, `.get(` |
| FastAPI | Python | `@app.get(`, `@router.post(` |
| Flask | Python | `@app.route(` |
| Spring Boot | Java | `@GetMapping(`, `@PostMapping(` |
| Rails | Ruby | `config/routes.rb` |

## Output Quality Rules

- Every endpoint must include: method, path, description, parameters, request body (if any), response schema, error codes
- Use fenced code blocks for all JSON/YAML examples
- Mark optional fields clearly with `(optional)`
- Never invent behaviour that isn't visible in the source code — if something is unclear, add a `> ⚠️ Needs clarification` callout
