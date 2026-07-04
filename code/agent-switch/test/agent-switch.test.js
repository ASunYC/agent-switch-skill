import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { internals } from "../src/agent-switch.js";

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
