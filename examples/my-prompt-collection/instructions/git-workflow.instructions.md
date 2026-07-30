---
name: Git Workflow
description: Branching strategy and commit message conventions for this repository
applyTo: "**"
---

# Git Workflow

Follow these conventions for all git activity in this repository.

## Branching Strategy

```
main          ← production-ready code, protected
  └── develop ← integration branch
        ├── feature/<ticket>-<short-description>
        ├── fix/<ticket>-<short-description>
        ├── chore/<short-description>
        └── docs/<short-description>
```

- Branch off **develop** for features and fixes
- Branch off **main** only for hotfixes (prefix `hotfix/`)
- Delete branches after merging

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short summary>

<optional body>

<optional footer>
```

### Types

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no logic change |
| `refactor` | Code change without new feature or fix |
| `test` | Adding or fixing tests |
| `chore` | Build process, dependency updates |
| `perf` | Performance improvement |

### Examples

```
feat(auth): add OAuth2 login via GitHub

fix(api): handle null response from upstream service
Closes #42

chore(deps): bump axios from 1.4.0 to 1.6.0
```

## Pull Requests

- Title follows the same Conventional Commit format as above
- Every PR requires at least **1 approving review** before merge
- Resolve all conversations before merging
- Squash-merge feature branches; merge commits for releases
- CI must be green before merge
