import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(__dirname, "..", "bin", "agent-switch-core.js");

function run(args, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [bin, ...args], {
      env: { ...process.env, AGENT_SWITCH_IGNORE_CLAUDE_SETTINGS: "1", ...env },
      timeout: 15000,
    }, (err, stdout, stderr) => {
      resolve({ code: err?.code ?? 0, stdout, stderr });
    });
  });
}

function fakeJwt(payload) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

function writeCodexAuthStore(home, id = "abcdef1234567890") {
  const store = path.join(home, "codex", ".accounts");
  const accountsDir = path.join(store, "accounts");
  fs.mkdirSync(accountsDir, { recursive: true });
  const now = "2026-01-01T00:00:00.000Z";
  const record = {
    id,
    label: "work@example.com",
    email: "work@example.com",
    authMode: "chatgpt",
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    authJson: {
      auth_mode: "chatgpt",
      tokens: {
        id_token: fakeJwt({ email: "work@example.com", sub: "sub-work" }),
        access_token: "access",
        refresh_token: "refresh",
      },
    },
  };
  fs.writeFileSync(path.join(accountsDir, `${id}.json`), JSON.stringify(record, null, 2));
  fs.writeFileSync(path.join(store, "index.json"), JSON.stringify({
    version: 1,
    currentAccountId: null,
    accounts: [{
      id,
      label: record.label,
      email: record.email,
      authMode: record.authMode,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    }],
  }, null, 2));
  return record;
}

test("opencode exits with code 1 and a clear error when OPENAI_BASE_URL is unset", async () => {
  const env = { ...process.env };
  delete env.OPENAI_BASE_URL;

  const { code, stderr } = await run(["opencode"], env);

  assert.equal(code, 1);
  assert.match(stderr, /OpenCode/);
  assert.match(stderr, /OPENAI_BASE_URL/);
  assert.match(stderr, /--upstream/);
});

test("opencode exits with code 1 and a clear error when OPENAI_BASE_URL is empty", async () => {
  const { code, stderr } = await run(["opencode"], { OPENAI_BASE_URL: "" });

  assert.equal(code, 1);
  assert.match(stderr, /OpenCode/);
  assert.match(stderr, /OPENAI_BASE_URL/);
});

test("codex-azure exits with code 1 and a clear error when AZURE_OPENAI_ENDPOINT is unset", async () => {
  const { code, stderr } = await run(["codex-azure"], { AZURE_OPENAI_ENDPOINT: "" });

  assert.equal(code, 1);
  assert.match(stderr, /Codex \(Azure OpenAI\)/);
  assert.match(stderr, /AZURE_OPENAI_ENDPOINT/);
  assert.match(stderr, /--upstream/);
});

test("bedrock keys off ANTHROPIC_BEDROCK_BASE_URL, not ANTHROPIC_BASE_URL", async () => {
  // Regression test for the silent-bypass bug: in Bedrock mode, Claude Code
  // reads ANTHROPIC_BEDROCK_BASE_URL. If agent-switch injects ANTHROPIC_BASE_URL,
  // the child silently ignores it and the proxy captures nothing. Setting only
  // ANTHROPIC_BASE_URL must NOT be enough to satisfy the bedrock provider, and
  // the missing-var error must name the correct key so users can fix it.
  // Note: run() does `{ ...process.env, ...env }`, so `delete env.X` won't
  // remove X when the caller's environment has it set. Use an empty-string
  // override to actually clear it for the child.
  const env = {
    ANTHROPIC_BEDROCK_BASE_URL: "",
    ANTHROPIC_BASE_URL: "https://api.anthropic.com",
  };

  const { code, stderr } = await run(["bedrock"], env);

  assert.equal(code, 1);
  assert.match(stderr, /AWS Bedrock/);
  assert.match(stderr, /ANTHROPIC_BEDROCK_BASE_URL/);
  assert.doesNotMatch(stderr, /Set ANTHROPIC_BASE_URL/);
});

test("claude uses ANTHROPIC_BASE_URL env var as upstream (invalid URL triggers clear error)", async () => {
  const { code, stderr } = await run(["claude"], { ANTHROPIC_BASE_URL: "not-a-valid-url" });

  assert.equal(code, 1);
  assert.match(stderr, /invalid upstream URL/);
  assert.match(stderr, /ANTHROPIC_BASE_URL/);
});

