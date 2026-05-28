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
  agent-switch deepseek [args...]     Start DeepSeek-TUI with conversation capture
  agent-switch kimi [args...]         Start Claude Code against Kimi/Moonshot
  agent-switch run --provider P -- <cmd...>
  agent-switch dashboard              Open the dashboard over saved logs
  agent-switch webui                  Alias for dashboard
  agent-switch view                   Alias for dashboard
  agent-switch install                Print install/update commands

Commands such as export, migrate, repack, rm, proxy, --provider, --upstream,
--dir, --open, --no-open, and --no-mcp are handled by agent-switch directly.

Captured CLI runs do not open a browser by default. Use \`agent-switch dashboard\`
or \`agent-switch webui\` when you want the web UI.`;

const PASS_THROUGH = new Set(["dashboard", "webui", "view", "migrate", "repack", "rm", "export", "proxy"]);

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

  npm install -g .

Update after editing the skill:

  npm install -g .

Useful checks:

  agent-switch --help

Run a handoff:

  agent-switch claude

Open the dashboard:

  agent-switch dashboard

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
