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

The installer installs the bundled CLI tarball from `cli/agent-switch-skill-<version>.tgz` and verifies the result with `agent-switch --help`. If the tarball is missing in a development checkout, the installer falls back to installing production dependencies and then running `npm install -g <this-skill-directory>`. If installation fails because Node.js is missing or too old, tell the user to install Node.js 18 or newer and retry.

## Manual Install

From the skill directory, run the included installer:

```bash
node scripts/install-agent-switch.js
```

Or install the bundled CLI package directly:

```bash
npm install -g cli/agent-switch-skill-0.1.0.tgz
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

Captured CLI runs do not open the dashboard automatically. Do not open a web page just because the user asked to use this skill, run `agent-switch claude`, or run another captured CLI. Only open the web UI when the user explicitly asks for the dashboard/webui, or when they run one of these commands:

```bash
agent-switch dashboard
agent-switch webui
```

When the child CLI exits, `agent-switch` prints `agent-switch: returned to Codex` with the exit code, latest agent-switch session, captured request count, dashboard command, and latest export command. This terminal output is the handoff back to the current Codex session.

## Inspect Conversations

Use the agent-switch dashboard and exports:

```bash
agent-switch dashboard
agent-switch webui
agent-switch export <session>/<seq> --format md
agent-switch export <session>/<seq> --format raw
```

Load `references/agent-switch-capabilities.md` when the user asks for the full provider list, storage behavior, export formats, proxy-only mode, or migration/removal commands.

## Hermes Local API

When the user asks to call Hermes, treat Hermes as a local API service, not as a CLI. The default base URL is:

```bash
http://127.0.0.1:8642
```

First check health:

```bash
GET http://127.0.0.1:8642/health
```

If Hermes returns `401` for model or chat endpoints and no saved Hermes auth config exists, stop and ask the user for the required Authorization value or token. Do not guess a token and do not silently reuse unrelated OpenAI or Anthropic credentials.

After the user provides the Hermes auth config, save it locally for future calls in:

```text
~/.agent-switch/hermes.json
```

Use this JSON shape:

```json
{
  "baseUrl": "http://127.0.0.1:8642",
  "authHeader": "Authorization",
  "authValue": "Bearer <token>"
}
```

Create `~/.agent-switch` if needed and restrict file permissions when the platform supports it. Treat this file as sensitive local data. On later Hermes calls, read this config first; only ask again if the file is missing, invalid, or Hermes still returns `401`.

Load `references/hermes-local-api.md` when the user asks for Hermes setup, auth storage, or local API calling behavior.

## Code Layout

- `code/agent-switch-core`: internal capture engine, provider wrappers, store, dashboard, exports, MCP server, and tests.
- `code/agent-switch`: user-facing CLI entrypoint that invokes the internal engine and prints the Codex handoff.
- `cli/agent-switch-skill-<version>.tgz`: bundled cross-platform npm CLI package with runtime dependencies.
- `scripts/install-agent-switch.js`: deterministic local installer for the skill command.

Treat captured logs as sensitive. agent-switch masks auth headers by default, but prompts, tool outputs, file paths, and source snippets may still be stored.
