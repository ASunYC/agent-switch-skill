---
name: agent-switch-skill
description: Install and operate the bundled agent-switch tooling for switching between coding CLIs while capturing their model conversations. Use when the user wants to deploy this skill, inspect Claude Code/Codex/DeepSeek/Kimi/OpenCode prompts and tool calls, view or export agent-switch logs, or run commands like `agent-switch claude` so another CLI can work and return a handoff summary to Codex.
---

# Agent Switch Skill

## Overview

Use this skill to install and drive the local `agent-switch` command. The command owns the capture proxy, dashboard, exports, and a Codex-facing handoff after a wrapped CLI exits.

## First-Use Bootstrap

When this skill is used, first check whether the CLI is already available:

```bash
agent-switch --help
```

If `agent-switch` is missing from PATH, install it from this skill directory by running:

```bash
node scripts/install-agent-switch.js
```

The installer runs `npm install -g <this-skill-directory>` and verifies the result with `agent-switch --help`. If installation fails because Node.js is missing or too old, tell the user to install Node.js 18 or newer and retry.

## Manual Install

From the skill directory, install the command globally:

```bash
npm install -g .
```

Or run the included installer:

```bash
node scripts/install-agent-switch.js
```

Verify the command exists:

```bash
agent-switch --help
```

## Run Another CLI

Use one command to delegate work to another coding CLI with capture enabled:

```bash
agent-switch claude
```

Pass arguments through normally:

```bash
agent-switch claude --resume
agent-switch codex
agent-switch deepseek
agent-switch kimi
agent-switch run --provider openai -- my-openai-compatible-cli
```

When the child CLI exits, `agent-switch` prints `agent-switch: returned to Codex` with the exit code, latest agent-switch session, captured request count, dashboard command, and latest export command. This terminal output is the handoff back to the current Codex session.

## Inspect Conversations

Use the agent-switch dashboard and exports:

```bash
agent-switch view
agent-switch export <session>/<seq> --format md
agent-switch export <session>/<seq> --format raw
```

Load `references/agent-switch-capabilities.md` when the user asks for the full provider list, storage behavior, export formats, proxy-only mode, or migration/removal commands.

## Code Layout

- `code/agent-switch-core`: internal capture engine, provider wrappers, store, dashboard, exports, MCP server, and tests.
- `code/agent-switch`: user-facing CLI entrypoint that invokes the internal engine and prints the Codex handoff.
- `scripts/install-agent-switch.js`: deterministic local installer for the skill command.

Treat captured logs as sensitive. agent-switch masks auth headers by default, but prompts, tool outputs, file paths, and source snippets may still be stored.
