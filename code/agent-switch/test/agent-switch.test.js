import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { internals } from "../src/agent-switch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(__dirname, "..", "bin", "agent-switch.js");

function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [bin, ...args], { timeout: 15000 }, (err, stdout, stderr) => {
      resolve({ code: err?.code ?? 0, stdout, stderr });
    });
  });
}

test("detects explicit capture directory", () => {
  const cwd = process.cwd();
  assert.equal(internals.captureDirFromArgs(["claude", "--dir", "logs"], cwd), path.resolve("logs"));
});

test("prints handoff for provider runs only", () => {
  assert.equal(internals.shouldPrintHandoff(["claude"]), true);
  assert.equal(internals.shouldPrintHandoff(["run", "--provider", "openai", "--", "tool"]), true);
  assert.equal(internals.shouldPrintHandoff(["dashboard"]), false);
  assert.equal(internals.shouldPrintHandoff(["webui"]), false);
  assert.equal(internals.shouldPrintHandoff(["view"]), false);
  assert.equal(internals.shouldPrintHandoff(["export", "session/0001"]), false);
  assert.equal(internals.shouldPrintHandoff(["profile", "list"]), false);
  assert.equal(internals.shouldPrintHandoff(["compact", "doctor"]), false);
  assert.equal(internals.shouldPrintHandoff(["hermes", "--health"]), false);
});

test("renders an empty handoff without logs", () => {
  const text = internals.renderHandoff({
    cwd: process.cwd(),
    captureRoot: path.join(process.cwd(), ".missing-agent-switch-test"),
    before: null,
    code: 0,
  });
  assert.match(text, /returned to Codex/);
  assert.match(text, /captured requests: 0/);
  assert.match(text, /agent-switch dashboard/);
});

test("handoff model uses the latest request that includes a model", () => {
  const records = [
    { request: { body: { model: "gpt-test", input: [] } } },
    { request: { body: {} } },
  ];
  assert.equal(internals.latestCapturedModel(records), "gpt-test");
  assert.equal(internals.latestCapturedModel([{ request: { body: {} } }]), null);
});

test("handoff does not report a previous session as captures from a failed run", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-stale-handoff-"));
  const session = "2020-01-01T00-00-00-000Z";
  const dir = path.join(root, session);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "0001.json"), JSON.stringify({
    v: 2,
    id: `${session}/0001`,
    session,
    seq: 1,
    ts: 1,
    format: "openai",
    request: { headers: {}, meta: { model: "old-model" }, historyKey: "input", system: null, tools: null, messages: [] },
    response: { status: 200 },
  }));
  try {
    const text = internals.renderHandoff({ cwd: process.cwd(), captureRoot: root, before: session, code: 1 });
    assert.match(text, /captured requests: 0/);
    assert.doesNotMatch(text, /old-model|latest existing session/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("handoff uses the session reported by its own core process", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-concurrent-handoff-"));
  const ownSession = "2020-01-01T00-00-00-000Z";
  const concurrentSession = "2020-01-01T00-00-01-000Z";
  const writeRecord = (session, model) => {
    const dir = path.join(root, session);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "0001.json"), JSON.stringify({
      v: 2,
      id: `${session}/0001`,
      session,
      seq: 1,
      ts: 1,
      format: "openai",
      request: { headers: {}, meta: { model }, historyKey: "input", system: null, tools: null, messages: [] },
      response: { status: 200 },
    }));
  };
  writeRecord(ownSession, "own-model");
  writeRecord(concurrentSession, "concurrent-model");
  try {
    const text = internals.renderHandoff({
      cwd: process.cwd(), captureRoot: root, before: null, code: 0, session: ownSession,
    });
    assert.match(text, new RegExp(ownSession));
    assert.match(text, /own-model/);
    assert.doesNotMatch(text, /concurrent-model/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reads an explicit handoff session file", () => {
  const file = path.join(os.tmpdir(), `agent-switch-handoff-test-${process.pid}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify({ session: "2020-01-01T00-00-00-000Z" }));
    assert.equal(internals.readHandoffSession(file), "2020-01-01T00-00-00-000Z");
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test("outer CLI delegates help and no-argument behavior to the core CLI", async () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"));
  const help = await run(["--help"]);
  const noArgs = await run([]);

  assert.equal(help.code, 0);
  assert.match(help.stdout, new RegExp(`agent-switch v${rootPackage.version.replaceAll(".", "\\.")}`));
  assert.match(help.stdout, /agent-switch opencode/);
  assert.match(noArgs.stdout, new RegExp(`agent-switch v${rootPackage.version.replaceAll(".", "\\.")}`));
});

test("outer CLI forwards target --help instead of replacing it with agent-switch help", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-outer-probe-"));
  const probe = path.join(dir, "probe.mjs");
  fs.writeFileSync(probe, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
  try {
    const result = await run(["run", "--provider", "openai", "--", process.execPath, probe, "--help"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /\["--help"\]/);
    assert.doesNotMatch(result.stdout, /USAGE/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
