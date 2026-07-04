// Hermes subcommand: chat with a local Docker-hosted Hermes API service.
//
// Hermes is not a spawned CLI -it exposes an OpenAI-compatible HTTP API at
// http://127.0.0.1:8642 by default. We make requests directly via fetch() and
// log them to the same Store that wrap()-spawned CLIs use, so the dashboard
// shows hermes traffic with no changes.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Store } from "./store.js";
import { globalRoot } from "./paths.js";

export const DEFAULT_HERMES_URL = "http://127.0.0.1:8642";

export class HermesAuthError extends Error {
  constructor(message = "hermes returned 401 - auth required") {
    super(message);
    this.name = "HermesAuthError";
    this.code = "HERMES_AUTH";
  }
}

export function hermesAuthPath(env = process.env) {
  const base = env.AGENT_SWITCH_PROFILE_HOME || path.join(os.homedir(), ".agent-switch");
  return path.join(base, "hermes.json");
}

export function loadHermesAuth(env = process.env) {
  try {
    return JSON.parse(fs.readFileSync(hermesAuthPath(env), "utf8"));
  } catch {
    return null;
  }
}

export function saveHermesAuth(config, env = process.env) {
  const file = hermesAuthPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  // POSIX mode is set via writeFile options; on win32 chmod is a no-op for 0o600
  // but try anyway in case the user is on a POSIX-like shell.
  if (process.platform !== "win32") {
    try { fs.chmodSync(file, 0o600); } catch {}
  }
  return file;
}

function resolveBaseUrl(opts, env, saved) {
  return opts.upstream
    || env.HERMES_BASE_URL
    || saved?.baseUrl
    || DEFAULT_HERMES_URL;
}

function resolveAuth(env, saved) {
  return env.AGENT_SWITCH_HERMES_AUTH || saved?.authValue || null;
}

function authHeaders(authValue) {
  const headers = { "Content-Type": "application/json" };
  if (authValue) headers.Authorization = authValue;
  return headers;
}

