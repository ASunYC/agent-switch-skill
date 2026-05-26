import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  projectKey,
  encodeFullPath,
  globalRoot,
  legacyRoot,
  canonicalRoot,
  readRoots,
} from "../src/paths.js";

test("projectKey encodes full path and keeps Unicode", () => {
  const cwd = "/Users/you/project-a";
  const key = projectKey(cwd);
  assert.equal(key, projectKey(path.resolve(cwd)));
  assert.ok(key.includes("project-a"));
  assert.match(key, /-[a-f0-9]{8}$/);
  assert.ok(key.startsWith(encodeFullPath(cwd) + "-"));
});

test("encodeFullPath differs for different resolved paths", () => {
  assert.notEqual(encodeFullPath("/foo/bar"), encodeFullPath("/foo/baz"));
});

test("globalRoot lives under ~/.agent-switch/sessions/<encoded-path-hash>", () => {
  const cwd = "/tmp/my-project";
  const root = globalRoot(cwd);
  assert.ok(root.endsWith(projectKey(cwd)));
});

test("legacyRoot is ./.agent-switch under cwd", () => {
  assert.equal(legacyRoot("/work/repo"), path.join("/work/repo", ".agent-switch"));
});

test("readRoots dedupes when --dir points at legacy", () => {
  const cwd = "/proj";
  const legacy = path.resolve(legacyRoot(cwd));
  const roots = readRoots(legacy, cwd);
  assert.deepEqual(roots, [legacy]);
});

test("readRoots includes global and project legacy", () => {
  const cwd = "/proj";
  const global = path.resolve(globalRoot(cwd));
  const legacy = path.resolve(legacyRoot(cwd));
  const roots = readRoots(global, cwd);
  assert.deepEqual(roots, [global, legacy]);
});

function symlinkOrSkip(t, target, link) {
  try {
    fs.symlinkSync(target, link, "dir");
    return true;
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("symlink creation requires elevated privileges on this Windows host");
      return false;
    }
    throw error;
  }
}

test("readRoots dedupes symlink-equivalent write dir and legacy", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-sym-"));
  try {
    const real = path.join(base, "real");
    const link = path.join(base, "link");
    fs.mkdirSync(real);
    fs.mkdirSync(path.join(real, ".agent-switch"));
    if (!symlinkOrSkip(t, real, link)) return;

    const legacyPath = path.join(link, ".agent-switch");
    const roots = readRoots(legacyPath, link);
    const glassRoots = roots.filter((r) => r.endsWith(".agent-switch"));
    assert.equal(glassRoots.length, 1);
    assert.equal(glassRoots[0], canonicalRoot(path.join(real, ".agent-switch")));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("canonicalRoot resolves through symlink parent when leaf is missing", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-can-"));
  try {
    const real = path.join(base, "real");
    const link = path.join(base, "link");
    fs.mkdirSync(real);
    fs.mkdirSync(path.join(real, ".agent-switch"));
    if (!symlinkOrSkip(t, real, link)) return;

    const viaLink = path.join(link, ".agent-switch");
    const viaReal = path.join(real, ".agent-switch");
    const canonical = canonicalRoot(viaReal);
    assert.equal(canonicalRoot(viaLink), canonical);
    assert.equal(canonicalRoot(viaReal), canonical);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