test("claude fails fast when a local upstream is not listening", async () => {
  const { code, stderr } = await run(["claude", "--no-mcp"], { ANTHROPIC_BASE_URL: "http://127.0.0.1:9" });

  assert.equal(code, 1);
  assert.match(stderr, /local upstream is not reachable/);
  assert.match(stderr, /127\.0\.0\.1:9/);
  assert.match(stderr, /CC Switch/);
  assert.doesNotMatch(stderr, /command not found: claude/);
});

test("missing Claude Code prints official install guidance", async () => {
  const { code, stderr } = await run(["claude", "--no-mcp"], {
    PATH: "",
    Path: "",
    ANTHROPIC_BASE_URL: "https://api.anthropic.com",
  });

  assert.equal(code, 1);
  assert.match(stderr, /command not found: claude/);
  assert.match(stderr, /winget install Anthropic\.ClaudeCode/);
  assert.match(stderr, /https:\/\/claude\.ai\/install\.ps1/);
  assert.match(stderr, /https:\/\/claude\.ai\/install\.sh/);
  assert.match(stderr, /agent-switch claude/);
});

test("missing CodeWhale prints renamed CLI install guidance", async () => {
  const { code, stderr } = await run(["codewhale"], { PATH: "", Path: "" });

  assert.equal(code, 1);
  assert.match(stderr, /command not found: codewhale/);
  assert.match(stderr, /renamed DeepSeek-TUI CLI/);
  assert.match(stderr, /npm install -g codewhale/);
  assert.match(stderr, /codewhale doctor/);
  assert.match(stderr, /agent-switch codewhale/);
});

test("--version flag prints version and exits 0", async () => {
  const { code, stdout } = await run(["--version"]);

  assert.equal(code, 0);
  assert.match(stdout, /^\d+\.\d+\.\d+/);
});

test("--help lists compact commands and flags", async () => {
  const { code, stdout } = await run(["--help"]);

  assert.equal(code, 0);
  assert.match(stdout, /agent-switch compact doctor/);
  assert.match(stdout, /agent-switch profile new/);
  assert.match(stdout, /--profile/);
  assert.match(stdout, /--compact/);
  assert.match(stdout, /--compact-base-url/);
});

test("profile commands create, list, path, and delete profiles", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-profilecli-"));
  const env = { AGENT_SWITCH_PROFILE_HOME: home };

  const created = await run(["profile", "new", "codex/work"], env);
  assert.equal(created.code, 0);
  assert.match(created.stdout, /created profile codex\/work/);

  const listed = await run(["profile", "list", "codex"], env);
  assert.equal(listed.code, 0);
  assert.match(listed.stdout, /codex\/work/);

  const pathResult = await run(["profile", "path", "codex/work"], env);
  assert.equal(pathResult.code, 0);
  assert.equal(pathResult.stdout.trim(), path.join(home, "codex", "work"));

  const refused = await run(["profile", "delete", "codex/work"], env);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /without --yes/);

  const deleted = await run(["profile", "delete", "codex/work", "--yes"], env);
  assert.equal(deleted.code, 0);
  assert.match(deleted.stdout, /deleted profile codex\/work/);
  assert.equal(fs.existsSync(path.join(home, "codex", "work")), false);
});

test("codex --profile chooses saved auth and reads config.toml from CODEX_HOME profile", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-profile-run-"));
  writeCodexAuthStore(home);
  const profile = path.join(home, "codex", "work");
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, "config.toml"), [
    "[model_providers.openai]",
    "base_url = \"https://profile.example/v1\"",
    "",
  ].join("\n"));

  const { code, stderr } = await run(["codex", "--profile", "work"], {
    AGENT_SWITCH_PROFILE_HOME: home,
    AGENT_SWITCH_CODEX_AUTH_CHOICE: "first",
    OPENAI_BASE_URL: "https://env.example/v1",
    PATH: "",
    Path: "",
  });

  assert.equal(code, 1);
  assert.match(stderr, /agent-switch codex auth work@example\.com chatgpt -> codex\/work/);
  assert.ok(fs.existsSync(path.join(profile, "auth.json")));
  assert.match(stderr, /agent-switch profile codex\/work/);
  assert.match(stderr, /upstream from Codex config\.toml ->https:\/\/profile\.example\/v1/);
  assert.match(stderr, /config\.toml sets model_providers\.openai\.base_url=https:\/\/profile\.example\/v1/);
  assert.match(stderr, /command not found: codex/);
});

