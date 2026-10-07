# AI Instructions — Finance Tool

> **Canonical location for all AI agent instructions.** Tool-agnostic. Any AI tool loads from here.

## Entry Points by Tool

| Tool | Start here |
|------|------------|
| Any tool | `AGENTS.md` (repo root) |
| Claude Code | `CLAUDE.md` → `AGENTS.md` |
| Cursor | `.cursor/rules/ai-router.mdc` → `AGENTS.md` |

## Folder Structure

```
DESIGN.md            Visual source of truth (ClickHouse system, dark + #faff69)
.ai/
├── agents/          Role personas (Designer, Builder, Critic)
├── context/         Stable facts + session scratchpad
├── standards/       Design system, motion, code, data safety
├── commands/
│   ├── macro/       Full workflows (build-feature, design-screen, humanize)
│   └── micro/       Focused tasks (add-animation, audit-component, fix-performance, push)
└── learning.md      Append-only project memory
```

## Loading Rule

Load `context/session.md` + exactly **one** agent + **one** standard per task. Do not bulk-load the folder.
