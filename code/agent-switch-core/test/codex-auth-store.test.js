import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  codexAuthStoreRoot,
  describeCodexAuth,
  injectCodexAuthAccount,
  listCodexAuthAccounts,
  removeCodexAuthAccount,
  saveCodexAuthAccount,
  saveCodexAuthAccountFromDir,
} from "../src/codex-auth-store.js";

function tempEnv() {
  return { AGENT_SWITCH_PROFILE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-codex-auth-")) };
}

function fakeJwt(payload) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

function fakeAuth(email = "work@example.com") {
  return {
    auth_mode: "chatgpt",
    tokens: {
      id_token: fakeJwt({ email, sub: `sub-${email}` }),
      access_token: `access-${email}`,
      refresh_token: `refresh-${email}`,
    },
  };
}

test("describes Codex auth from id_token payload", () => {
  const info = describeCodexAuth(fakeAuth("a@example.com"));

  assert.equal(info.email, "a@example.com");
  assert.equal(info.label, "a@example.com");
  assert.equal(info.authMode, "chatgpt");
  assert.match(info.stableId, /^[a-f0-9]{16}$/);
});

test("saves, lists, injects, and removes Codex auth accounts", () => {
  const env = tempEnv();
  const { account } = saveCodexAuthAccount(fakeAuth(), { env });

  assert.match(account.id, /^[a-f0-9]{16}$/);
  assert.equal(account.email, "work@example.com");
  assert.equal(listCodexAuthAccounts(env).length, 1);
  assert.ok(fs.existsSync(codexAuthStoreRoot(env)));

  const profileDir = path.join(env.AGENT_SWITCH_PROFILE_HOME, "codex", "work");
  const injected = injectCodexAuthAccount(profileDir, account.id, env);

  assert.equal(injected.id, account.id);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profileDir, "auth.json"), "utf8")), account.authJson);
  assert.ok(fs.existsSync(path.join(profileDir, ".agent-switch-codex-auth.json")));
  assert.equal(listCodexAuthAccounts(env)[0].lastUsedAt != null, true);

  const removed = removeCodexAuthAccount(account.id, env);
  assert.equal(removed.id, account.id);
  assert.deepEqual(listCodexAuthAccounts(env), []);
});

test("imports Codex auth from a login directory", () => {
  const env = tempEnv();
  const loginDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-codex-login-"));
  fs.writeFileSync(path.join(loginDir, "auth.json"), JSON.stringify(fakeAuth("login@example.com")));

  const { account } = saveCodexAuthAccountFromDir(loginDir, { env });

  assert.equal(account.email, "login@example.com");
  assert.equal(listCodexAuthAccounts(env)[0].id, account.id);
});
