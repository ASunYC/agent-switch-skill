---
name: agent-switch-skill
description: Install and operate the bundled agent-switch tooling for switching between coding CLIs while capturing their model conversations. Use when the user wants to deploy this skill, inspect Claude Code/Codex/DeepSeek/Kimi/OpenCode prompts and tool calls, manage isolated CLI profiles/accounts, view or export agent-switch logs, or run commands like `agent-switch claude` so another CLI can work and return a handoff summary to Codex.
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
agent-switch codewhale
agent-switch deepseek
agent-switch kimi
agent-switch run --provider openai -- my-openai-compatible-cli
```

Use `agent-switch codewhale` for CodeWhale, formerly DeepSeek-TUI. Keep supporting `agent-switch deepseek` and `agent-switch deepseek-tui` as legacy compatibility aliases while upstream still ships those shims.

Captured CLI runs do not open the dashboard automatically. Do not open a web page just because the user asked to use this skill, run `agent-switch claude`, or run another captured CLI. Only open the web UI when the user explicitly asks for the dashboard/webui, or when they run one of these commands:

```bash
agent-switch dashboard
agent-switch webui
```

When the child CLI exits, `agent-switch` prints `agent-switch: returned to Codex` with the exit code, latest agent-switch session, captured request count, dashboard command, and latest export command. This terminal output is the handoff back to the current Codex session.

## CLI Account Profiles

Use profiles when the user wants multiple local accounts for Codex, Claude Code, or OpenCode. A profile changes only the target CLI's config/account directory; the working directory remains the current project.

Supported profile mappings:

- Codex: `CODEX_HOME=~/.agent-switch/profiles/codex/<name>`
- Claude Code and Claude-based providers: `CLAUDE_CONFIG_DIR=~/.agent-switch/profiles/claude/<name>`
- OpenCode: `OPENCODE_CONFIG_DIR=~/.agent-switch/profiles/opencode/<name>`

Create profiles explicitly:

```bash
agent-switch profile new codex/work
agent-switch profile new claude/work
agent-switch profile new opencode/work
```

Use profiles with wrapped CLIs:

```bash
agent-switch codex --profile work
agent-switch claude --profile work
agent-switch opencode --profile work
```

If the user passes only `--profile work`, infer the tool from the provider. `agent-switch codex --profile work` means `codex/work`; `agent-switch claude --profile work` means `claude/work`. For Kimi, Bedrock, and Vertex, use Claude profiles because those providers run the `claude` binary.

If the profile does not exist, tell the user to create it first. Do not create profiles silently during a run.

The first use of a new profile may require the target CLI to log in again. Let that CLI handle its normal login flow inside the isolated profile.

For safe shared defaults, use:

```bash
agent-switch profile new codex/work --shared
```

Shared mode may link or copy non-secret defaults such as Codex `config.toml`, Claude `settings.json`, skills, commands, agents, and plugins. It must not copy known auth/session files such as Codex `auth.json`, Claude `.credentials.json`, `sessions`, `projects`, `todos`, or history files.

Manage profiles:

```bash
agent-switch profile list
agent-switch profile path codex/work
agent-switch profile delete codex/work --yes
```

If no `--profile` flag is present, preserve the current default behavior and let the CLI use its normal global account/config.

## Headroom Compact Mode

Do not enable compact mode unless the user explicitly asks for automatic compression, compact, or Headroom. Plain `agent-switch claude` must remain transparent and must not modify Claude Code requests.

When requested, use compact mode only with Claude Code based providers:

```bash
agent-switch claude --compact
agent-switch kimi --compact
agent-switch bedrock --compact
agent-switch vertex --compact
```

Compact mode uses the bundled `headroom-ai` JavaScript SDK against an external Headroom proxy. Check dependencies first:

```bash
agent-switch compact doctor
```

If Headroom is missing, print install guidance rather than installing external Python/Rust tooling automatically:

```bash
agent-switch compact install
```

Default compact behavior is fail-open: if Headroom fails, agent-switch records the error and forwards the original request. Use `--compact-fail closed` only when the user explicitly wants uncompressed requests to stop.

RTK is intentionally not initialized in compact v1. Do not run `rtk init`, do not modify Claude/Codex hooks, and do not edit global agent instruction files for RTK.

## Missing Target CLI

`agent-switch` installs and runs the capture tooling only. It does not silently install third-party coding CLIs such as Claude Code, Codex, CodeWhale, DeepSeek-TUI, or OpenCode.

If a delegated command is missing, read the CLI error and guide the user to install the target CLI first. For Claude Code, use the official install commands shown by `agent-switch`:

```powershell
winget install Anthropic.ClaudeCode
irm https://claude.ai/install.ps1 | iex
```

```bash
curl -fsSL https://claude.ai/install.sh | bash
brew install --cask claude-code
```

After installing a target CLI, ask the user to reopen the terminal, verify the command directly, and retry through Agent Switch:

```bash
claude
agent-switch claude
```

For CodeWhale, the renamed DeepSeek-TUI package, guide users to install and verify:

```bash
npm install -g codewhale
codewhale doctor
agent-switch codewhale
```

## Local Upstream Troubleshooting

If `agent-switch claude` reports that the local upstream is not reachable, Claude Code is configured to use a local router such as CC Switch, but that service is not listening on the configured port.

Check the configured base URL in Claude Code settings or the environment:

```bash
ANTHROPIC_BASE_URL
```

For CC Switch, start or restart CC Switch and verify that its local port is healthy. If the router moved to another port, update Claude Code settings or run with an explicit upstream:

```bash
agent-switch claude --upstream http://127.0.0.1:<port>
```

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
