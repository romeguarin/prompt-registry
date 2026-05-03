# API Documentation Standards

Follow these standards to produce consistent, high-quality API docs.

## REST Endpoint Documentation

Each endpoint section must include these elements in order:

1. **Heading** — `## METHOD /path/to/endpoint`
2. **Summary** — one-sentence description
3. **Authentication** — required auth mechanism (Bearer token, API key, none, etc.)
4. **Path Parameters** — table if applicable
5. **Query Parameters** — table if applicable
6. **Request Body** — JSON schema + example
7. **Response** — per status code: schema + example
8. **Error Codes** — table of expected non-2xx codes

## Field Tables

Use this column layout for all parameter/field tables:

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `id` | `string (UUID)` | ✅ | — | Unique identifier |
| `limit` | `integer` | ❌ | `20` | Max records to return |

## Code Examples

Always provide at minimum:
- A `curl` example for REST endpoints
- A JSON request body example (where applicable)
- A JSON response example

```bash
# Example curl
curl -X POST https://api.example.com/v1/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "email": "alice@example.com"}'
```

## Versioning

Document the API version in the file header:

```markdown
# Users API

> **API Version:** v1  
> **Last Updated:** 2024-01-15  
> **Base URL:** `https://api.example.com/v1`
```

## Tone and Style

- Use **present tense**: "Returns a list of users" not "Will return"
- Use **second person**: "You can filter results by…"
- Avoid jargon; define acronyms on first use
- Keep descriptions under 2 sentences; link to a guide for complex behaviour
