// CLI orchestration: resolve which client to inspect, start proxy + dashboard,
// spawn the client with its base-URL env var pointed at the proxy, clean up.

import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { proxyArgs } from "./child-args.js";
import { spawnCommand } from "./spawn-command.js";
import { Store, hasCapturedLogs } from "./store.js";
import { exportEntry, migrate, repack, rmCmd } from "./log-cli.js";
import { createProxy } from "./proxy.js";
import { createServer } from "./server.js";
import { resolveProvider, PROVIDERS, PICKABLE } from "./providers.js";
import { globalRoot, legacyRoot, readRoots } from "./paths.js";
import { checkHeadroomProxy, checkHeadroomSdk, DEFAULT_COMPACT, isClaudeCompactProvider } from "./compact.js";
import {
  codexAuthStoreRoot,
  injectCodexAuthAccount,
  listCodexAuthAccounts,
  removeCodexAuthAccount,
  saveCodexAuthAccountFromDir,
} from "./codex-auth-store.js";
import {
  createProfile,
  deleteProfile,
  listProfiles,
  parseProfileSpec,
  profileDir,
  resolveRunProfile,
  ProfileError,
} from "./profiles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version;

const HELP = `agent-switch v${VERSION} - see what your coding agent sends to the model

USAGE
  agent-switch                       Pick a client interactively (claude / codex / codewhale / deepseek / kimi)
  agent-switch claude [args...]      Inspect Claude Code
  agent-switch codex  [args...]      Inspect Codex (OpenAI)
  agent-switch codewhale [args...]   Inspect CodeWhale
  agent-switch deepseek [args...]    Inspect DeepSeek-TUI legacy shim
  agent-switch kimi   [args...]      Inspect Kimi (Moonshot, via Claude Code)
  agent-switch opencode [args...]    Inspect OpenCode
  agent-switch run [--provider P] -- <cmd...>   Inspect any client
  agent-switch dashboard             View saved logs (no capture, browse-only)
  agent-switch webui                 Alias for dashboard
  agent-switch view                  Alias for dashboard
  agent-switch migrate               Copy ./.agent-switch logs (this project only) to the global store
  agent-switch repack [session]      Re-pack stored captures into the deduped v2 format
  agent-switch rm <session>          Delete a session and reclaim its orphaned blobs
  agent-switch export <id> [--format raw|md|json|har]
  agent-switch compact doctor      Check Headroom compact dependencies
  agent-switch compact install     Print Headroom install commands
  agent-switch profile new <tool>/<name> [--shared]
  agent-switch profile list [tool]
  agent-switch profile path <tool>/<name>
  agent-switch profile delete <tool>/<name> --yes

OPTIONS
  --provider <p>      Force format/env for \`run\`
                      Built-in: claude|codex|codex-azure|codewhale|codewhale-tui
                              deepseek|deepseek-tui|kimi|openai|opencode
                              glm|ollama|lmstudio|openrouter|bedrock|vertex
  --upstream <url>    Override the upstream API (alias: --base-url)
  --base-url <url>    Alias for --upstream
  --port <n>          Dashboard port (default: auto)
  --proxy-port <n>    Proxy port (default: auto)
  --dir <path>        Log directory (default: ~/.agent-switch/sessions/<full-path>-<hash>)
  --open              Auto-open the dashboard in the browser (default: headless during captured CLI runs)
  --no-open           Keep dashboard server headless (the URL is printed on startup so you can open it manually)
  --no-redact         Do NOT mask auth tokens in saved logs
  --no-mcp            Do NOT inject agent-switch's inspection tools into Claude Code
  --profile <name|tool/name>
                      Codex: choose/add/remove saved auth, then inject into profile
                      Claude/OpenCode: run with an isolated config profile
  --no-settings-override   Do NOT force Claude Code onto the proxy via --settings
                           (use if a provider switcher set ANTHROPIC_BASE_URL)
  --env-var <name>    Override the environment variable used to set the proxy URL
                           (default depends on provider, e.g. ANTHROPIC_BASE_URL)
  --compact           Enable Headroom request compression for Claude Code providers
  --compact-engine <e>  Compact engine (v1: headroom)
  --compact-base-url <url>
                      Headroom proxy URL (default: ${DEFAULT_COMPACT.baseUrl})
  --compact-fail <mode>
                      open|closed (default: open; open forwards original request on failure)
  -h, --help          Show this help
  -v, --version       Show version

EXAMPLES
  agent-switch claude              # capture only; dashboard URL is printed, open it in another browser tab
  agent-switch claude --open       # capture + auto-open the dashboard in your browser
  agent-switch claude --compact    # compress older Claude context through Headroom
  agent-switch compact doctor
  agent-switch dashboard           # open the saved-log dashboard (no capture, browse past sessions)
  agent-switch webui               # alias for dashboard; same as above
  agent-switch codex
  agent-switch profile new codex/work     # create a Codex workspace/profile
  agent-switch codex --profile work  # choose auth, then resume latest session if one exists
  agent-switch codex --profile work resume      # show Codex resume picker
  agent-switch codex --profile work resume --all
  agent-switch profile new claude/work
  agent-switch claude --profile claude/work
  agent-switch claude --resume       # show Claude Code's resume/session picker
  agent-switch codewhale
  agent-switch codex-azure         # set AZURE_OPENAI_ENDPOINT first
  agent-switch deepseek
  agent-switch run --provider ollama -- my-openai-cli
  agent-switch run --provider openrouter -- my-openai-cli
  agent-switch run --provider glm -- my-openai-cli     # set OPENAI_BASE_URL first
  agent-switch run --provider bedrock -- claude        # set ANTHROPIC_BEDROCK_BASE_URL first
  agent-switch run --upstream https://my.api/v1 --env-var MY_BASE_URL -- my-tool
  agent-switch export <id> --format raw > request.http`;

