import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { prepareSpawn, resolveWindowsCommand } from "../src/spawn-command.js";

function tempCommand(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-spawn-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, "");
  return { dir, file };
}

test("prepareSpawn leaves native commands unchanged off Windows", () => {
  const prepared = prepareSpawn("codex", ["-c", "x"], {}, "linux");
  assert.deepEqual(prepared, { command: "codex", args: ["-c", "x"] });
});

test("resolveWindowsCommand finds PATHEXT shims on PATH", () => {
  const { dir, file } = tempCommand("codex.cmd");
  const env = { PATH: dir, PATHEXT: ".EXE;.CMD" };

  assert.equal(resolveWindowsCommand("codex", env, "win32"), file);
});

test("resolveWindowsCommand prefers real executables over WindowsApps aliases", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-spawn-winapps-"));
  const aliasDir = path.join(root, "AppData", "Local", "Microsoft", "WindowsApps");
  const realDir = path.join(root, "AppData", "Local", "OpenAI", "Codex", "bin");
  fs.mkdirSync(aliasDir, { recursive: true });
  fs.mkdirSync(realDir, { recursive: true });
  const alias = path.join(aliasDir, "codex.exe");
  const real = path.join(realDir, "codex.exe");
  fs.writeFileSync(alias, "");
  fs.writeFileSync(real, "");
  const env = { PATH: [aliasDir, realDir].join(path.delimiter), PATHEXT: ".EXE" };

  assert.equal(resolveWindowsCommand("codex", env, "win32"), real);
});

test("resolveWindowsCommand finds the Codex desktop CLI outside PATH", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-spawn-codex-"));
  const codex = path.join(root, "OpenAI", "Codex", "bin", "codex.exe");
  fs.mkdirSync(path.dirname(codex), { recursive: true });
  fs.writeFileSync(codex, "");
  const env = { PATH: "", PATHEXT: ".EXE", LOCALAPPDATA: root };

  assert.equal(resolveWindowsCommand("codex", env, "win32"), codex);
});

test("resolveWindowsCommand prefers a PATH npm shim over the Codex desktop fallback", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-spawn-npm-codex-"));
  const npmDir = path.join(root, "nodejs");
  const localAppData = path.join(root, "AppData", "Local");
  const desktopCodex = path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe");
  const npmCodex = path.join(npmDir, "codex.cmd");
  fs.mkdirSync(npmDir, { recursive: true });
  fs.mkdirSync(path.dirname(desktopCodex), { recursive: true });
  fs.writeFileSync(path.join(npmDir, "codex"), "");
  fs.writeFileSync(npmCodex, "");
  fs.writeFileSync(desktopCodex, "");
  const env = { PATH: npmDir, PATHEXT: ".EXE;.CMD", LOCALAPPDATA: localAppData };

  assert.equal(resolveWindowsCommand("codex", env, "win32"), npmCodex);
});

test("prepareSpawn runs Windows cmd shims through cmd.exe", () => {
  const { dir, file } = tempCommand("codex.cmd");
  const env = { PATH: dir, PATHEXT: ".EXE;.CMD", ComSpec: "C:\\Windows\\System32\\cmd.exe" };

  const prepared = prepareSpawn(
    "codex",
    ["-c", "model_providers.gaisf_responses.base_url='%CODEX_BASE_URL%'"],
    env,
    "win32"
  );

  assert.equal(prepared.command, env.ComSpec);
  assert.deepEqual(prepared.args.slice(0, 2), ["/d", "/c"]);
  assert.equal(prepared.windowsVerbatimArguments, true);
  assert.match(prepared.args[2], new RegExp(`^call "${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" `));
  assert.match(prepared.args[2], /"model_providers\.gaisf_responses\.base_url='%CODEX_BASE_URL%'"/);
});

test("prepareSpawn runs PowerShell shims through powershell.exe", () => {
  const { dir, file } = tempCommand("codex.ps1");
  const env = { PATH: dir, PATHEXT: ".EXE" };

  const prepared = prepareSpawn("codex", ["--version"], env, "win32");

  assert.equal(prepared.command, "powershell.exe");
  assert.deepEqual(prepared.args, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, "--version"]);
});
