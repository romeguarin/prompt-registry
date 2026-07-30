# my-prompt-collection

A ready-to-use **Pattern A** prompt collection for [Prompt Registry](https://marketplace.visualstudio.com/items?itemName=AmadeusITGroup.prompt-registry).

Add this repository as a source in Prompt Registry and install the **Developer Toolkit** bundle to get a curated set of prompts, instructions, agents, and skills for everyday software development.

---

## 📦 What's Included

### Prompts

| File | Purpose |
|------|---------|
| `prompts/write-tests.prompt.md` | Generate unit tests for a function or module |
| `prompts/explain-code.prompt.md` | Plain-English explanation of a code snippet |
| `prompts/generate-pr-description.prompt.md` | Draft a PR description from a diff or commit log |

### Instructions

| File | Purpose |
|------|---------|
| `instructions/coding-standards.instructions.md` | Coding conventions Copilot should always follow |
| `instructions/git-workflow.instructions.md` | Branching strategy and commit message conventions |

### Agents

| File | Purpose |
|------|---------|
| `agents/senior-dev.agent.md` | Experienced engineer for code review and design advice |
| `agents/security-auditor.agent.md` | Security specialist for vulnerability analysis |

### Skills

| Directory | Purpose |
|-----------|---------|
| `skills/sql-optimizer/` | Analyse and rewrite SQL queries for performance |
| `skills/api-doc-generator/` | Generate structured API reference documentation from source code |

---

## 🚀 How to Use

### Add as a Source in Prompt Registry

1. Open VS Code with the [Prompt Registry extension](https://marketplace.visualstudio.com/items?itemName=AmadeusITGroup.prompt-registry) installed
2. Press `Ctrl+Shift+P` → **Prompt Registry: Add Source**
3. Choose **Collection from Github repository**
4. Enter a display name (e.g. `My Team Prompts`)
5. Enter this repository's URL: `https://github.com/<your-org>/my-prompt-collection`
6. Leave branch (`main`) and collections path (`collections`) as defaults
7. Click OK — the **Developer Toolkit** bundle appears in the Marketplace

### Install the Bundle

1. Open the Marketplace in the Prompt Registry sidebar
2. Find **Developer Toolkit** and click **Install**
3. Choose your preferred scope (User, Workspace, or Repository)

---

## 📁 Repository Structure

```
my-prompt-collection/
├── collections/
│   └── dev-toolkit.collection.yml    ← bundle manifest
├── prompts/
│   ├── write-tests.prompt.md
│   ├── explain-code.prompt.md
│   └── generate-pr-description.prompt.md
├── instructions/
│   ├── coding-standards.instructions.md
│   └── git-workflow.instructions.md
├── agents/
│   ├── senior-dev.agent.md
│   └── security-auditor.agent.md
└── skills/
    ├── sql-optimizer/
    │   ├── SKILL.md
    │   ├── references/
    │   │   ├── anti-patterns.md
    │   │   └── schema-tips.md
    │   ├── assets/
    │   │   └── report-template.md
    │   └── scripts/
    │       └── validate-sql.sh
    └── api-doc-generator/
        ├── SKILL.md
        ├── references/
        │   └── doc-standards.md
        └── scripts/
            └── discover-routes.sh
```

---

## ✏️ Customising

1. **Edit the manifests** in `collections/` to add or remove items
2. **Add new prompts** — drop a `*.prompt.md` file in `prompts/` and reference it in `dev-toolkit.collection.yml`
3. **Add new collections** — create a new `*.collection.yml` in `collections/`; Prompt Registry discovers all files in that directory

Run `Ctrl+Shift+P → Prompt Registry: Validate Collections` to check your changes before pushing.

---

## 🔗 Resources

- [Prompt Registry documentation](https://github.com/AmadeusITGroup/prompt-registry)
- [Collection schema reference](https://github.com/AmadeusITGroup/prompt-registry/blob/main/docs/author-guide/collection-schema.md)
- [Authoring guide](https://github.com/AmadeusITGroup/prompt-registry/blob/main/docs/author-guide/creating-source-bundle.md)