function parseArgs(argv) {
  const opts = {
    dir: null,
    redact: true,
    mcp: true,
    open: null,
    settingsOverride: true,
    compact: { ...DEFAULT_COMPACT },
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") opts.port = Number(argv[++i]);
    else if (a === "--proxy-port") opts.proxyPort = Number(argv[++i]);
    else if (a === "--dir") opts.dir = path.resolve(argv[++i]);
    else if (a === "--upstream" || a === "--base-url") opts.upstream = argv[++i];
    else if (a === "--provider") opts.provider = argv[++i];
    else if (a === "--open") opts.open = true;
    else if (a === "--no-open") opts.open = false;
    else if (a === "--no-redact") opts.redact = false;
    else if (a === "--no-mcp") opts.mcp = false;
    else if (a === "--profile") opts.profile = argv[++i];
    else if (a === "--shared") opts.shared = true;
    else if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--no-settings-override") opts.settingsOverride = false;
    else if (a === "--env-var") opts.envVar = argv[++i];
    else if (a === "--compact") opts.compact.enabled = true;
    else if (a === "--compact-engine") opts.compact.engine = argv[++i];
    else if (a === "--compact-base-url") opts.compact.baseUrl = argv[++i];
    else if (a === "--compact-fail") opts.compact.fail = argv[++i];
    else if (a === "--format") opts.format = argv[++i];
    else rest.push(a);
  }
  return { opts, rest };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port ?? 0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const p = spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" });
  p.on("error", () => {});
  p.unref();
}

const banner = (dashUrl, provider, upstream) =>
  `\n  \x1b[36m*\x1b[0m agent-switch watching \x1b[1m${provider.label}\x1b[0m -> ${upstream}` +
  `\n    dashboard: \x1b[1m${dashUrl}\x1b[0m\n` +
  (provider.note ? `    \x1b[33mnote:\x1b[0m ${provider.note}\n` : "");

// Pick a client when agent-switch is run with no command.
function pickProvider() {
  if (!process.stdin.isTTY) return Promise.resolve(null);
  return interactiveSelect({
    title: "Select CLI to inspect",
    hint: "Type to search CLIs",
    right: "agent-switch",
    items: PICKABLE.map((key) => ({
      key,
      label: PROVIDERS[key].label,
      detail: key,
      search: `${key} ${PROVIDERS[key].label}`,
    })),
  }).then((item) => item?.key || null);
}

// Claude Code accepts `--mcp-config <json>` to register MCP servers for a single
// session without touching the user's persistent config. When inspecting a
// Claude-based client, point it at our own stdio MCP (src/mcp.js) so the agent
// can query the very requests it just made. AGENT_SWITCH_ROOT must match this run's
// log dir, or the MCP would read a stale store instead.
function maybeLegacyHint(cwd, captureDir) {
  const legacy = legacyRoot(cwd);
  if (!hasCapturedLogs(legacy)) return;
  if (hasCapturedLogs(captureDir)) return;
  process.stderr.write(
    `  \x1b[33mnote:\x1b[0m found logs in ./.agent-switch (this project directory only).\n` +
    `        This run saves new captures under ${captureDir}\n` +
    `        Run \`agent-switch migrate\` to copy ./.agent-switch from the current directory into that store.\n`
  );
}

function mcpArgs(opts) {
  const config = {
    mcpServers: {
      "agent-switch": {
        command: process.execPath,
        args: [path.join(__dirname, "mcp.js")],
        env: {
          AGENT_SWITCH_ROOT: opts.dir,
          AGENT_SWITCH_CWD: process.cwd(),
        },
      },
    },
  };
  return ["--mcp-config", JSON.stringify(config)];
}

// Run `codex doctor` and parse the auth mode / endpoint so we can warn the user
// when Codex is configured with ChatGPT auth (wss:// websocket transport), which
// bypasses OPENAI_BASE_URL and therefore never reaches our proxy.
function detectCodexChatGPTAuth(env = process.env) {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };

    let child;
    try {
      child = spawnCommand("codex", ["doctor"], { stdio: ["ignore", "pipe", "pipe"], env });
    } catch {
      return finish(null);
    }

    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(null); }, 5000);
    const collect = (d) => { output += d; };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", () => { clearTimeout(timer); finish(null); });
    child.on("close", () => {
      clearTimeout(timer);
      const authMatch = output.match(/auth\s+mode\s+(\S+)/i);
      const endpointMatch = output.match(/endpoint\s+(\S+)/i);
      finish({
        authMode: authMatch?.[1]?.toLowerCase() ?? null,
        endpoint: endpointMatch?.[1] ?? null,
      });
    });
  });
}

