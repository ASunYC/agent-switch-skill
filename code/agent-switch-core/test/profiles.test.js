import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createProfile,
  deleteProfile,
  listProfiles,
  parseProfileSpec,
  profileDir,
  profileEnv,
  profileToolForProvider,
  resolveRunProfile,
  ProfileError,
} from "../src/profiles.js";

function tempEnv() {
  return { AGENT_SWITCH_PROFILE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-profiles-")) };
}

test("parses profile specs with an inferred default tool", () => {
  assert.deepEqual(parseProfileSpec("work", "codex"), { tool: "codex", name: "work", spec: "codex/work" });
  assert.deepEqual(parseProfileSpec("claude/home"), { tool: "claude", name: "home", spec: "claude/home" });
  assert.throws(() => parseProfileSpec("../bad", "codex"), ProfileError);
  assert.throws(() => parseProfileSpec("unknown/work"), /unsupported profile tool/);
});

test("creates, lists, and deletes isolated profile directories", () => {
  const env = tempEnv();
  const created = createProfile("codex/work", { env });

  assert.equal(created.spec, "codex/work");
  assert.equal(created.dir, profileDir("codex", "work", env));
  assert.deepEqual(profileEnv("codex", created.dir), { CODEX_HOME: created.dir });
  assert.ok(fs.existsSync(path.join(created.dir, ".agent-switch-profile.json")));
  assert.deepEqual(listProfiles("codex", env).map((p) => p.spec), ["codex/work"]);

  assert.throws(() => deleteProfile("codex/work", { env }), /without --yes/);
  deleteProfile("codex/work", { env, yes: true });
  assert.equal(fs.existsSync(created.dir), false);
});

test("shared profiles never copy auth or session files", () => {
  const env = tempEnv();
  env.AGENT_SWITCH_PROFILE_SOURCE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-home-"));
  const codexHome = path.join(env.AGENT_SWITCH_PROFILE_SOURCE_HOME, ".codex");
  fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), "model = \"x\"\n");
  fs.writeFileSync(path.join(codexHome, "auth.json"), "{}\n");
  fs.writeFileSync(path.join(codexHome, "history.jsonl"), "{}\n");

  const created = createProfile("codex/shared", { env, shared: true });

  assert.ok(fs.existsSync(path.join(created.dir, "config.toml")));
  assert.equal(fs.existsSync(path.join(created.dir, "auth.json")), false);
  assert.equal(fs.existsSync(path.join(created.dir, "history.jsonl")), false);
  assert.equal(fs.existsSync(path.join(created.dir, "sessions")), false);
});

test("maps provider commands to profile tools", () => {
  assert.equal(profileToolForProvider({ command: "claude" }), "claude");
  assert.equal(profileToolForProvider({ command: "codex" }), "codex");
  assert.equal(profileToolForProvider({ command: "opencode" }), "opencode");
  assert.equal(profileToolForProvider({ command: "codewhale" }), null);
});

test("resolves run profile and rejects mismatched provider tools", () => {
  const env = tempEnv();
  const created = createProfile("claude/work", { env });
  const resolved = resolveRunProfile({ command: "claude", label: "Claude Code" }, "work", env);

  assert.equal(resolved.spec, "claude/work");
  assert.equal(resolved.dir, created.dir);
  assert.deepEqual(resolved.env, { CLAUDE_CONFIG_DIR: created.dir });
  assert.throws(
    () => resolveRunProfile({ command: "claude", label: "Claude Code" }, "codex/work", env),
    /uses claude profiles/
  );
  assert.throws(
    () => resolveRunProfile({ command: "codewhale", label: "CodeWhale" }, "work", env),
    /profiles are not supported/
  );
});

test("can auto-create a missing Codex run profile when requested", () => {
  const env = tempEnv();
  const resolved = resolveRunProfile(
    { command: "codex", label: "Codex" },
    "work",
    env,
    { createIfMissing: true }
  );

  assert.equal(resolved.spec, "codex/work");
  assert.equal(resolved.dir, profileDir("codex", "work", env));
  assert.ok(fs.existsSync(resolved.dir));
});
