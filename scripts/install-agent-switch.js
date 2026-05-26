#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCmd, ["install", "-g", skillRoot], {
  stdio: "inherit",
  shell: false,
});

if (result.status !== 0) process.exit(result.status ?? 1);

const check = spawnSync("agent-switch", ["--help"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(check.status ?? 0);
