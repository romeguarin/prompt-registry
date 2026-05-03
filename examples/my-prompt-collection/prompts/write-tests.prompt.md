---
name: Write Unit Tests
description: Generate comprehensive unit tests for a given function or module
---

# Write Unit Tests

You are an expert software engineer specialising in test-driven development.
Given the code below, generate a full suite of unit tests.

## Requirements

- Cover the **happy path** (expected inputs and outputs)
- Cover **edge cases** (empty input, null/undefined, boundary values)
- Cover **error cases** (invalid input, exceptions)
- Use the same language and testing framework already present in the project (detect automatically)
- Each test case must have a descriptive name that explains what it verifies
- Mock external dependencies (database calls, HTTP requests, file I/O) with appropriate test doubles
- Aim for at least **80% branch coverage**

## Output Format

Return only the test file content, no prose explanation.
If you need to infer the testing framework, add a brief comment at the top stating which one you chose.

## Code to Test

```
{{selection}}
```
