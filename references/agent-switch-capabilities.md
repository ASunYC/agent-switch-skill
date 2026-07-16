# agent-switch Capability Map

The bundled code in `code/agent-switch-core` is the internal capture engine for agent-switch. Use it whenever the user needs to inspect what coding agents send to model APIs.

## Captured Clients

- `claude`: Claude Code through `ANTHROPIC_BASE_URL`, Anthropic Messages format, optional agent-switch MCP self-inspection.
- `codex`: Codex in ChatGPT-login or API-key mode through a temporary HTTP-only model provider, OpenAI Responses format. The user's Codex config is not modified.
- `codewhale` and `codewhale-tui`: CodeWhale through `DEEPSEEK_BASE_URL`, OpenAI-compatible Chat format.
- `deepseek` and `deepseek-tui`: legacy Agent Switch aliases mapped to the current `codewhale` and `codewhale-tui` binaries.
- `kimi`: Claude Code pointed at Moonshot's Anthropic-compatible endpoint. Agent Switch prefers `MOONSHOT_API_KEY` and injects the current `kimi-k2.7-code` model settings so an unrelated Claude/cc-switch provider cannot leak into the run.
- `opencode`: OpenCode through one OpenAI-compatible upstream selected by `OPENAI_BASE_URL` or `--upstream` for each run.
- `ollama`, `lmstudio`, `openrouter`, `glm`, `bedrock`, `vertex`: built-in provider recipes.
- `vertex` injects `CLAUDE_CODE_USE_VERTEX=1` and uses `ANTHROPIC_VERTEX_BASE_URL`; project, region, and Google credentials remain user-managed.
- `bedrock` injects `CLAUDE_CODE_USE_BEDROCK=1` and supports Bedrock-compatible gateways. Direct AWS SigV4 endpoints are rejected because a Host-rewriting proxy invalidates the signature.
- `codex-azure`: Codex through a temporary Azure provider. `AZURE_OPENAI_ENDPOINT` must be the full deployment Responses URL (including `api-version`), `AZURE_OPENAI_API_KEY` is forwarded as the `api-key` header, and Codex's local model cache suppresses unsupported Azure `/models` probes.
- `run --provider <provider> -- <cmd...>`: wrap any CLI that respects a base URL env var.

## CLI Account Profiles

Profiles isolate target CLI account/config directories without changing the current working directory.

- `agent-switch codex --profile work`: opens the Codex saved-auth menu, injects the selected auth into `~/.agent-switch/profiles/codex/work/auth.json`, then runs Codex with `CODEX_HOME` set to that profile directory.
- If `agent-switch codex --profile work` has no extra Codex args and the profile has saved sessions, Agent Switch passes `resume --last` to Codex by default.
- `agent-switch codex --profile work resume`: show Codex's resume picker for the current working directory.
- `agent-switch codex --profile work resume --all`: show Codex sessions across directories.
- Codex saved auth lives under `~/.agent-switch/profiles/codex/.accounts`.
- The Codex auth menu offers `add auth`, saved auth accounts, and `remove auth`. `add auth` runs the real `codex login` flow in a temporary login directory, then saves the resulting auth snapshot into the account store.
- Plain `agent-switch codex` does not read or modify the Codex profile auth store.
- `agent-switch profile new claude/work`: creates `~/.agent-switch/profiles/claude/work`.
- `agent-switch profile new opencode/work`: creates `~/.agent-switch/profiles/opencode/work`.
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
- `agent-switch <provider> -- <target-options...>`: stop Agent Switch option parsing and pass reserved option names to the target CLI.
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

Authorization, API key, and cookie headers are fully redacted by default. Tell the user that logs still contain sensitive prompts, request bodies, tool outputs, file paths, and possibly source snippets.