test("codex --profile defaults to resume --last when profile sessions exist and no args were supplied", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-profile-resume-"));
  writeCodexAuthStore(home);
  const profile = path.join(home, "codex", "work");
  const sessionDir = path.join(profile, "sessions", "2026", "06", "10");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "rollout-2026-06-10T00-00-00-test.jsonl"), "{}\n");

  const { code, stderr } = await run(["codex", "--profile", "work"], {
    AGENT_SWITCH_PROFILE_HOME: home,
    AGENT_SWITCH_CODEX_AUTH_CHOICE: "first",
    OPENAI_BASE_URL: "https://api.openai.com",
    PATH: "",
    Path: "",
  });

  assert.equal(code, 1);
  assert.match(stderr, /resuming latest codex\/work session with `resume --last`/);
  assert.match(stderr, /command not found: codex/);
});

test("codex --profile does not auto-resume when Codex args were supplied", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-profile-noresume-"));
  writeCodexAuthStore(home);
  const profile = path.join(home, "codex", "work");
  const sessionDir = path.join(profile, "sessions", "2026", "06", "10");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "rollout-2026-06-10T00-00-00-test.jsonl"), "{}\n");

  const { code, stderr } = await run(["codex", "--profile", "work", "resume"], {
    AGENT_SWITCH_PROFILE_HOME: home,
    AGENT_SWITCH_CODEX_AUTH_CHOICE: "first",
    OPENAI_BASE_URL: "https://api.openai.com",
    PATH: "",
    Path: "",
  });

  assert.equal(code, 1);
  assert.doesNotMatch(stderr, /resuming latest/);
  assert.match(stderr, /command not found: codex/);
});

test("codex --profile requires an interactive auth choice when no scripted choice is provided", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-profile-authchoice-"));
  const { code, stderr } = await run(["codex", "--profile", "work"], {
    AGENT_SWITCH_PROFILE_HOME: home,
    OPENAI_BASE_URL: "https://api.openai.com",
    PATH: "",
    Path: "",
  });

  assert.equal(code, 1);
  assert.match(stderr, /codex --profile needs an interactive terminal/);
  assert.doesNotMatch(stderr, /command not found: codex/);
});

test("plain codex does not open the profile auth menu", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-plain-codex-"));
  writeCodexAuthStore(home);
  const { code, stderr } = await run(["codex"], {
    AGENT_SWITCH_PROFILE_HOME: home,
    OPENAI_BASE_URL: "https://api.openai.com",
    PATH: "",
    Path: "",
  });

  assert.equal(code, 1);
  assert.doesNotMatch(stderr, /select auth>/);
  assert.doesNotMatch(stderr, /agent-switch codex profile/);
  assert.match(stderr, /command not found: codex/);
});

test("--profile rejects unsupported wrapped CLIs", async () => {
  const { code, stderr } = await run(["codewhale", "--profile", "work"]);

  assert.equal(code, 1);
  assert.match(stderr, /profiles are not supported for CodeWhale/);
});

test("compact install prints external Headroom instructions", async () => {
  const { code, stdout } = await run(["compact", "install"]);

  assert.equal(code, 0);
  assert.match(stdout, /pip install "headroom-ai\[proxy\]"/);
  assert.match(stdout, /headroom proxy/);
  assert.match(stdout, /RTK is intentionally not initialized/);
});

test("--compact is limited to Claude Code based providers in v1", async () => {
  const { code, stderr } = await run(["codex", "--compact"], { OPENAI_BASE_URL: "https://api.openai.com" });

  assert.equal(code, 1);
  assert.match(stderr, /--compact is only supported/);
  assert.match(stderr, /claude, kimi, bedrock, vertex/);
});

test("agent-switch rm deletes a session directory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-rmcli-"));
  const session = "2020-01-01T00-00-00-000Z";
  const dir = path.join(root, session);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "0001.json"), JSON.stringify({
    v: 2, id: `${session}/0001`, session, seq: 1, ts: 1, format: "anthropic",
    request: { headers: {}, meta: { model: "m" }, historyKey: "messages",
               system: null, tools: null, messages: [] },
    response: null,
  }));

  const { code } = await run(["rm", session, "--dir", root]);
  assert.equal(code, 0);
  assert.ok(!fs.existsSync(dir));
});

test("agent-switch repack migrates a legacy v1 capture to v2", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-repackcli-"));
  const session = "2020-03-03T00-00-00-000Z";
  const dir = path.join(root, session);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "0001.json");
  fs.writeFileSync(file, JSON.stringify({
    id: `${session}/0001`, session, seq: 1, ts: 1, format: "anthropic",
    request: { headers: {}, body: { model: "m", messages: [{ role: "user", content: "hi" }], tools: [] } },
    response: { status: 200 },
  }));
  const { code } = await run(["repack", "--dir", root]);
  assert.equal(code, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).v, 2);
});

