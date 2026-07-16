#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnPortable } from "./spawn-portable.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(skillRoot, "package.json"), "utf8"));
const bundledPackage = path.join(skillRoot, "cli", `${pkg.name}-${pkg.version}.tgz`);

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  process.stderr.write(`agent-switch installer: ${command} ${args.join(" ")}\n`);
  const result = spawnPortable(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    process.stderr.write(`agent-switch installer: failed to run ${command}: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

function npmOutput(args) {
  const result = spawnPortable(npmCmd, args, {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

function globalBinDir() {
  const prefix = npmOutput(["prefix", "-g"]);
  if (!prefix) return null;
  return process.platform === "win32" ? prefix : path.join(prefix, "bin");
}

function commandCandidates() {
  const binDir = globalBinDir();
  const names = process.platform === "win32"
    ? ["agent-switch.cmd", "agent-switch.ps1", "agent-switch"]
    : ["agent-switch"];
  const candidates = [];
  if (binDir) {
    for (const name of names) candidates.push(path.join(binDir, name));
  }
  candidates.push("agent-switch");
  return candidates;
}

let installStatus;

if (fs.existsSync(bundledPackage)) {
  installStatus = run(npmCmd, ["install", "-g", bundledPackage]);
} else {
  process.stderr.write(
    `agent-switch installer: bundled CLI package not found: ${bundledPackage}\n` +
    "agent-switch installer: falling back to development install from the skill directory.\n"
  );
  const depsStatus = run(npmCmd, ["ci", "--omit=dev"], { cwd: skillRoot });
  if (depsStatus !== 0) process.exit(depsStatus);
  installStatus = run(npmCmd, ["install", "-g", skillRoot]);
}
if (installStatus !== 0) process.exit(installStatus);

const binDir = globalBinDir();
const env = binDir
  ? { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}` }
  : process.env;

for (const candidate of commandCandidates()) {
  if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
  const status = run(candidate, ["--help"], { env });
  if (status === 0) {
    process.stderr.write("agent-switch installer: agent-switch is installed and verified.\n");
    process.exit(0);
  }
}

process.stderr.write(
  "agent-switch installer: installation finished, but verification failed.\n" +
  `  npm global prefix: ${npmOutput(["prefix", "-g"]) || "(unknown)"}\n` +
  `  expected bin dir: ${binDir || "(unknown)"}\n` +
  "  Try opening a new terminal, then run: agent-switch --help\n"
);
process.exit(1);
