const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_TIMEOUT_MS = 15000;

export const DEFAULT_COMPACT = {
  enabled: false,
  engine: "headroom",
  baseUrl: DEFAULT_BASE_URL,
  fail: "open",
};

export function normalizeCompactOptions(opts = {}) {
  return {
    enabled: Boolean(opts.enabled),
    engine: opts.engine || "headroom",
    baseUrl: opts.baseUrl || DEFAULT_BASE_URL,
    fail: opts.fail || "open",
    timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
    compressFn: opts.compressFn || null,
  };
}

export function isClaudeCompactProvider(provider) {
  return provider?.format === "anthropic" && provider?.command === "claude";
}

function latestUserIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

function hasCompressibleHistory(messages) {
  return messages.some((m) => {
    if (!m || typeof m !== "object") return false;
    if (typeof m.content === "string") return m.content.length > 1000;
    if (!Array.isArray(m.content)) return false;
    return m.content.some((b) =>
      b?.type === "tool_result" ||
      (typeof b?.text === "string" && b.text.length > 1000) ||
      (typeof b?.content === "string" && b.content.length > 1000)
    );
  });
}

async function loadHeadroomCompress() {
  const mod = await import("headroom-ai");
  if (typeof mod.compress !== "function") {
    throw new Error("headroom-ai does not export compress()");
  }
  return mod.compress;
}

export async function checkHeadroomSdk() {
  try {
    await loadHeadroomCompress();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function checkHeadroomProxy(baseUrl = DEFAULT_BASE_URL) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(baseUrl, { method: "GET", signal: controller.signal });
    clearTimeout(timer);
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function compactAnthropicBody(body, opts = {}) {
  const compact = normalizeCompactOptions(opts);
  const startedAt = Date.now();
  const meta = {
    enabled: compact.enabled,
    engine: compact.engine,
    baseUrl: compact.baseUrl,
    compressed: false,
    failedOpen: false,
    tokensBefore: null,
    tokensAfter: null,
    tokensSaved: null,
    ratio: null,
    transforms: [],
    error: null,
    durationMs: 0,
  };

  if (!compact.enabled) return { body, meta };
  if (compact.engine !== "headroom") {
    meta.error = `unsupported compact engine: ${compact.engine}`;
    meta.durationMs = Date.now() - startedAt;
    if (compact.fail === "closed") throw new Error(meta.error);
    meta.failedOpen = true;
    return { body, meta };
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.messages)) {
    meta.error = "request body does not contain Anthropic messages";
    meta.durationMs = Date.now() - startedAt;
    return { body, meta };
  }

  const messages = body.messages;
  const keepFrom = latestUserIndex(messages);
  const splitAt = keepFrom >= 0 ? keepFrom : messages.length;
  const history = messages.slice(0, splitAt);
  const tail = messages.slice(splitAt);

  if (!history.length || !hasCompressibleHistory(history)) {
    meta.error = "no compressible history before the latest user message";
    meta.durationMs = Date.now() - startedAt;
    return { body, meta };
  }

  try {
    const compress = compact.compressFn || await loadHeadroomCompress();
    const result = await compress(history, {
      model: body.model,
      baseUrl: compact.baseUrl,
      timeout: compact.timeoutMs,
      fallback: compact.fail === "open",
      retries: 1,
    });
    const compressedHistory = Array.isArray(result?.messages) ? result.messages : history;
    const nextBody = { ...body, messages: [...compressedHistory, ...tail] };
    meta.compressed = Boolean(result?.compressed);
    meta.failedOpen = !meta.compressed && compact.fail === "open";
    meta.tokensBefore = result?.tokensBefore ?? null;
    meta.tokensAfter = result?.tokensAfter ?? null;
    meta.tokensSaved = result?.tokensSaved ?? null;
    meta.ratio = result?.compressionRatio ?? null;
    meta.transforms = Array.isArray(result?.transformsApplied) ? result.transformsApplied : [];
    meta.durationMs = Date.now() - startedAt;
    return { body: nextBody, meta };
  } catch (e) {
    meta.error = e.message;
    meta.durationMs = Date.now() - startedAt;
    if (compact.fail === "closed") throw e;
    meta.failedOpen = true;
    return { body, meta };
  }
}
