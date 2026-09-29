import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { preparePi } from "../src/pi.js";
import registerCaptureProxy from "../src/pi-proxy-extension.js";

test("Pi defaults to Anthropic and pins the model provider", () => {
  const selected = preparePi(["-p", "hello"], null, { PI_CODING_AGENT_DIR: "missing" });
  assert.equal(selected.provider, "anthropic");
  assert.equal(selected.format, "anthropic");
  assert.equal(selected.upstream, "https://api.anthropic.com");
  assert.deepEqual(selected.args, ["--provider", "anthropic", "-p", "hello"]);
});

test("Pi OpenAI selection uses the Responses-compatible upstream", () => {
  const selected = preparePi(["--model", "openai/gpt-4o", "-p", "hello"]);
  assert.equal(selected.provider, "openai");
  assert.equal(selected.format, "openai");
  assert.equal(selected.upstream, "https://api.openai.com/v1");
  assert.deepEqual(selected.args, ["--model", "openai/gpt-4o", "-p", "hello"]);
});

test("Pi honors an existing configured upstream without modifying models.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-pi-"));
  const config = path.join(dir, "models.json");
  const original = JSON.stringify({ providers: { anthropic: { baseUrl: "https://gateway.example/anthropic" } } });
  try {
    fs.writeFileSync(config, original);
    const selected = preparePi([], "anthropic", { PI_CODING_AGENT_DIR: dir });
    assert.equal(selected.upstream, "https://gateway.example/anthropic");
    assert.equal(fs.readFileSync(config, "utf8"), original);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Pi rejects unsupported or conflicting capture providers", () => {
  assert.throws(() => preparePi([], "google"), /unsupported Pi provider/);
  assert.throws(() => preparePi(["--provider", "openai"], "anthropic"), /conflicting Pi providers/);
  assert.throws(() => preparePi(["--model", "openai\/gpt-4o"], "anthropic"), /conflicting Pi providers/);
});

test("Pi extension overrides only the selected provider for this process", () => {
  const before = {
    provider: process.env.AGENT_SWITCH_PI_PROVIDER,
    url: process.env.AGENT_SWITCH_PI_PROXY_URL,
  };
  try {
    process.env.AGENT_SWITCH_PI_PROVIDER = "openai";
    process.env.AGENT_SWITCH_PI_PROXY_URL = "http://127.0.0.1:12345";
    const registrations = [];
    registerCaptureProxy({ registerProvider: (...args) => registrations.push(args) });
    assert.deepEqual(registrations, [["openai", { baseUrl: "http://127.0.0.1:12345" }]]);
  } finally {
    if (before.provider === undefined) delete process.env.AGENT_SWITCH_PI_PROVIDER;
    else process.env.AGENT_SWITCH_PI_PROVIDER = before.provider;
    if (before.url === undefined) delete process.env.AGENT_SWITCH_PI_PROXY_URL;
    else process.env.AGENT_SWITCH_PI_PROXY_URL = before.url;
  }
});
