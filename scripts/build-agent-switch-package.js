#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");
const cliDir = path.join(skillRoot, "cli");
const pkg = JSON.parse(fs.readFileSync(path.join(skillRoot, "package.json"), "utf8"));
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args, options = {}) {
  process.stderr.write(`agent-switch package: ${npmCmd} ${args.join(" ")}\n`);
  const result = spawnSync(npmCmd, args, {
    cwd: skillRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.error) {
    process.stderr.write(`agent-switch package: failed to run npm: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

fs.mkdirSync(cliDir, { recursive: true });
for (const name of fs.readdirSync(cliDir)) {
  if (name.startsWith(`${pkg.name}-`) && name.endsWith(".tgz")) {
    fs.rmSync(path.join(cliDir, name), { force: true });
  }
}

let status = run(["install", "--omit=dev"]);
if (status !== 0) process.exit(status);

status = run(["pack", "--pack-destination", cliDir]);
if (status !== 0) process.exit(status);

const packages = fs.readdirSync(cliDir)
  .filter((name) => name.endsWith(".tgz"))
  .map((name) => ({
    name,
    time: fs.statSync(path.join(cliDir, name)).mtimeMs,
  }))
  .sort((a, b) => b.time - a.time);

if (!packages.length) {
  process.stderr.write("agent-switch package: npm pack finished, but no .tgz file was found.\n");
  process.exit(1);
}

process.stdout.write(
  `\nCreated ${path.join(cliDir, packages[0].name)}\n\n` +
  "Install it on any machine with Node.js 18+:\n\n" +
  `  npm install -g ${path.join(cliDir, packages[0].name)}\n\n`
);
