// Supported clients. Each provider knows which env var points its CLI at the
// proxy, the default upstream to forward to, the response format, and the
// actual binary to spawn.

export const PROVIDERS = {
  claude: {
    label: "Claude Code",
    command: "claude",
    format: "anthropic",
    envVar: "ANTHROPIC_BASE_URL",
    upstream: "https://api.anthropic.com",
    mcp: true, // Claude Code accepts --mcp-config: auto-inject agent-switch's inspection tools
  },
  codex: {
    label: "Codex (OpenAI)",
    command: "codex",
    format: "openai",
    envVar: "OPENAI_BASE_URL",
    upstream: "https://api.openai.com",
  },
  "codex-azure": {
    label: "Codex (Azure OpenAI)",
    command: "codex",
    format: "openai",
    envVar: "AZURE_OPENAI_ENDPOINT",
    upstream: "auto",
    autoUpstream: true,
    codexAzure: true,
    note: "Codex Azure: set AZURE_OPENAI_ENDPOINT to the full deployment Responses URL (including api-version) and AZURE_OPENAI_API_KEY to your key.",
  },
  codewhale: {
    label: "CodeWhale",
    command: "codewhale",
    format: "openai",
    envVar: "DEEPSEEK_BASE_URL",
    upstream: "https://api.deepseek.com",
    note: "CodeWhale uses OpenAI-compatible Chat Completions. Make sure your DeepSeek key is set (DEEPSEEK_API_KEY).",
  },
  "codewhale-tui": {
    label: "CodeWhale TUI",
    command: "codewhale-tui",
    format: "openai",
    envVar: "DEEPSEEK_BASE_URL",
    upstream: "https://api.deepseek.com",
    note: "CodeWhale uses OpenAI-compatible Chat Completions. Make sure your DeepSeek key is set (DEEPSEEK_API_KEY).",
  },
  deepseek: {
    label: "CodeWhale (legacy deepseek)",
    command: "codewhale",
    format: "openai",
    envVar: "DEEPSEEK_BASE_URL",
    upstream: "https://api.deepseek.com",
    note: "DeepSeek-TUI was renamed to CodeWhale. This legacy agent-switch alias launches the current CodeWhale CLI; make sure your DeepSeek key is set (DEEPSEEK_API_KEY).",
  },
  "deepseek-tui": {
    label: "CodeWhale TUI (legacy deepseek-tui)",
    command: "codewhale-tui",
    format: "openai",
    envVar: "DEEPSEEK_BASE_URL",
    upstream: "https://api.deepseek.com",
    note: "DeepSeek-TUI was renamed to CodeWhale. This legacy agent-switch alias launches the current CodeWhale TUI; make sure your DeepSeek key is set (DEEPSEEK_API_KEY).",
  },
  kimi: {
    label: "Kimi (Moonshot, via Claude Code)",
    command: "claude",
    format: "anthropic",
    envVar: "ANTHROPIC_BASE_URL",
    upstream: "https://api.moonshot.ai/anthropic",
    kimi: true,
    note: "Kimi runs through Claude Code. Set MOONSHOT_API_KEY (recommended) so credentials stay isolated from the active Claude provider.",
    mcp: true, // runs the `claude` binary, so --mcp-config works here too
  },
  openai: {
    label: "OpenAI (generic)",
    command: null,
    format: "openai",
    envVar: "OPENAI_BASE_URL",
    upstream: "https://api.openai.com/v1",
  },
  opencode: {
    label: "OpenCode",
    command: "opencode",
    format: "openai",
    envVar: "OPENAI_BASE_URL",
    upstream: "auto",       // resolved from current env at run time
    autoUpstream: true,
    noSettings: true,       // OpenCode doesn't use --settings flag like Claude Code
  },
  glm: {
    label: "GLM / Zhipu AI",
    command: null,
    format: "openai",
    envVar: "OPENAI_BASE_URL",
    upstream: "auto",
    autoUpstream: true,
    note: "GLM/Zhipu uses an OpenAI-compatible API. Set OPENAI_BASE_URL to your Zhipu endpoint (e.g. https://open.bigmodel.cn/api/paas/v4) and OPENAI_API_KEY to your Zhipu key.",
  },
  ollama: {
    label: "Ollama (local)",
    command: null,
    format: "openai",
    envVar: "OPENAI_BASE_URL",
    upstream: "http://127.0.0.1:11434/v1",
    note: "Ollama serves an OpenAI-compatible API on port 11434. Override the address with --upstream if needed.",
  },
  lmstudio: {
    label: "LM Studio (local)",
    command: null,
    format: "openai",
    envVar: "OPENAI_BASE_URL",
    upstream: "http://127.0.0.1:1234/v1",
    note: "LM Studio serves an OpenAI-compatible API on port 1234. Override the address with --upstream if needed.",
  },
  openrouter: {
    label: "OpenRouter",
    command: null,
    format: "openai",
    envVar: "OPENAI_BASE_URL",
    upstream: "https://openrouter.ai/api/v1",
    note: "OpenRouter is OpenAI-compatible. Set OPENAI_API_KEY to your OpenRouter key.",
  },
  bedrock: {
    label: "AWS Bedrock (via Claude Code)",
    command: "claude",
    format: "anthropic",
    // Bedrock mode (CLAUDE_CODE_USE_BEDROCK=1) reads its endpoint from
    // ANTHROPIC_BEDROCK_BASE_URL, not ANTHROPIC_BASE_URL -otherwise the
    // proxy is silently bypassed.
    envVar: "ANTHROPIC_BEDROCK_BASE_URL",
    upstream: "auto",
    autoUpstream: true,
    runtimeEnv: { CLAUDE_CODE_USE_BEDROCK: "1" },
    mcp: true,
    note: "Bedrock capture requires a gateway URL in ANTHROPIC_BEDROCK_BASE_URL. Direct amazonaws.com SigV4 requests cannot pass through a Host-rewriting proxy.",
  },
  vertex: {
    label: "Google Vertex AI (via Claude Code)",
    command: "claude",
    format: "anthropic",
    envVar: "ANTHROPIC_VERTEX_BASE_URL",
    upstream: "auto",
    autoUpstream: true,
    runtimeEnv: { CLAUDE_CODE_USE_VERTEX: "1" },
    mcp: true,
    note: "Vertex AI: set ANTHROPIC_VERTEX_BASE_URL, ANTHROPIC_VERTEX_PROJECT_ID, and CLOUD_ML_REGION. Google credentials are forwarded as-is.",
  },
  hermes: {
    label: "Hermes (local)",
    command: null,
    format: "openai",
    envVar: "HERMES_BASE_URL",
    upstream: "http://127.0.0.1:8642",
    note: "Hermes is a local Docker-hosted API service (not a CLI). Use `agent-switch hermes` to chat directly. Auth stored in ~/.agent-switch/hermes.json.",
  },
};

export const PICKABLE = ["claude", "codex", "codewhale", "deepseek", "kimi", "opencode"]; // shown in the no-arg picker

// Resolve a provider from a CLI token (e.g. "claude"), falling back to a custom
// command wrapped under an explicit --provider.
export function resolveProvider(name, providerOverride, envVarOverride) {
  const base = providerOverride && PROVIDERS[providerOverride]
    ? { ...PROVIDERS[providerOverride] }
    : PROVIDERS[name]
      ? { ...PROVIDERS[name] }
      : { label: name, command: name, format: "anthropic", envVar: "ANTHROPIC_BASE_URL", upstream: "https://api.anthropic.com" };
  if (providerOverride && PROVIDERS[providerOverride] && name) base.command = name;
  if (envVarOverride) base.envVar = envVarOverride;
  return base;
}