// Read model_providers.*.base_url from ~/.codex/config.toml. Codex prioritizes
// config.toml over OPENAI_BASE_URL, so we must read the configured upstream from
// there and override it via -c flag when spawning codex.
function codexConfigBaseUrl(env = process.env) {
  const configRoot = env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const configPath = path.join(configRoot, "config.toml");
  if (!fs.existsSync(configPath)) return null;
  const toml = fs.readFileSync(configPath, "utf8");
  const m = toml.match(/^\[model_providers\.(\S+)\][^\[]*?^base_url\s*=\s*"([^"]+)"/m);
  return m ? { provider: m[1], baseUrl: m[2] } : null;
}
// Read the provider's base-URL env var from Claude Code's settings.json env
// block. A provider switcher (cc-switch etc.) writes the active provider's base
// URL here, which otherwise makes claude bypass our proxy. Project settings
// shadow user settings in Claude Code's precedence, so check them in the same
// order. The env var differs by mode: ANTHROPIC_BASE_URL for vanilla Claude,
// ANTHROPIC_BEDROCK_BASE_URL when CLAUDE_CODE_USE_BEDROCK=1, etc.
function settingsEnvBaseUrl(envVar, env = process.env) {
  if (env.AGENT_SWITCH_IGNORE_CLAUDE_SETTINGS === "1") return null;
  const userSettings = env.CLAUDE_CONFIG_DIR
    ? path.join(env.CLAUDE_CONFIG_DIR, "settings.json")
    : path.join(os.homedir(), ".claude", "settings.json");
  const files = [
    path.resolve(".claude/settings.local.json"),
    path.resolve(".claude/settings.json"),
    userSettings,
  ];
  for (const f of files) {
    try {
      const url = JSON.parse(fs.readFileSync(f, "utf8"))?.env?.[envVar];
      if (url) return url;
    } catch {}
  }
  return null;
}

function headroomCommand() {
  return "headroom";
}

function checkHeadroomCli() {
  const result = spawnSync(headroomCommand(), ["--version"], {
    encoding: "utf8",
    shell: false,
  });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      return { ok: false, error: "headroom CLI was not found in PATH" };
    }
    return { ok: false, error: result.error.message };
  }
  if ((result.status ?? 1) !== 0) return { ok: false, error: (result.stderr || result.stdout || "").trim() || `exit ${result.status}` };
  return { ok: true, version: (result.stdout || result.stderr || "").trim() };
}

async function compactCmd(args, opts) {
  const sub = args[0];
  if (sub === "install") {
    process.stdout.write(
      "agent-switch compact uses external Headroom. Install and start it separately:\n\n" +
      "  pip install \"headroom-ai[proxy]\"\n" +
      "  headroom proxy\n\n" +
      "The agent-switch package includes the Headroom JavaScript SDK dependency when built from this repository.\n" +
      "RTK is intentionally not initialized by agent-switch compact v1.\n"
    );
    return;
  }
  if (sub !== "doctor") {
    process.stdout.write("Usage: agent-switch compact doctor|install [--compact-base-url <url>]\n");
    return;
  }
  const cli = checkHeadroomCli();
  const sdk = await checkHeadroomSdk();
  const proxy = await checkHeadroomProxy(opts.compact.baseUrl);
  const line = (name, r) => `${r.ok ? "ok" : "fail"} ${name}${r.version ? ` ${r.version}` : ""}${r.status ? ` HTTP ${r.status}` : ""}${r.error ? ` - ${r.error}` : ""}`;
  process.stdout.write(
    [
      `Headroom compact doctor (${opts.compact.baseUrl})`,
      line("headroom CLI", cli),
      line("headroom-ai SDK", sdk),
      line("Headroom proxy", proxy),
      "",
      "If the proxy check fails, run: headroom proxy",
    ].join("\n") + "\n"
  );
}