export async function checkHealth({ baseUrl, authValue, signal } = {}) {
  const headers = authHeaders(authValue);
  let res;
  try {
    res = await fetch(`${baseUrl}/health`, { method: "GET", headers, signal });
  } catch (e) {
    const err = new Error(`Hermes is not running at ${baseUrl} (${e.message})`);
    err.code = "HERMES_UNREACHABLE";
    throw err;
  }
  if (res.status === 401) throw new HermesAuthError("hermes /health returned 401 - auth required");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Hermes /health returned ${res.status}: ${text.slice(0, 200)}`);
  }
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { ok: true, platform: body?.platform || null, body };
}

export async function listModels({ baseUrl, authValue, signal } = {}) {
  const headers = authHeaders(authValue);
  let res;
  try {
    res = await fetch(`${baseUrl}/v1/models`, { method: "GET", headers, signal });
  } catch (e) {
    const err = new Error(`Hermes is not running at ${baseUrl} (${e.message})`);
    err.code = "HERMES_UNREACHABLE";
    throw err;
  }
  if (res.status === 401) throw new HermesAuthError("hermes /v1/models returned 401 - auth required");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Hermes /v1/models returned ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = await res.json().catch(() => ({ data: [] }));
  return Array.isArray(body?.data) ? body.data : [];
}

// POST /v1/chat/completions with stream:true. Captures the request to `store`
// before sending so the dashboard shows a "pending" entry, then updates with
// the full SSE response. Calls onToken(text) for each streamed delta so the
// caller can print tokens live. Throws HermesAuthError on 401 so the caller
// can prompt-and-retry.
export async function streamChat({ baseUrl, authValue, model, messages, store, onToken, signal } = {}) {
  const url = `${baseUrl}/v1/chat/completions`;
  const payload = { model, messages, stream: true };
  const headers = authHeaders(authValue);
  const rec = store.add({
    request: {
      method: "POST",
      url,
      headers,
      body: { ...payload, stream: true },
    },
  });

  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal });
  } catch (e) {
    rec.response = { error: `fetch failed: ${e.message}`, finishedAt: new Date().toISOString() };
    store.update(rec);
    const err = new Error(`Hermes request failed: ${e.message}`);
    err.code = "HERMES_UNREACHABLE";
    throw err;
  }

  if (res.status === 401) {
    rec.response = { status: 401, headers: Object.fromEntries(res.headers.entries()), raw: "", finishedAt: new Date().toISOString() };
    store.update(rec);
    throw new HermesAuthError("hermes /v1/chat/completions returned 401 - auth required");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    rec.response = { status: res.status, headers: Object.fromEntries(res.headers.entries()), raw: text, finishedAt: new Date().toISOString() };
    store.update(rec);
    throw new Error(`Hermes /v1/chat/completions returned ${res.status}: ${text.slice(0, 200)}`);
  }

  // Read the SSE stream, accumulate rawText, call onToken for each delta.content.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawText = "";
  let assembled = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      rawText += chunk;
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        let json;
        try { json = JSON.parse(data); } catch { continue; }
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) {
          assembled += delta;
          if (onToken) onToken(delta);
        }
      }
    }
  } catch (e) {
    rec.response = { status: res.status, headers: Object.fromEntries(res.headers.entries()), raw: rawText, error: `stream interrupted: ${e.message}`, finishedAt: new Date().toISOString() };
    store.update(rec);
    throw e;
  }

  // If we never saw any delta.content, fall back to whatever rawText holds so the
  // dashboard has something to show for non-streaming or empty responses.
  const finalRaw = assembled || rawText;
  rec.response = {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    raw: finalRaw,
    finishedAt: new Date().toISOString(),
  };
  store.update(rec);
  return assembled;
}

// Read a single line from stdin with hidden input (raw mode, echo '*').
// Falls back to plain readline.question on non-TTY (returns whatever was typed).
async function promptForAuth() {
  process.stderr.write("\nagent-switch: hermes returned 401. Authorization is required.\n");
  process.stderr.write("Enter the Bearer token (or full Authorization header value).\n");
  process.stderr.write("Input will be hidden. Press Enter to submit, Ctrl+C to cancel.\n");
  const input = process.stdin;
  if (!input.isTTY) {
    process.stderr.write("(non-interactive stdin - reading one line as-is)\n");
    const rl = readline.createInterface({ input, output: process.stderr });
    return new Promise((resolve) => {
      rl.question("Authorization: ", (answer) => {
        rl.close();
        resolve(answer || null);
      });
    });
  }
  return new Promise((resolve) => {
    process.stderr.write("Authorization: ");
    const wasRaw = Boolean(input.isRaw);
    input.setRawMode(true);
    readline.emitKeypressEvents(input);
    let value = "";
    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode(wasRaw);
    };
    const onKeypress = (str, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.stderr.write("\n");
        process.kill(process.pid, "SIGINT");
        return;
      }
      if (key.name === "return") {
        cleanup();
        process.stderr.write("\n");
        resolve(value || null);
        return;
      }
      if (key.name === "backspace") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stderr.write("\b \b");
        }
        return;
      }
      if (str && !key.ctrl && !key.meta && str >= " ") {
        value += str;
        process.stderr.write("*");
      }
    };
    input.on("keypress", onKeypress);
  });
}

function normalizeAuthValue(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/^Bearer\s+\S+/i.test(trimmed) || /^Basic\s+\S+/i.test(trimmed)) return trimmed;
  // Looks like a bare token -wrap as Bearer.
  return `Bearer ${trimmed}`;
}

async function ensureAuth({ baseUrl, saved, env, promptIfMissing = true, forcePrompt = false }) {
  const envAuth = env.AGENT_SWITCH_HERMES_AUTH;
  if (envAuth && !forcePrompt) return { authValue: normalizeAuthValue(envAuth), saved };
  if (saved?.authValue && !forcePrompt) return { authValue: saved.authValue, saved };
  if (!promptIfMissing) return { authValue: null, saved };
  if (!process.stdin.isTTY) {
    throw new HermesAuthError(
      forcePrompt
        ? "hermes returned 401 with the saved auth. Set AGENT_SWITCH_HERMES_AUTH or run from a TTY to replace it."
        : "hermes returned 401 and no auth is saved. Set AGENT_SWITCH_HERMES_AUTH or run from a TTY."
    );
  }
  const raw = await promptForAuth();
  const authValue = normalizeAuthValue(raw);
  if (!authValue) throw new HermesAuthError("no authorization value provided");
  const next = { baseUrl, authHeader: "Authorization", authValue };
  const file = saveHermesAuth(next, env);
  process.stderr.write(`agent-switch: saved hermes auth to ${file}\n`);
  return { authValue, saved: next };
}

async function pickModel({ baseUrl, authValue, modelFlag }) {
  if (modelFlag) return modelFlag;
  let models = [];
  try {
    models = await listModels({ baseUrl, authValue });
  } catch (e) {
    if (e instanceof HermesAuthError) throw e;
    // Unreachable / other error -warn and let the user pass --model explicitly.
    process.stderr.write(`agent-switch: could not list models from ${baseUrl}/v1/models (${e.message}). Pass --model <name>.\n`);
    return null;
  }
  if (!models.length) {
    process.stderr.write(`agent-switch: hermes returned no models. Pass --model <name>.\n`);
    return null;
  }
  const first = models[0];
  const id = first.id || first.name || JSON.stringify(first);
  process.stderr.write(`agent-switch: using model ${id} (first from /v1/models). Use --model <name> to override.\n`);
  return id;
}

async function runOneShot({ baseUrl, authValue, model, prompt, store }) {
  const messages = [{ role: "user", content: prompt }];
  process.stderr.write(`\nhermes> `);
  try {
    await streamChat({
      baseUrl,
      authValue,
      model,
      messages,
      store,
      onToken: (text) => process.stdout.write(text),
    });
    process.stdout.write("\n");
  } catch (e) {
    if (e instanceof HermesAuthError) throw e;
    process.stderr.write(`\nagent-switch: ${e.message}\n`);
    throw e;
  }
}

async function runRepl({ baseUrl, authValue, model, store }) {
  process.stderr.write(`\nagent-switch hermes REPL - ${baseUrl}\n`);
  process.stderr.write(`  model: ${model}\n`);
  process.stderr.write(`  commands: /model <name>  /models  /health  /clear  /exit\n\n`);

  const messages = [];
  let currentModel = model;
  const input = process.stdin;
  const output = process.stderr;
  const rl = readline.createInterface({ input, output, prompt: "hermes> " });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); continue; }
    if (trimmed === "/exit" || trimmed === "/quit") { rl.close(); return; }
    if (trimmed === "/clear") {
      messages.length = 0;
      process.stderr.write("(conversation cleared)\n");
      rl.prompt();
      continue;
    }
    if (trimmed === "/health") {
      try {
        const h = await checkHealth({ baseUrl, authValue });
        process.stderr.write(JSON.stringify({ ok: h.ok, platform: h.platform }) + "\n");
      } catch (e) {
        process.stderr.write(`health: ${e.message}\n`);
      }
      rl.prompt();
      continue;
    }
    if (trimmed === "/models") {
      try {
        const models = await listModels({ baseUrl, authValue });
        for (const m of models) process.stderr.write(`  ${m.id || m.name || JSON.stringify(m)}\n`);
      } catch (e) {
        process.stderr.write(`models: ${e.message}\n`);
      }
      rl.prompt();
      continue;
    }
    if (trimmed.startsWith("/model ")) {
      const next = trimmed.slice("/model ".length).trim();
      if (next) {
        currentModel = next;
        process.stderr.write(`(model set to ${currentModel})\n`);
      }
      rl.prompt();
      continue;
    }
    if (trimmed.startsWith("/")) {
      process.stderr.write(`unknown command: ${trimmed}\n`);
      rl.prompt();
      continue;
    }

    messages.push({ role: "user", content: trimmed });
    try {
      let assistantText = "";
      await streamChat({
        baseUrl,
        authValue,
        model: currentModel,
        messages,
        store,
        onToken: (text) => {
          assistantText += text;
          process.stdout.write(text);
        },
      });
      process.stdout.write("\n\n");
      if (assistantText) messages.push({ role: "assistant", content: assistantText });
    } catch (e) {
      if (e instanceof HermesAuthError) throw e;
      process.stderr.write(`\nagent-switch: ${e.message}\n`);
    }
    rl.prompt();
  }
}

export async function hermesCmd(args, opts = {}) {
  const env = process.env;
  const saved = loadHermesAuth(env);
  const baseUrl = resolveBaseUrl(opts, env, saved);

  // --health: quick liveness check, no auth needed unless hermes requires it
  // even on /health (some setups do).
  if (opts.health) {
    let authValue = resolveAuth(env, saved);
    try {
      const h = await checkHealth({ baseUrl, authValue });
      process.stdout.write(`hermes /health: ok${h.platform ? ` (platform=${h.platform})` : ""}\n`);
      return 0;
    } catch (e) {
      if (e instanceof HermesAuthError && !authValue && process.stdin.isTTY) {
        const prompted = await ensureAuth({ baseUrl, saved, env, promptIfMissing: true, forcePrompt: Boolean(saved?.authValue) });
        authValue = prompted.authValue;
        try {
          const h = await checkHealth({ baseUrl, authValue });
          process.stdout.write(`hermes /health: ok${h.platform ? ` (platform=${h.platform})` : ""}\n`);
          return 0;
        } catch (e2) {
          process.stderr.write(`agent-switch: ${e2.message}\n`);
          return 1;
        }
      }
      process.stderr.write(`agent-switch: ${e.message}\n`);
      return 1;
    }
  }

  // Resolve auth up front (env var wins; otherwise use saved; otherwise defer
  // until first 401 -but if /v1/models needs it, we'll prompt there).
  let authValue = resolveAuth(env, saved);
  let currentSaved = saved;

  // --list-models: print and exit.
  if (opts.listModels) {
    try {
      const models = await listModels({ baseUrl, authValue });
      if (!models.length) {
        process.stdout.write(`(no models returned from ${baseUrl}/v1/models)\n`);
      } else {
        for (const m of models) process.stdout.write(`${m.id || m.name || JSON.stringify(m)}\n`);
      }
      return 0;
    } catch (e) {
      if (e instanceof HermesAuthError) {
        const prompted = await ensureAuth({
          baseUrl,
          saved: currentSaved,
          env,
          promptIfMissing: process.stdin.isTTY,
          forcePrompt: Boolean(currentSaved?.authValue),
        });
        authValue = prompted.authValue;
        currentSaved = prompted.saved;
        try {
          const models = await listModels({ baseUrl, authValue });
          for (const m of models) process.stdout.write(`${m.id || m.name || JSON.stringify(m)}\n`);
          return 0;
        } catch (e2) {
          process.stderr.write(`agent-switch: ${e2.message}\n`);
          return 1;
        }
      }
      process.stderr.write(`agent-switch: ${e.message}\n`);
      return 1;
    }
  }

  // Pick a model.
  let model;
  try {
    model = await pickModel({ baseUrl, authValue, modelFlag: opts.model });
  } catch (e) {
    if (e instanceof HermesAuthError) {
      const prompted = await ensureAuth({
        baseUrl,
        saved: currentSaved,
        env,
        promptIfMissing: process.stdin.isTTY,
        forcePrompt: Boolean(currentSaved?.authValue),
      });
      authValue = prompted.authValue;
      currentSaved = prompted.saved;
      try {
        model = await pickModel({ baseUrl, authValue, modelFlag: opts.model });
      } catch (e2) {
        process.stderr.write(`agent-switch: ${e2.message}\n`);
        return 1;
      }
    } else {
      process.stderr.write(`agent-switch: ${e.message}\n`);
      return 1;
    }
  }
  if (!model) {
    process.stderr.write(`agent-switch: no model available. Pass --model <name>.\n`);
    return 1;
  }

  // Set up the Store so every chat request is captured to the dashboard.
  const cwd = process.cwd();
  const root = opts.dir || globalRoot(cwd);
  const store = new Store({ root, redact: opts.redact !== false, format: "openai" });

  // Determine mode: one-shot if there's a positional arg, else REPL.
  const positional = args.find((a) => !a.startsWith("-"));
  if (positional) {
    try {
      await runOneShot({ baseUrl, authValue, model, prompt: positional, store });
      return 0;
    } catch (e) {
      if (e instanceof HermesAuthError) {
        // 401 during the actual chat: prompt and retry once.
        if (!process.stdin.isTTY && !env.AGENT_SWITCH_HERMES_AUTH) {
          process.stderr.write(`agent-switch: ${e.message}. Set AGENT_SWITCH_HERMES_AUTH or run from a TTY.\n`);
          return 1;
        }
        const prompted = await ensureAuth({
          baseUrl,
          saved: currentSaved,
          env,
          promptIfMissing: process.stdin.isTTY,
          forcePrompt: Boolean(currentSaved?.authValue),
        });
        authValue = prompted.authValue;
        currentSaved = prompted.saved;
        try {
          await runOneShot({ baseUrl, authValue, model, prompt: positional, store });
          return 0;
        } catch (e2) {
          process.stderr.write(`agent-switch: ${e2.message}\n`);
          return 1;
        }
      }
      process.stderr.write(`agent-switch: ${e.message}\n`);
      return 1;
    }
  }

  // REPL.
  try {
    await runRepl({ baseUrl, authValue, model, store });
    return 0;
  } catch (e) {
    if (e instanceof HermesAuthError) {
      if (!process.stdin.isTTY && !env.AGENT_SWITCH_HERMES_AUTH) {
        process.stderr.write(`agent-switch: ${e.message}. Set AGENT_SWITCH_HERMES_AUTH or run from a TTY.\n`);
        return 1;
      }
      const prompted = await ensureAuth({
        baseUrl,
        saved: currentSaved,
        env,
        promptIfMissing: process.stdin.isTTY,
        forcePrompt: Boolean(currentSaved?.authValue),
      });
      authValue = prompted.authValue;
      currentSaved = prompted.saved;
      try {
        await runRepl({ baseUrl, authValue, model, store });
        return 0;
      } catch (e2) {
        process.stderr.write(`agent-switch: ${e2.message}\n`);
        return 1;
      }
    }
    process.stderr.write(`agent-switch: ${e.message}\n`);
    return 1;
  }
}
