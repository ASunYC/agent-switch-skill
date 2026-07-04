import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { globalRoot, readRoots } from "../../agent-switch-core/src/paths.js";
import { listSessionsMulti, loadSessionMulti, summarize } from "../../agent-switch-core/src/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentSwitchCoreBin = path.resolve(__dirname, "../../agent-switch-core/bin/agent-switch-core.js");

const HELP = `agent-switch - run another coding CLI with model-conversation capture, then return a handoff summary

USAGE
  agent-switch claude [args...]       Start Claude Code with conversation capture
  agent-switch codex [args...]        Start Codex with conversation capture
  agent-switch codewhale [args...]    Start CodeWhale with conversation capture
  agent-switch deepseek [args...]     Start DeepSeek-TUI legacy shim with conversation capture
  agent-switch kimi [args...]         Start Claude Code against Kimi/Moonshot
  agent-switch hermes [args...]       Chat with local Hermes API
  agent-switch run --provider P -- <cmd...>
  agent-switch profile new <tool>/<name> [--shared]
  agent-switch profile list [tool]
  agent-switch compact doctor         Check Headroom compact dependencies
  agent-switch compact install        Print Headroom install commands
  agent-switch dashboard              View saved logs (no capture, browse-only)
  agent-switch webui                  Alias for dashboard
  agent-switch view                   Alias for dashboard
  agent-switch install                Print install/update commands

Commands such as export, migrate, repack, rm, proxy, profile, compact,
--provider, --profile, --upstream, --dir, --open, --no-open, --no-mcp, and
--compact are handled by agent-switch directly.

The dashboard is already running during captured CLI runs (e.g. \`agent-switch claude\`).
The URL is printed on startup; open it in another browser tab, or use \`--open\` to auto-open.
Use \`agent-switch dashboard\` (or \`webui\`) later to browse saved logs without starting capture.

Hermes local API:

  agent-switch hermes --health
  agent-switch hermes --list-models
  agent-switch hermes "hello"

Compact mode is explicit and only supports Claude Code based providers in v1:

  agent-switch claude --compact
  agent-switch claude --open          # auto-open the dashboard in your browser

Profiles isolate local CLI accounts/config without changing the working dir:

  agent-switch profile new codex/work     # create a Codex workspace/profile
  agent-switch codex --profile work  # choose auth, then resume latest session
  agent-switch codex --profile work resume --all
  agent-switch profile new claude/work    # create a Claude Code profile
  agent-switch claude --profile work
  agent-switch claude --resume            # show Claude Code's resume/session picker`;

const PASS_THROUGH = new Set(["dashboard", "webui", "view", "migrate", "repack", "rm", "export", "proxy", "profile", "compact", "hermes"]);

export async function main(argv, io = process) {
  if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
    io.stdout.write(HELP + "\n");
    return 0;
  }

  if (argv[0] === "install") {
    io.stdout.write(installText());
    return 0;
  }

  const cwd = process.cwd();
  const captureRoot = captureDirFromArgs(argv, cwd);
  const before = newestSession(captureRoot, cwd);
  const code = await runAgentSwitch(argv);

  if (shouldPrintHandoff(argv)) {
    io.stderr.write(renderHandoff({ cwd, captureRoot, before, code }));
  }

  process.exitCode = code;
  return code;
}

function installText() {
  return `Install from the skill directory:

  node scripts/install-agent-switch.js

Or install the bundled package directly:

  npm install -g cli/agent-switch-skill-0.1.0.tgz

Useful checks:

  agent-switch --help

Run a handoff:

  agent-switch claude

If the target CLI is missing, install it first. For Claude Code:

  winget install Anthropic.ClaudeCode
  irm https://claude.ai/install.ps1 | iex

For CodeWhale:

  npm install -g codewhale
  codewhale doctor

Open the dashboard:

  agent-switch dashboard

Headroom compact mode:

  agent-switch compact install
  agent-switch compact doctor
  agent-switch claude --compact

Hermes local API:

  agent-switch hermes --health
  agent-switch hermes --list-models
  agent-switch hermes "hello"

Profiles:

  agent-switch codex --profile work
  agent-switch codex --profile work resume --all
  agent-switch claude --profile work
  agent-switch claude --resume

`;
}

function runAgentSwitch(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [agentSwitchCoreBin, ...args], {
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", (error) => {
      process.stderr.write(`agent-switch: failed to start internal capture engine: ${error.message}\n`);
      resolve(1);
    });
    child.on("exit", (code, signal) => {
      if (signal) resolve(128 + signalNumber(signal));
      else resolve(code ?? 0);
    });
  });
}

function signalNumber(signal) {
  const signals = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGTERM: 15 };
  return signals[signal] ?? 1;
}

function shouldPrintHandoff(argv) {
  const cmd = argv[0];
  if (PASS_THROUGH.has(cmd)) return false;
  if (cmd === "run") return true;
  return !cmd.startsWith("-");
}

function captureDirFromArgs(argv, cwd) {
  const idx = argv.indexOf("--dir");
  if (idx >= 0 && argv[idx + 1]) return path.resolve(argv[idx + 1]);
  return globalRoot(cwd);
}

function newestSession(root, cwd) {
  const sessions = listSessionsMulti(readRoots(root, cwd));
  return sessions[0] ?? null;
}

function renderHandoff({ cwd, captureRoot, before, code }) {
  const after = newestSession(captureRoot, cwd);
  const roots = readRoots(captureRoot, cwd);
  const records = after ? loadSessionMulti(roots, after) : [];
  const latest = records.at(-1);
  const fresh = after && after !== before;
  const lines = [];

  lines.push("\nagent-switch: returned to Codex");
  lines.push(`  exit code: ${code}`);
  if (!after || !records.length) {
    lines.push("  captured requests: 0");
    lines.push("  note: no agent-switch request logs were found for this run.");
    lines.push("  next: agent-switch dashboard");
    return `${lines.join("\n")}\n`;
  }

  const summary = summarize(latest);
  const statuses = statusCounts(records);
  const statusText = Object.entries(statuses).map(([k, v]) => `${k}:${v}`).join(", ");
  lines.push(`  session: ${after}${fresh ? "" : " (latest existing session)"}`);
  lines.push(`  captured requests: ${records.length}${statusText ? ` (${statusText})` : ""}`);
  lines.push(`  latest request: ${summary.id}`);
  lines.push(`  latest model: ${summary.model || "unknown"}`);
  lines.push(`  dashboard: agent-switch dashboard`);
  lines.push(`  export latest: agent-switch export ${summary.id} --format md`);
  return `${lines.join("\n")}\n`;
}

function statusCounts(records) {
  const counts = {};
  for (const rec of records) {
    const key = rec.response?.error ? "error" : rec.response?.status ? String(rec.response.status) : "pending";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export const internals = {
  captureDirFromArgs,
  renderHandoff,
  shouldPrintHandoff,
};
