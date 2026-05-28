# agent-switch Capability Map

The bundled code in `code/agent-switch-core` is the internal capture engine for agent-switch. Use it whenever the user needs to inspect what coding agents send to model APIs.

## Captured Clients

- `claude`: Claude Code through `ANTHROPIC_BASE_URL`, Anthropic Messages format, optional agent-switch MCP self-inspection.
- `codex`: Codex through `OPENAI_BASE_URL`, OpenAI Responses / Chat format. API-key mode is required; ChatGPT-login WebSocket mode bypasses base URL capture.
- `deepseek` and `deepseek-tui`: DeepSeek-TUI through `DEEPSEEK_BASE_URL`, OpenAI-compatible Chat format.
- `kimi`: Claude Code pointed at Moonshot's Anthropic-compatible endpoint.
- `opencode`: OpenCode through `OPENAI_BASE_URL`, upstream auto-detected from the current environment.
- `ollama`, `lmstudio`, `openrouter`, `glm`, `bedrock`, `vertex`: built-in provider recipes.
- `run --provider <provider> -- <cmd...>`: wrap any CLI that respects a base URL env var.

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
