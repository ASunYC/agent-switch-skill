import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { globalRoot, readRoots } from "../../agent-switch-core/src/paths.js";
import { listSessionsMulti, loadSessionMulti, summarize } from "../../agent-switch-core/src/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentSwitchCoreBin = path.resolve(__dirname, "../../agent-switch-core/bin/agent-switch-core.js");

const PASS_THROUGH = new Set(["dashboard", "webui", "view", "migrate", "repack", "rm", "export", "proxy", "profile", "compact", "hermes"]);

export async function main(argv, io = process) {
  if (argv[0] === "install") {
    io.stdout.write(installText());
    return 0;
  }

  const cwd = process.cwd();
  const captureRoot = captureDirFromArgs(argv, cwd);
  const before = newestSession(captureRoot, cwd);
  const handoffFile = path.join(os.tmpdir(), `agent-switch-handoff-${process.pid}-${randomUUID()}.json`);
  const code = await runAgentSwitch(argv, handoffFile);
  const session = readHandoffSession(handoffFile);
  fs.rmSync(handoffFile, { force: true });

  if (shouldPrintHandoff(argv)) {
    io.stderr.write(renderHandoff({ cwd, captureRoot, before, code, session }));
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

function runAgentSwitch(args, handoffFile) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [agentSwitchCoreBin, ...args], {
      stdio: "inherit",
      env: { ...process.env, AGENT_SWITCH_HANDOFF_FILE: handoffFile },
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

function readHandoffSession(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof value?.session === "string" ? value.session : null;
  } catch {
    return null;
  }
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

function renderHandoff({ cwd, captureRoot, before, code, session = null }) {
  const after = session || newestSession(captureRoot, cwd);
  const roots = readRoots(captureRoot, cwd);
  const records = after ? loadSessionMulti(roots, after) : [];
  const latest = records.at(-1);
  const fresh = session ? true : after && after !== before;
  const lines = [];

  lines.push("\nagent-switch: returned to Codex");
  lines.push(`  exit code: ${code}`);
  if (!fresh || !after || !records.length) {
    lines.push("  captured requests: 0");
    lines.push("  note: no agent-switch request logs were found for this run.");
    lines.push("  next: agent-switch dashboard");
    return `${lines.join("\n")}\n`;
  }

  const summary = summarize(latest);
  const latestModel = latestCapturedModel(records);
  const statuses = statusCounts(records);
  const statusText = Object.entries(statuses).map(([k, v]) => `${k}:${v}`).join(", ");
  lines.push(`  session: ${after}`);
  lines.push(`  captured requests: ${records.length}${statusText ? ` (${statusText})` : ""}`);
  lines.push(`  latest request: ${summary.id}`);
  lines.push(`  latest model: ${latestModel || "unknown"}`);
  lines.push(`  dashboard: agent-switch dashboard`);
  lines.push(`  export latest: agent-switch export ${summary.id} --format md`);
  return `${lines.join("\n")}\n`;
}

function latestCapturedModel(records) {
  for (let index = records.length - 1; index >= 0; index--) {
    const model = summarize(records[index]).model;
    if (model) return model;
  }
  return null;
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
  latestCapturedModel,
  readHandoffSession,
  renderHandoff,
  shouldPrintHandoff,
};
