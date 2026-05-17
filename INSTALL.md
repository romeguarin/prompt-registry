# Prompt Registry with ADO Support

An unofficial release of Prompt Registry with ADO Support.  
Allows to import AI agents, skills and prompts collection from an ADO Git repository.

## Installation

Install via VS Code by running the following on a command line:

```bash
 code --install-extension prompt-registry-ado-beta-0.1.0.vsix
 ```

## ADO Repository Structure Guide

```mermaid
your-repo/
├── collections/
│   └── my-collection.collection.yml    # ← collection manifest (required)
├── prompts/
│   └── task-helper.prompt.md           # .prompt.md
├── instructions/
│   └── standards.instructions.md       # .instructions.md
├── agents/
│   └── my-agent.agent.md               # .agent.md
├── skills/
│   └── my-skill/
│       ├── SKILL.md                    # .skill.md
│       ├── scripts/
│       ├── references/
│       └── assets/
└── README.md
```

## Issues

Please report issues to Javi Guarin or anyone from the DS AI initiative team.
