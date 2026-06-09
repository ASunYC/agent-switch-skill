# agent-switch Capability Map

The bundled code in `code/agent-switch-core` is the internal capture engine for agent-switch. Use it whenever the user needs to inspect what coding agents send to model APIs.

## Captured Clients

- `claude`: Claude Code through `ANTHROPIC_BASE_URL`, Anthropic Messages format, optional agent-switch MCP self-inspection.
- `codex`: Codex through `OPENAI_BASE_URL`, OpenAI Responses / Chat format. API-key mode is required; ChatGPT-login WebSocket mode bypasses base URL capture.
- `codewhale` and `codewhale-tui`: CodeWhale through `DEEPSEEK_BASE_URL`, OpenAI-compatible Chat format.
- `deepseek` and `deepseek-tui`: legacy DeepSeek-TUI compatibility shims retained while CodeWhale upstream still ships them.
- `kimi`: Claude Code pointed at Moonshot's Anthropic-compatible endpoint.
- `opencode`: OpenCode through `OPENAI_BASE_URL`, upstream auto-detected from the current environment.
- `ollama`, `lmstudio`, `openrouter`, `glm`, `bedrock`, `vertex`: built-in provider recipes.
- `run --provider <provider> -- <cmd...>`: wrap any CLI that respects a base URL env var.

## CLI Account Profiles

Profiles isolate target CLI account/config directories without changing the current working directory.

- `agent-switch profile new codex/work`: creates `~/.agent-switch/profiles/codex/work`.
- `agent-switch profile new claude/work`: creates `~/.agent-switch/profiles/claude/work`.
- `agent-switch profile new opencode/work`: creates `~/.agent-switch/profiles/opencode/work`.
- `agent-switch codex --profile work`: runs Codex with `CODEX_HOME` set to the profile directory.
- `agent-switch claude --profile work`: runs Claude Code with `CLAUDE_CONFIG_DIR` set to the profile directory.
- `agent-switch opencode --profile work`: runs OpenCode with `OPENCODE_CONFIG_DIR` set to the profile directory.

`agent-switch kimi --profile work`, `agent-switch bedrock --profile work`, and `agent-switch vertex --profile work` use Claude profiles because those providers run the `claude` binary.

Useful profile commands:

- `agent-switch profile list [tool]`
- `agent-switch profile path <tool>/<name>`
- `agent-switch profile delete <tool>/<name> --yes`

`--shared` links or copies safe defaults from the normal CLI home. It never shares known auth/session files such as Codex `auth.json`, Claude `.credentials.json`, session directories, project state, todos, or history files.

## Core Operations

- `agent-switch <provider> [args...]`: run a coding CLI through agent-switch and print a Codex handoff summary when it exits.
- `agent-switch run --provider openai -- <cmd...>`: wrap an arbitrary OpenAI-compatible CLI.
- `agent-switch dashboard`: open the saved-log dashboard.
- `agent-switch webui`: alias for `dashboard`.
- `agent-switch view`: backward-compatible alias for `dashboard`.
- `agent-switch export <session>/<seq> --format raw|md|json|har`: export a captured request.
- `agent-switch migrate`: copy legacy `./.agent-switch` project logs into the global store.
- `agent-switch repack [session]`: force content-addressed v2 storage migration.
- `agent-switch rm <session>`: delete a session and reclaim orphaned blobs.
- `agent-switch proxy --provider openai|claude`: run only the proxy and dashboard so an IDE can be manually pointed at the proxy URL.

## Stored Logs

New captures are saved under `~/.agent-switch/sessions/<encoded-project-path>-<hash>/<session>/NNNN.json`. The dashboard reads both the global store and legacy `./.agent-switch` in the current project.

Auth headers are redacted by default. Tell the user that logs still contain sensitive prompts, tool outputs, file paths, and possibly source snippets.
