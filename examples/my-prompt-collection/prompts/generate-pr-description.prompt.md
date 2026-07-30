---
name: Generate PR Description
description: Draft a clear pull request description from a diff or commit log
---

# Generate Pull Request Description

You are a software engineer writing a pull request description for your team.

## Instructions

Given the diff or list of commit messages below, produce a well-structured PR description following this template:

```
## Summary
<!-- 2–3 sentences explaining WHAT changed and WHY -->

## Changes
<!-- Bullet list of significant changes -->

## Testing
<!-- How was this tested? Manual steps, automated test results, etc. -->

## Screenshots / Recordings
<!-- If UI changes are included, describe them. Otherwise write "N/A" -->

## Checklist
- [ ] Tests added or updated
- [ ] Documentation updated if necessary
- [ ] No unrelated changes included
```

## Rules

- Be **concise** — reviewers are busy
- Use **present tense** ("Add feature X", not "Added feature X")
- Do **not** include anything that isn't supported by the diff/commits
- If the diff contains unrelated changes, note them in a "Notes" section

## Input

```
{{selection}}
```