function profileCmd(args, opts) {
  const sub = args[0];
  try {
    if (sub === "new") {
      if (!args[1]) return void process.stdout.write("Usage: agent-switch profile new <tool>/<name> [--shared]\n");
      const profile = createProfile(args[1], { shared: opts.shared });
      const shared = profile.linked.length
        ? `\nshared: ${profile.linked.map((x) => `${x.name} (${x.mode})`).join(", ")}`
        : opts.shared ? "\nshared: no default files found to share" : "";
      process.stdout.write(`created profile ${profile.spec}\npath: ${profile.dir}${shared}\n`);
      return;
    }
    if (sub === "list") {
      const rows = listProfiles(args[1] || null);
      if (!rows.length) {
        process.stdout.write("no profiles found\n");
        return;
      }
      process.stdout.write(rows.map((p) => `${p.spec}\t${p.dir}`).join("\n") + "\n");
      return;
    }
    if (sub === "path") {
      if (!args[1]) return void process.stdout.write("Usage: agent-switch profile path <tool>/<name>\n");
      const parsed = parseProfileSpec(args[1]);
      process.stdout.write(profileDir(parsed.tool, parsed.name) + "\n");
      return;
    }
    if (sub === "delete" || sub === "rm") {
      if (!args[1]) return void process.stdout.write("Usage: agent-switch profile delete <tool>/<name> --yes\n");
      const deleted = deleteProfile(args[1], { yes: opts.yes });
      process.stdout.write(`deleted profile ${deleted.spec}\npath: ${deleted.dir}\n`);
      return;
    }
    process.stdout.write(
      "Usage:\n" +
      "  agent-switch profile new <tool>/<name> [--shared]\n" +
      "  agent-switch profile list [tool]\n" +
      "  agent-switch profile path <tool>/<name>\n" +
      "  agent-switch profile delete <tool>/<name> --yes\n"
    );
  } catch (e) {
    if (e instanceof ProfileError) {
      process.stderr.write(`agent-switch profile: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
}

function isLocalhostUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function checkLocalUpstream(upstream, timeoutMs = 1200) {
  if (!isLocalhostUrl(upstream)) return Promise.resolve(null);
  let url;
  try {
    url = new URL(upstream);
  } catch {
    return Promise.resolve(null);
  }
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (message) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(message);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(null));
    socket.once("timeout", () => finish(`connection timed out after ${timeoutMs}ms`));
    socket.once("error", (e) => finish(e.message));
  });
}

function askLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (ans) => {
      rl.close();
      resolve(String(ans || "").trim());
    });
  });
}

function color(code, text) {
  return process.stderr.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, "");
}

function trimDisplay(text, width) {
  const plain = stripAnsi(text);
  if (plain.length <= width) return text;
  return `${plain.slice(0, Math.max(1, width - 1))}…`;
}

function interactiveSelect({ title, hint = "Type to search", right = "", items }) {
  return new Promise((resolve) => {
    const input = process.stdin;
    const output = process.stderr;
    const rows = Math.max(8, output.rows || 24);
    const width = Math.max(48, output.columns || 100);
    const maxItems = Math.max(3, Math.min(10, rows - 7));
    let query = "";
    let selected = 0;
    let renderedLines = 0;
    let done = false;

    // Resume stdin in case a previous releaseStdinForChild() paused it (e.g. after a
    // child process spawn). Without this, the second interactiveSelect call (used by
    // the "remove auth" flow) renders the menu but never receives keypresses.
    input.resume();

    readline.emitKeypressEvents(input);
    const wasRaw = Boolean(input.isRaw);
    if (input.isTTY) input.setRawMode(true);

    const cleanup = () => {
      input.off("keypress", onKeypress);
      if (input.isTTY) input.setRawMode(wasRaw);
      output.write("\x1b[?25h");
    };

    const filtered = () => {
      const q = query.trim().toLowerCase();
      if (!q) return items;
      return items.filter((item) =>
        [item.label, item.detail, item.search]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q))
      );
    };

    const render = () => {
      const list = filtered();
      if (selected >= list.length) selected = Math.max(0, list.length - 1);
      const start = Math.max(0, Math.min(selected - Math.floor(maxItems / 2), Math.max(0, list.length - maxItems)));
      const visible = list.slice(start, start + maxItems);
      output.write("\x1b[?25l");
      if (renderedLines) output.write(`\x1b[${renderedLines}F\x1b[J`);

      const rightText = right ? color("90", right) : "";
      const titleLine = `${color("36;1", title)}${rightText ? `${" ".repeat(Math.max(2, width - stripAnsi(title).length - stripAnsi(rightText).length))}${rightText}` : ""}`;
      const searchLine = query ? `${color("90", "Search:")} ${color("33", query)}` : color("90", hint);
      const lines = [titleLine, "", searchLine];

      if (!list.length) {
        lines.push("", color("90", "No matches"));
      } else {
        for (const [offset, item] of visible.entries()) {
          const active = start + offset === selected;
          const prefix = active ? color("33;1", "›") : " ";
          const label = active ? color("33;1", item.label) : item.label;
          const detail = item.detail ? `  ${color("90", item.detail)}` : "";
          lines.push(`${prefix} ${trimDisplay(`${label}${detail}`, width - 4)}`);
        }
      }

      lines.push("", color("90", "↑/↓ move  Enter select  Esc cancel  Backspace edit"));
      output.write(lines.join("\n") + "\n");
      renderedLines = lines.length;
    };

    const finish = (value) => {
      if (done) return;
      done = true;
      cleanup();
      if (renderedLines) output.write(`\x1b[${renderedLines}F\x1b[J`);
      resolve(value);
    };

    const onKeypress = (str, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.kill(process.pid, "SIGINT");
        return;
      }
      const list = filtered();
      if (key.name === "return") return finish(list[selected] || null);
      if (key.name === "escape") return finish(null);
      if (key.name === "up") selected = Math.max(0, selected - 1);
      else if (key.name === "down") selected = Math.min(Math.max(0, list.length - 1), selected + 1);
      else if (key.name === "backspace") {
        query = query.slice(0, -1);
        selected = 0;
      } else if (str && !key.ctrl && !key.meta && str >= " ") {
        query += str;
        selected = 0;
      }
      render();
    };

    input.on("keypress", onKeypress);
    render();
  });
}

function releaseStdinForChild() {
  if (!process.stdin.isTTY) return;
  try {
    process.stdin.setRawMode(false);
  } catch {}
  process.stdin.pause();
}

function localUpstreamHint(upstream, provider) {
  return (
    `agent-switch: local upstream is not reachable: ${upstream}\n` +
    `  ${provider.envVar} points there, but no service accepted the connection.\n` +
    `  If this is CC Switch, start or restart CC Switch and make sure it listens on this port.\n` +
    `  Or pass a working upstream explicitly: agent-switch claude --upstream <url>\n`
  );
}

function diagnoseUpstreamFailure(store, upstream, provider) {
  const bad = store.entries.find((rec) =>
    rec.response?.status === 400 &&
    String(rec.response?.raw || "").includes("Request body format invalid")
  );
  if (!bad || !isLocalhostUrl(upstream)) return;
  process.stderr.write(
    `\n  \x1b[33m!\x1b[0m  agent-switch: local upstream returned 400 Request body format invalid.\n` +
    `     Upstream: ${upstream}\n` +
    `     Source: ${provider.envVar} from Claude Code settings/env.\n` +
    `     agent-switch captured and forwarded Claude's request; the local router rejected it.\n` +
    `     If this is CC Switch, enable its smart routing/compatible route, or pass --upstream <compatible Anthropic API>.\n`
  );
}

function targetInstallHint(command, provider, requestedCommand = command) {
  const key = String(command || "").toLowerCase();
  if (key === "claude") {
    const prefix = provider.label !== "Claude Code" ? `\n${provider.label} runs through Claude Code.\n` : "\n";
    return prefix +
      `Install Claude Code:\n` +
      `  Windows: winget install Anthropic.ClaudeCode\n` +
      `  Windows alternative: irm https://claude.ai/install.ps1 | iex\n` +
      `  macOS/Linux: curl -fsSL https://claude.ai/install.sh | bash\n` +
      `  macOS Homebrew: brew install --cask claude-code\n\n` +
      `After installing, reopen your terminal and run:\n` +
      `  claude\n` +
      `  agent-switch ${requestedCommand || "claude"}\n`;
  }
  if (key === "codex") {
    return `\nInstall the Codex CLI that provides the \`codex\` command, then reopen your terminal.\n\n` +
      `After installing, verify with:\n` +
      `  codex --help\n` +
      `  agent-switch codex\n`;
  }
  if (key === "codewhale" || key === "codewhale-tui" || key === "deepseek" || key === "deepseek-tui") {
    return `\nInstall CodeWhale, the renamed DeepSeek-TUI CLI. It provides the new \`codewhale\` command and may provide legacy shims for \`deepseek\` / \`deepseek-tui\` during the transition.\n\n` +
      `Install CodeWhale:\n` +
      `  npm install -g codewhale\n` +
      `  cargo install codewhale-cli --locked\n` +
      `  cargo install codewhale-tui --locked\n\n` +
      `After installing, verify with:\n` +
      `  codewhale doctor\n` +
      `  agent-switch codewhale\n`;
  }
  if (key === "opencode") {
    return `\nInstall the OpenCode CLI that provides the \`opencode\` command, then reopen your terminal.\n\n` +
      `After installing, verify with:\n` +
      `  opencode --help\n` +
      `  agent-switch opencode\n`;
  }
  return `\nInstall '${command}' and make sure it is available in your PATH, then reopen your terminal.\n`;
}

async function prepareCodexProfileAuth(runProfile) {
  if (!runProfile || runProfile.tool !== "codex") return null;
  importExistingCodexProfileAuth(runProfile);
  while (true) {
    const account = await chooseCodexAuthAccount(runProfile);
    if (account) {
      const injected = injectCodexAuthAccount(runProfile.dir, account.id);
      process.stderr.write(
        `  \x1b[36m*\x1b[0m agent-switch codex auth ${displayCodexAccount(injected)} -> ${runProfile.spec}\n`
      );
      return injected;
    }
  }
}

function importExistingCodexProfileAuth(runProfile) {
  const authPath = path.join(runProfile.dir, "auth.json");
  if (!fs.existsSync(authPath)) return;
  try {
    saveCodexAuthAccountFromDir(runProfile.dir);
  } catch {}
}

async function chooseCodexAuthAccount(runProfile) {
  const scripted = process.env.AGENT_SWITCH_CODEX_AUTH_CHOICE;
  const accounts = listCodexAuthAccounts();
  if (!scripted && !process.stdin.isTTY) {
    throw new ProfileError(
      "codex --profile needs an interactive terminal to choose or add auth. Run it from PowerShell or another TTY."
    );
  }

  const choices = [];
  choices.push({ kind: "add", label: "add auth" });
  for (const account of accounts) choices.push({ kind: "use", account, label: displayCodexAccount(account) });
  if (accounts.length) choices.push({ kind: "remove", label: "remove auth" });

  const choice = scripted
    ? resolveCodexAuthMenuChoice(scripted, choices, accounts)
    : await interactiveSelect({
      title: "Select Codex auth",
      hint: "Type to search saved auth",
      right: `${runProfile.spec}  ${codexAuthStoreRoot()}`,
      items: choices.map((choice) => ({
        ...choice,
        label: choice.label,
        detail: choice.kind === "add"
          ? "login a new Codex account"
          : choice.kind === "remove"
            ? "delete a saved auth"
            : "saved auth",
        search: `${choice.label} ${choice.account?.email || ""} ${choice.account?.id || ""}`,
      })),
    });
  if (!choice) throw new ProfileError("auth selection was cancelled");
  if (choice.kind === "add") return addCodexAuth();
  if (choice.kind === "use") return choice.account;
  if (choice.kind === "remove") {
    await removeCodexAuth(accounts, scripted);
    return null;
  }
  return null;
}

function resolveCodexAuthMenuChoice(answer, choices, accounts) {
  const raw = String(answer || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "add") return choices.find((c) => c.kind === "add");
  if (lower === "first") return accounts[0] ? { kind: "use", account: accounts[0] } : null;
  if (lower === "remove") return choices.find((c) => c.kind === "remove");
  if (lower.startsWith("remove:")) return { kind: "remove", accountId: raw.slice("remove:".length).trim() };
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric > 0 && numeric <= choices.length) return choices[numeric - 1];
  const account = accounts.find((a) => a.id === raw || a.label === raw || a.email === raw);
  return account ? { kind: "use", account } : null;
}

async function addCodexAuth() {
  const storeRoot = codexAuthStoreRoot();
  fs.mkdirSync(storeRoot, { recursive: true });
  const loginDir = fs.mkdtempSync(path.join(storeRoot, "login-"));
  process.stderr.write(
    `\nagent-switch: starting Codex login for a new saved auth.\n` +
    `Complete the Codex login flow, then agent-switch will save it into the local auth store.\n\n`
  );
  try {
    const code = await runCodexLogin(loginDir);
    if (code !== 0) throw new ProfileError(`Codex login exited with code ${code}`);
    const { account } = saveCodexAuthAccountFromDir(loginDir);
    process.stderr.write(`agent-switch: saved Codex auth ${displayCodexAccount(account)}\n`);
    return account;
  } finally {
    fs.rmSync(loginDir, { recursive: true, force: true });
  }
}

function runCodexLogin(loginDir) {
  return new Promise((resolve) => {
    let child;
    try {
      releaseStdinForChild();
      child = spawnCommand("codex", ["login"], {
        stdio: "inherit",
        env: { ...process.env, CODEX_HOME: loginDir },
      });
    } catch (e) {
      if (e.code === "ENOENT") {
        process.stderr.write(`\nagent-switch: command not found: codex\n`);
        process.stderr.write(targetInstallHint("codex", { label: "Codex" }, "codex"));
      } else {
        process.stderr.write(`\nagent-switch: ${e.message}\n`);
      }
      return resolve(1);
    }
    child.on("error", (e) => {
      if (e.code === "ENOENT") {
        process.stderr.write(`\nagent-switch: command not found: codex\n`);
        process.stderr.write(targetInstallHint("codex", { label: "Codex" }, "codex"));
      } else {
        process.stderr.write(`\nagent-switch: ${e.message}\n`);
      }
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

async function removeCodexAuth(accounts, scripted) {
  if (!accounts.length) {
    process.stderr.write("agent-switch: no saved Codex auth accounts to remove.\n");
    return;
  }
  const removeId = scripted?.startsWith("remove:") ? scripted.slice("remove:".length).trim() : null;
  let target = removeId ? accounts.find((a) => a.id === removeId || a.label === removeId || a.email === removeId) : null;
  if (!target) {
    if (!scripted) {
      const selected = await interactiveSelect({
        title: "Remove Codex auth",
        hint: "Type to search saved auth",
        right: codexAuthStoreRoot(),
        items: accounts.map((account) => ({
          account,
          label: displayCodexAccount(account),
          detail: account.id,
          search: `${account.id} ${account.label || ""} ${account.email || ""}`,
        })),
      });
      target = selected?.account || null;
    }
  }
  if (!target) throw new ProfileError("invalid auth removal selection");
  removeCodexAuthAccount(target.id);
  process.stderr.write(`agent-switch: removed Codex auth ${displayCodexAccount(target)}\n`);
}

function displayCodexAccount(account) {
  const label = account.label || account.email || account.id;
  const email = account.email && account.email !== label ? ` <${account.email}>` : "";
  const mode = account.authMode ? ` ${account.authMode}` : "";
  return `${label}${email}${mode}`;
}

function maybeDefaultCodexResume(args, runProfile) {
  if (!runProfile || runProfile.tool !== "codex") return args;
  if (args.length) return args;
  if (!hasCodexSessions(runProfile.dir)) return args;
  process.stderr.write(
    `  \x1b[36m*\x1b[0m agent-switch: no Codex args supplied; resuming latest ${runProfile.spec} session with \`resume --last\`\n`
  );
  return ["resume", "--last"];
}

function hasCodexSessions(profileDir) {
  const root = path.join(profileDir, "sessions");
  if (!fs.existsSync(root)) return false;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.startsWith("rollout-")) return true;
    }
  }
  return false;
}

async function wrap(command, args, opts) {
  const provider = resolveProvider(command, opts.provider, opts.envVar);
  let runProfile = null;
  try {
    runProfile = resolveRunProfile(provider, opts.profile, process.env, {
      createIfMissing: provider.command === "codex" && Boolean(opts.profile),
    });
    if (runProfile?.tool === "codex") await prepareCodexProfileAuth(runProfile);
    args = maybeDefaultCodexResume(args, runProfile);
  } catch (e) {
    if (e instanceof ProfileError) {
      process.stderr.write(`agent-switch: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
  const childBaseEnv = runProfile ? { ...process.env, ...runProfile.env } : process.env;
  const claudeBased = provider.command === "claude";
  if (opts.compact.enabled) {
    if (opts.compact.engine !== "headroom") {
      process.stderr.write(`agent-switch: unsupported compact engine "${opts.compact.engine}" (v1 supports: headroom)\n`);
      process.exit(1);
    }
    if (!["open", "closed"].includes(opts.compact.fail)) {
      process.stderr.write(`agent-switch: invalid --compact-fail "${opts.compact.fail}" (use open or closed)\n`);
      process.exit(1);
    }
    if (!isClaudeCompactProvider(provider)) {
      process.stderr.write("agent-switch: --compact is only supported for Claude Code based providers in v1.\n");
      process.stderr.write("  Supported: claude, kimi, bedrock, vertex.\n");
      process.exit(1);
    }
  }

  // Detect Codex ChatGPT-auth / websocket mode early so we can warn the user
  // before opening the (otherwise empty) dashboard.
  let codexChatGPTInfo = null;
  if (provider.command === "codex") {
    const info = await detectCodexChatGPTAuth(childBaseEnv);
    if (info?.authMode === "chatgpt" || info?.endpoint?.startsWith("wss://")) {
      codexChatGPTInfo = info;
    }
  }

  // If a provider switcher wrote ANTHROPIC_BASE_URL into settings.json and the
  // user didn't override --upstream, forward there by default (the plain claude
  // provider's default upstream is anthropic.com; kimi etc. keep their own).
  const settingsBaseUrl = claudeBased ? settingsEnvBaseUrl(provider.envVar, childBaseEnv) : null;
  const codexBased = provider.command === "codex" && !provider.autoUpstream;
  const codexConfig = codexBased ? codexConfigBaseUrl(childBaseEnv) : null;
  let upstream = opts.upstream
    || (codexConfig && codexConfig.baseUrl)
    || (provider.upstream === "auto" ? null : provider.upstream);
  // autoUpstream: resolve upstream from the same env var we're about to override
  if (!upstream && provider.autoUpstream) upstream = childBaseEnv[provider.envVar];
  // Picking the upstream from settings.json covers two cases: vanilla Claude
  // (default upstream is anthropic.com, switchers write ANTHROPIC_BASE_URL) and
  // autoUpstream providers like bedrock/vertex (no fixed upstream -settings.json
  // is often where the user's gateway URL lives).
  if (!opts.upstream && settingsBaseUrl && (provider.upstream === "https://api.anthropic.com" || provider.autoUpstream)) {
    upstream = settingsBaseUrl;
    process.stderr.write(`  \x1b[36m*\x1b[0m agent-switch: upstream from Claude Code settings.json ->${upstream}\n`);
  }
  if (!opts.upstream && codexConfig) {
    process.stderr.write(`  \x1b[36m*\x1b[0m agent-switch: upstream from Codex config.toml ->${codexConfig.baseUrl}\n`);
  }
  // A provider switcher (e.g. cc-switch) may have set ANTHROPIC_BASE_URL directly in the
  // environment rather than in settings.json -pick it up so the proxy forwards to the
  // right third-party API instead of defaulting to api.anthropic.com.
  if (!opts.upstream && !settingsBaseUrl && claudeBased && childBaseEnv[provider.envVar] &&
      provider.upstream === "https://api.anthropic.com") {
    upstream = childBaseEnv[provider.envVar];
    process.stderr.write(`  \x1b[36m*\x1b[0m agent-switch: upstream from ${provider.envVar} env ->${upstream}\n`);
  }

  if (!upstream) {
    process.stderr.write(
      `agent-switch: ${provider.label} needs an upstream URL.\n` +
      `  Set ${provider.envVar} in your environment, or pass --upstream <url>.\n`
    );
    process.exit(1);
  }

  try {
    const parsedUpstream = new URL(upstream);
    if (parsedUpstream.protocol !== "http:" && parsedUpstream.protocol !== "https:") {
      throw new Error("bad protocol");
    }
  } catch {
    process.stderr.write(
      `agent-switch: invalid upstream URL: "${upstream}"\n` +
      `  The URL must start with http:// or https://, e.g. https://api.openai.com\n` +
      `  Check the value of ${provider.envVar} in your environment, or pass --upstream <url>.\n`
    );
    process.exit(1);
  }

  const localUpstreamError = await checkLocalUpstream(upstream);
  if (localUpstreamError) {
    process.stderr.write(localUpstreamHint(upstream, provider));
    process.stderr.write(`  connection error: ${localUpstreamError}\n`);
    process.exit(1);
  }

  if (provider.mcp && opts.mcp) args = [...mcpArgs(opts), ...args];

  maybeLegacyHint(process.cwd(), opts.dir);

  const store = new Store({ root: opts.dir, redact: opts.redact, format: provider.format });
  const proxy = createProxy({ upstream, store, compact: opts.compact });
  const dashboard = createServer({ roots: opts.readRoots, store, meta: { profileName: opts.profile || null, compactEnabled: opts.compact.enabled } });

  const proxyPort = await listen(proxy, opts.proxyPort);
  const dashPort = await listen(dashboard, opts.port);
  const dashUrl = `http://127.0.0.1:${dashPort}`;
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;
  args = proxyArgs(args, provider.envVar, proxyUrl, childBaseEnv, upstream);

  process.stderr.write(banner(dashUrl, provider, upstream));
  if (runProfile) {
    process.stderr.write(`  \x1b[36m*\x1b[0m agent-switch profile ${runProfile.spec} -> ${runProfile.dir}\n`);
  }
  if (codexChatGPTInfo) {
    const ep = codexChatGPTInfo.endpoint ? ` (${codexChatGPTInfo.endpoint})` : "";
    process.stderr.write(
      `  \x1b[33m!\x1b[0m  Codex is using ChatGPT auth${ep}.\n` +
      `     This websocket transport bypasses OPENAI_BASE_URL -the dashboard will be empty.\n` +
      `     To capture traffic, switch Codex to API-key mode (OPENAI_API_KEY).\n\n`
    );
  }
  // Direct AWS Bedrock signs requests with SigV4, which covers the Host header.
  // A reverse proxy rewrites Host before forwarding, so AWS rejects with a
  // signature mismatch. The fix only works with Bedrock-compat gateways that
  // don't sign on Host (bearer tokens, mTLS, etc.).
  if (provider.envVar === "ANTHROPIC_BEDROCK_BASE_URL") {
    try {
      const host = new URL(upstream).hostname;
      if (host.endsWith(".amazonaws.com")) {
        process.stderr.write(
          `  \x1b[33m!\x1b[0m  Direct AWS Bedrock (${host}) uses SigV4 signing that includes the Host header.\n` +
          `     agent-switch rewrites Host when forwarding, so AWS will reject the proxied request.\n` +
          `     Point ANTHROPIC_BEDROCK_BASE_URL at a Bedrock-compat gateway in front of AWS instead.\n\n`
        );
      }
    } catch {}
  }
  if (opts.open) openBrowser(dashUrl);

  // Command-line --settings outranks ~/.claude/settings.json and deep-merges
  // (the user's hooks/plugins/theme are preserved), so this reliably points
  // claude at our proxy even when a switcher set a base URL there -and sidesteps
  // the env-var precedence regression in some Claude Code versions.
  if (claudeBased && opts.settingsOverride && !provider.noSettings) {
    if (settingsBaseUrl)
      process.stderr.write(`  \x1b[33mnote:\x1b[0m settings.json sets ${provider.envVar}=${settingsBaseUrl}; overriding it so claude hits the proxy\n`);
    args = ["--settings", JSON.stringify({ env: { [provider.envVar]: proxyUrl } }), ...args];
  }

  // Codex config.toml base_url outranks OPENAI_BASE_URL. Override it via -c
  // so codex talks to our proxy instead of going direct.
  if (codexBased && codexConfig) {
    const configKey = `model_providers.${codexConfig.provider}.base_url`;
    // Use proxyUrl (origin only, no path). Codex appends the endpoint path
    // (e.g. /responses) to base_url. The upstream URL retains the /v1 prefix,
    // so proxy receives /responses and correctly forwards to /v1/responses.
    args = ["-c", `${configKey}="${proxyUrl}"`, ...args];
    if (codexConfig.baseUrl)
      process.stderr.write(`  \x1b[33mnote:\x1b[0m config.toml sets ${configKey}=${codexConfig.baseUrl}; overriding via -c\n`);
  }

  const spawnCmd = provider.command || command;
  releaseStdinForChild();
  const child = spawnCommand(spawnCmd, args, {
    stdio: "inherit",
    env: { ...childBaseEnv, [provider.envVar]: proxyUrl },
  });

  const shutdown = (code) => {
    proxy.close();
    dashboard.close();
    process.exit(code ?? 0);
  };

  child.on("error", (e) => {
    if (e.code === "ENOENT") {
      process.stderr.write(`\nagent-switch: command not found: ${spawnCmd}\n`);
      process.stderr.write(targetInstallHint(spawnCmd, provider, command));
    } else {
      process.stderr.write(`\nagent-switch: ${e.message}\n`);
    }
    shutdown(1);
  });
  child.on("exit", (code) => {
    diagnoseUpstreamFailure(store, upstream, provider);
    process.stderr.write(`\n  \x1b[36m*\x1b[0m agent-switch: ${spawnCmd} exited. Logs saved to ${path.relative(process.cwd(), store.sessionDir)}\n`);
    process.stderr.write(`    Open the dashboard anytime with: agent-switch dashboard\n`);
    shutdown(code ?? 0);
  });

  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
}

async function view(opts) {
  const hasAny = opts.readRoots.some((r) => fs.existsSync(r));
  if (!hasAny) {
    process.stderr.write(`agent-switch: no logs found. Run \`agent-switch\` first.\n`);
    process.exit(1);
  }
  const dashboard = createServer({ roots: opts.readRoots, store: null });
  const dashPort = await listen(dashboard, opts.port);
  const dashUrl = `http://127.0.0.1:${dashPort}`;
  process.stderr.write(`\n  \x1b[36m*\x1b[0m agent-switch dashboard: \x1b[1m${dashUrl}\x1b[0m  (viewing saved logs -Ctrl-C to stop)\n`);
  if (opts.open !== false) openBrowser(dashUrl);
}

export { exportEntry, migrate, repack, rmCmd } from "./log-cli.js";

export async function main(argv) {
  const { opts, rest } = parseArgs(argv);
  const cwd = process.cwd();

  if (!opts.dir) opts.dir = globalRoot(cwd);
  opts.readRoots = readRoots(opts.dir, cwd);

  const cmd = rest[0];

  if (rest.includes("-h") || rest.includes("--help")) return void process.stdout.write(HELP + "\n");
  if (rest.includes("-v") || rest.includes("--version")) return void process.stdout.write(VERSION + "\n");

  if (cmd === "dashboard" || cmd === "webui" || cmd === "view") return view(opts);
  if (cmd === "compact") return compactCmd(rest.slice(1), opts);
  if (cmd === "profile") return profileCmd(rest.slice(1), opts);
  if (cmd === "migrate") return migrate(opts);
  if (cmd === "repack") { opts.session = rest[1]; return repack(opts); }
  if (cmd === "rm") return rmCmd(rest[1], opts);
  if (cmd === "export") return exportEntry(rest[1], opts);
  if (cmd === "run") {
    const dashIdx = rest.indexOf("--");
    const cmdArgs = dashIdx >= 0 ? rest.slice(dashIdx + 1) : rest.slice(1);
    if (!cmdArgs.length) return void process.stderr.write("agent-switch run: nothing to run. Use `agent-switch run -- <cmd>`\n");
    return wrap(cmdArgs[0], cmdArgs.slice(1), opts);
  }

  // No command: interactive picker (falls back to help when non-interactive).
  if (!cmd) {
    const key = await pickProvider();
    if (!key) return void process.stdout.write(HELP + "\n");
    return wrap(key, [], opts);
  }

  // Default: treat the first token as a provider/command to wrap.
  return wrap(cmd, rest.slice(1), opts);
}
