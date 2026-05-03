---
name: Coding Standards
description: Team coding conventions that Copilot should always follow
applyTo: "**/*.{ts,tsx,js,jsx,py}"
---

# Coding Standards

These guidelines apply to all code produced or modified in this repository.

## General Principles

- **Clarity over cleverness** — prefer readable code over terse one-liners
- **Single Responsibility** — each function and module does one thing well
- **Fail fast** — validate inputs early and throw meaningful errors
- **No magic values** — extract literals into named constants

## Naming Conventions

| Construct | Convention | Example |
|-----------|-----------|---------|
| Variables & functions | `camelCase` | `getUserById` |
| Classes & types | `PascalCase` | `UserRepository` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| Files | `kebab-case` | `user-repository.ts` |

## Functions

- Maximum **30 lines** per function; extract helpers if longer
- Maximum **3 parameters**; use an options object for more
- Always annotate return types (TypeScript / Python type hints)
- Prefer pure functions; isolate side effects

```typescript
// ✅ Good
function calculateDiscount(price: number, rate: number): number {
  return price * (1 - rate);
}

// ❌ Bad
const cd = (p: any, r: any) => p - p * r;
```

## Error Handling

- Never swallow errors silently
- Include context in error messages: `throw new Error(\`Failed to load user ${userId}: ${cause}\`)`
- Use custom error classes for domain errors
- Always clean up resources in `finally` blocks

## Comments

- Write comments that explain **why**, not **what**
- Keep JSDoc/docstrings up to date when changing behaviour
- Remove commented-out code before merging

## Testing

- Every public function must have at least one test
- Test file mirrors the source path: `src/utils/math.ts` → `test/utils/math.test.ts`
- No `console.log` statements in production code
