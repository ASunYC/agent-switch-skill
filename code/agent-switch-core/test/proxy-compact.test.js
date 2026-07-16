import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createProxy } from "../src/proxy.js";
import { Store, loadSession } from "../src/store.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function withServers({ compact }, fn) {
  const upstreamHits = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      upstreamHits.push({ raw, headers: req.headers, body: JSON.parse(raw) });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end('data: {"type":"message_stop"}\n\n');
    });
  });
  const upstreamPort = await listen(upstream);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-proxy-"));
  const store = new Store({ root, format: "anthropic" });
  const proxy = createProxy({ upstream: `http://127.0.0.1:${upstreamPort}`, store, compact });
  const proxyPort = await listen(proxy);
  try {
    await fn({ proxyPort, upstreamHits, store, root });
  } finally {
    proxy.close();
    upstream.close();
  }
}

async function postJson(port, raw) {
  return fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(raw)),
    },
    body: raw,
  });
}

const originalBody = {
  model: "claude-test",
  messages: [
    { role: "assistant", content: [{ type: "tool_result", content: "x".repeat(1600) }] },
    { role: "user", content: [{ type: "text", text: "continue" }] },
  ],
  tools: [],
};

test("proxy keeps request bytes unchanged when compact is disabled", async () => {
  await withServers({}, async ({ proxyPort, upstreamHits, store }) => {
    const raw = JSON.stringify(originalBody);
    const res = await postJson(proxyPort, raw);
    assert.equal(res.status, 200);
    assert.equal(upstreamHits[0].raw, raw);
    assert.equal(store.entries[0].compression, undefined);
    assert.equal(store.entries[0].forwarded, undefined);
  });
});

test("proxy forwards compacted body and keeps the original capture", async () => {
  const compressFn = async (messages) => ({
    messages: [{ ...messages[0], content: [{ type: "tool_result", content: "compressed" }] }],
    compressed: true,
    tokensBefore: 1000,
    tokensAfter: 250,
    tokensSaved: 750,
    compressionRatio: 0.25,
    transformsApplied: ["test"],
  });

  await withServers({
    compact: { enabled: true, engine: "headroom", baseUrl: "http://127.0.0.1:8787", fail: "open", compressFn },
  }, async ({ proxyPort, upstreamHits, store, root }) => {
    const raw = JSON.stringify(originalBody);
    const res = await postJson(proxyPort, raw);
    assert.equal(res.status, 200);
    assert.equal(upstreamHits[0].body.messages[0].content[0].content, "compressed");
    assert.equal(Number(upstreamHits[0].headers["content-length"]), Buffer.byteLength(upstreamHits[0].raw));
    assert.equal(store.entries[0].request.body.messages[0].content[0].content, "x".repeat(1600));
    assert.equal(store.entries[0].forwarded.body.messages[0].content[0].content, "compressed");
    assert.equal(store.entries[0].compression.tokensSaved, 750);
    const loaded = loadSession(root, store.sessionId)[0];
    assert.equal(loaded.forwarded.body.messages[0].content[0].content, "compressed");
    assert.equal(loaded.request.body.messages[0].content[0].content, "x".repeat(1600));
  });
});

test("proxy fails open to the original request when Headroom throws", async () => {
  const compressFn = async () => { throw new Error("headroom offline"); };

  await withServers({
    compact: { enabled: true, engine: "headroom", baseUrl: "http://127.0.0.1:8787", fail: "open", compressFn },
  }, async ({ proxyPort, upstreamHits, store }) => {
    const raw = JSON.stringify(originalBody);
    const res = await postJson(proxyPort, raw);
    assert.equal(res.status, 200);
    assert.equal(upstreamHits[0].raw, raw);
    assert.equal(store.entries[0].compression.failedOpen, true);
    assert.match(store.entries[0].compression.error, /headroom offline/);
  });
});

test("proxy fails closed before contacting upstream when requested", async () => {
  const compressFn = async () => { throw new Error("headroom offline"); };

  await withServers({
    compact: { enabled: true, engine: "headroom", baseUrl: "http://127.0.0.1:8787", fail: "closed", compressFn },
  }, async ({ proxyPort, upstreamHits, store }) => {
    const res = await postJson(proxyPort, JSON.stringify(originalBody));
    assert.equal(res.status, 502);
    assert.match(await res.text(), /compact failed: headroom offline/);
    assert.equal(upstreamHits.length, 0);
    assert.match(store.entries[0].compression.error, /headroom offline/);
  });
});

test("proxy records a client disconnect instead of leaving a pending request", async () => {
  const upstream = http.createServer((_req, _res) => {});
  const upstreamPort = await listen(upstream);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-proxy-abort-"));
  const store = new Store({ root, format: "anthropic" });
  const proxy = createProxy({ upstream: `http://127.0.0.1:${upstreamPort}`, store });
  const proxyPort = await listen(proxy);
  try {
    await new Promise((resolve) => {
      const req = http.request({
        host: "127.0.0.1",
        port: proxyPort,
        path: "/v1/messages",
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      req.on("error", () => resolve());
      req.end(JSON.stringify({ model: "claude-test", messages: [] }));
      setTimeout(() => req.destroy(), 25);
      setTimeout(resolve, 100);
    });
    assert.equal(store.entries.length, 1);
    assert.match(store.entries[0].response?.error || "", /disconnected|closed|aborted/);
  } finally {
    proxy.closeAllConnections?.();
    proxy.close();
    upstream.closeAllConnections?.();
    upstream.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
