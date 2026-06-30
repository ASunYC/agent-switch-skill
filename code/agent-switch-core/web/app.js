// agent-switch dashboard SPA. Vanilla JS, no build step.

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const fmt = (n) => (n == null ? "-" : n.toLocaleString());

function statusClass(status) {
  if (status == null) return "pending";
  if (status < 400) return "ok";
  if (status < 500) return "4xx";
  return "5xx";
}

function groupRetries(entries, windowMs = 60_000) {
  const out = [];
  for (const e of entries) {
    const g = out[out.length - 1];
    const lastTs = g?.retries?.at(-1)?.ts ?? g?.ts;
    if (g && g.url === e.url && g.model === e.model && g.nMessages === e.nMessages && (e.ts - lastTs) < windowMs) {
      g.retries.push(e);
    } else {
      out.push({ ...e, retries: [] });
    }
  }
  return out;
}

const state = {
  session: null,
  live: null,
  entries: [],
  selected: null,
  detail: null,
  tab: "flow",
  diff: false,
  picks: [],
  errorsOnly: false,
  hideNoise: true,
  sessionMeta: new Map(),
  loadToken: 0,
  profileName: null,
  compactEnabled: false,
  sessionStats: null,
};

// ---- Segment system (inspired by Coralline / Powerlevel10k) --------------

const SEGMENTS = {
  sessions: {
    title: "Sessions",
    icon: "📦",
    order: 0,
    render() {
      const sessions = [...new Set(state.entries.map((e) => e.session).filter(Boolean))];
      const count = sessions.length || (state.session ? 1 : 0);
      const live = state.live ? `<span class="seg-live">live</span>` : "";
      return `<div class="seg-value">${count} active ${live}</div>`;
    },
  },
  statusCodes: {
    title: "Status",
    icon: "📊",
    order: 1,
    render() {
      const signal = state.entries.filter((e) => !isNoise(e));
      const ok = signal.filter((e) => statusClass(e.status) === "ok").length;
      const err4 = signal.filter((e) => statusClass(e.status) === "4xx").length;
      const err5 = signal.filter((e) => statusClass(e.status) === "5xx" || e.error).length;
      const total = signal.length;
      const pct = total ? Math.round((ok / total) * 100) : 0;
      const barColor = err5 ? "var(--del)" : err4 ? "var(--cache)" : "var(--add)";
      return `
        <div class="seg-bar"><div style="width:${pct}%;background:${barColor}"></div></div>
        <div class="seg-row">
          <span class="seg-ok">${ok} ok</span>
          ${err4 ? `<span class="seg-warn">${err4} 4xx</span>` : ""}
          ${err5 ? `<span class="seg-err">${err5} err</span>` : ""}
          <span class="seg-muted">${total} total</span>
        </div>`;
    },
  },
  profile: {
    title: "Profile",
    icon: "👤",
    order: 2,
    render() {
      const name = state.profileName || "default";
      return `<div class="seg-value">${esc(name)}</div>`;
    },
  },
  compact: {
    title: "Compact",
    icon: "🗜",
    order: 3,
    render() {
      const compactEntries = state.entries.filter((e) => e.compact?.enabled);
      if (!compactEntries.length && !state.compactEnabled) {
        return `<div class="seg-value seg-muted">off</div>`;
      }
      const compressed = compactEntries.filter((e) => e.compact?.compressed);
      const tokensSaved = compactEntries.reduce((s, e) => s + (e.compact?.tokensSaved || 0), 0);
      const avgRatio = compressed.length
        ? compressed.reduce((s, e) => s + (e.compact?.ratio ?? 1), 0) / compressed.length
        : null;
      const ratioPct = avgRatio != null ? Math.round((1 - avgRatio) * 100) : 0;
      return `
        <div class="seg-value">${compressed.length ? `${ratioPct}% saved` : "on"}</div>
        <div class="seg-row">
          <span class="seg-muted">${compressed.length}/${compactEntries.length} compressed</span>
          ${tokensSaved ? `<span class="seg-ok">${fmt(tokensSaved)} tok saved</span>` : ""}
        </div>`;
    },
  },
  latency: {
    title: "Latency",
    icon: "⏱",
    order: 4,
    render() {
      const withLatency = state.entries.filter((e) => e.latencyMs != null);
      if (!withLatency.length) return `<div class="seg-value seg-muted">no data</div>`;
      const latencies = withLatency.map((e) => e.latencyMs).sort((a, b) => a - b);
      const avg = Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length);
      const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? avg;
      return `
        <div class="seg-value">${avg}ms</div>
        <div class="seg-row"><span class="seg-muted">avg</span> <span class="seg-muted">p95 ${p95}ms</span></div>`;
    },
  },
  cost: {
    title: "Cost",
    icon: "💰",
    order: 5,
    render() {
      const stats = state.sessionStats;
      if (!stats || stats.totalCost === 0) return `<div class="seg-value seg-muted">—</div>`;
      return `<div class="seg-value">$${stats.totalCost.toFixed(4)}</div>
        <div class="seg-row"><span class="seg-muted">${stats.requestsWithUsage}/${stats.totalRequests} priced</span></div>`;
    },
  },
  tokens: {
    title: "Tokens",
    icon: "📝",
    order: 6,
    render() {
      const stats = state.sessionStats;
      if (!stats || (!stats.totalTokens && !stats.inputTokens && !stats.outputTokens)) {
        return `<div class="seg-value seg-muted">no data</div>`;
      }
      const total = fmt(stats.totalTokens);
      const input = fmt(stats.inputTokens);
      const output = fmt(stats.outputTokens);
      const cache = stats.cacheReadTokens ? fmt(stats.cacheReadTokens) : null;
      return `
        <div class="seg-value">${total}</div>
        <div class="seg-row">
          <span class="seg-muted">in:${input}</span>
          <span class="seg-muted">out:${output}</span>
          ${cache ? `<span class="seg-ok">cache:${cache}</span>` : ""}
        </div>`;
    },
  },
};

const DEFAULT_SEGMENT_ORDER = ["sessions", "statusCodes", "profile", "compact", "tokens"];
const SEGMENT_CONFIG_KEY = "agent-switch-segment-config";

function loadSegmentConfig() {
  try {
    const raw = localStorage.getItem(SEGMENT_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { enabled: [...DEFAULT_SEGMENT_ORDER], layout: "grid" };
}

function saveSegmentConfig(cfg) {
  try { localStorage.setItem(SEGMENT_CONFIG_KEY, JSON.stringify(cfg)); } catch {}
}

function getEnabledSegments() {
  const cfg = loadSegmentConfig();
  const ids = cfg.enabled || DEFAULT_SEGMENT_ORDER;
  return ids
    .filter((id) => SEGMENTS[id])
    .sort((a, b) => (SEGMENTS[a].order ?? 99) - (SEGMENTS[b].order ?? 99))
    .map((id) => ({ id, ...SEGMENTS[id] }));
}

async function api(path) {
  const r = await fetch(path);
  return r.json();
}

// ---- sessions + list -----------------------------------------------------

async function loadSessions() {
  const data = await api("/api/sessions");
  const sessions = (data.sessions || []).filter((s) => s !== "sessions");
  const live = data.live === "sessions" ? null : data.live;
  state.live = live;
  renderSessionOptions(sessions);
  state.session = state.session || live || sessions[0] || null;
  if (state.session) $("#session").value = state.session;
  $("#live").classList.toggle("off", !live);
  await loadList();
  hydrateSessionOptions(sessions);
  renderCurrentSummary();
}

async function loadList() {
  if (!state.session) return;
  const token = ++state.loadToken;
  const { entries } = await api("/api/requests?session=" + encodeURIComponent(state.session));
  if (token !== state.loadToken) return;
  state.entries = entries;
  state.sessionMeta.set(state.session, sessionMeta(entries));
  renderSessionOptions([...$("#session").options].map((o) => o.value));
  if (!state.diff && (!state.selected || !state.entries.some((e) => e.id === state.selected))) {
    const pick = bestEntry(state.entries);
    state.selected = pick?.id ?? null;
    state.detail = null;
    renderMonitorOverview();
    if (pick) loadDetail(pick.id, token);
    else renderEmptyDetail("No requests in this session yet.");
  }
  renderList();
  loadStats();
}

async function loadStats() {
  if (!state.session) return;
  try {
    state.sessionStats = await api("/api/stats?session=" + encodeURIComponent(state.session));
    renderMonitorOverview(state.detail);
  } catch {}
}

function bestEntry(entries) {
  const visible = entries.filter((e) => !isNoise(e));
  return [...visible].reverse().find((e) => !e.error && statusClass(e.status) === "ok" && e.nMessages > 0)
    || [...visible].reverse().find((e) => !e.error && statusClass(e.status) === "ok")
    || visible.at(-1)
    || entries.at(-1);
}

async function hydrateSessionOptions(sessions) {
  await Promise.all(sessions.map(async (s) => {
    if (state.sessionMeta.has(s)) return;
    try {
      const { entries } = await api("/api/requests?session=" + encodeURIComponent(s));
      state.sessionMeta.set(s, sessionMeta(entries));
    } catch {}
  }));
  renderSessionOptions(sessions);
}

function sessionMeta(entries) {
  const signal = entries.filter((e) => !isNoise(e));
  return {
    total: entries.length,
    signal: signal.length,
    errors: signal.filter((e) => e.error || statusClass(e.status) === "4xx" || statusClass(e.status) === "5xx").length,
  };
}

function renderSessionOptions(sessions) {
  const sel = $("#session");
  const current = state.session || sel.value;
  sel.innerHTML = "";
  for (const s of sessions) {
    sel.append(el("option", { value: s, textContent: sessionLabel(s) }));
  }
  if (current) sel.value = current;
}

function sessionLabel(s) {
  const when = s === "sessions" ? "sessions" : s.slice(0, 19).replace("T", " ");
  const meta = state.sessionMeta.get(s);
  const count = meta ? ` - ${meta.signal} req${meta.total !== meta.signal ? ` (${meta.total - meta.signal} noise)` : ""}` : "";
  const live = s === state.live ? " - live" : "";
  return when + count + live;
}

function isNoise(e) {
  const method = String(e.method || "").toUpperCase();
  return !e.model && e.nMessages === 0 && e.nTools === 0 && (method === "HEAD" || method === "OPTIONS" || e.url === "/");
}

function updateErrorsBtn() {
  const count = state.entries.filter((e) => {
    if (state.hideNoise && isNoise(e)) return false;
    const sc = statusClass(e.status);
    return sc === "4xx" || sc === "5xx" || e.error != null;
  }).length;
  const btn = $("#errorsBtn");
  btn.textContent = `errors (${count})`;
  btn.classList.toggle("on", state.errorsOnly);
}

function renderList() {
  updateErrorsBtn();
  updateNoiseBtn();
  const list = $("#list");
  list.innerHTML = "";
  let visible = state.entries;
  if (state.hideNoise) visible = visible.filter((e) => !isNoise(e));
  if (state.errorsOnly) {
    visible = visible.filter((e) => {
      const sc = statusClass(e.status);
      return sc === "4xx" || sc === "5xx" || e.error != null;
    });
  }
  renderRequestCount(visible.length);
  const grouped = groupRetries(visible);
  if (!grouped.length) {
    const hiddenNoise = state.hideNoise && state.entries.some((e) => isNoise(e));
    list.append(el("div", { className: "list-empty", textContent: hiddenNoise ? "Only probe requests captured. Turn noise on to inspect them." : "No requests in this session." }));
    renderCurrentSummary();
    return;
  }
  for (const e of grouped) {
    const sc = e.error ? "5xx" : statusClass(e.status);
    const rowClass = ["row", isNoise(e) ? "noise" : "", sc === "4xx" ? "status-4xx" : sc === "5xx" ? "status-5xx" : ""].filter(Boolean).join(" ");
    const row = el("div", { className: rowClass });
    if (e.id === state.selected) row.classList.add("sel");
    if (state.picks.includes(e.id)) row.classList.add("pick");
    const statusTxtClass = sc === "4xx" ? "status-txt-4xx" : sc === "5xx" ? "status-txt-5xx" : (e.pending ? "pending" : "");
    const statusText = e.error ? "transport error" : (e.pending ? "pending..." : "HTTP " + e.status);
    const method = e.method || "POST";
    const endpoint = e.url || "/";
    const top = el("div", { className: "top" },
      el("span", { className: "endpoint", title: `${method} ${endpoint}`, textContent: `#${e.seq} - ${method} ${endpoint}` }),
      el("span", { className: `status-pill ${statusTxtClass}`, textContent: statusText }));
    const meta = el("div", { className: "meta" },
      el("span", { className: "model", textContent: e.model || e.format || "probe" }),
      el("span", { textContent: `${e.nMessages} messages` }),
      el("span", { textContent: `${e.nTools} tools` }));
    const sub = el("div", { className: "sub" },
      el("span", { className: "time", textContent: e.ts ? new Date(e.ts).toLocaleTimeString() : "" }));
    if (isNoise(e)) sub.append(el("span", { className: "noise-badge", textContent: " probe" }));
    if (e.nToolUse) sub.append(el("span", { className: "toolcalls", title: "tool calls in this request", textContent: ` tool calls:${e.nToolUse}` }));
    if (e.compact?.enabled) {
      const label = e.compact.compressed
        ? ` compact ${compactSavedLabel(e.compact)}`
        : e.compact.failedOpen
          ? " compact failed-open"
          : " compact skipped";
      sub.append(el("span", { className: "compact-badge", title: e.compact.error || "Headroom compact", textContent: label }));
    }
    if (e.retries.length) sub.append(el("span", { className: "retry-badge", textContent: ` retried x${e.retries.length}` }));
    row.append(top, meta, sub);
    row.onclick = () => onPick(e.id);
    list.append(row);
  }
  renderCurrentSummary();
}

function updateNoiseBtn() {
  const btn = $("#noiseBtn");
  const hidden = state.entries.filter((e) => isNoise(e)).length;
  btn.textContent = state.hideNoise ? `noise: hidden${hidden ? ` (${hidden})` : ""}` : "noise: shown";
  btn.classList.toggle("on", !state.hideNoise);
}

function renderRequestCount(count) {
  const target = $("#requestCount");
  if (!target) return;
  const total = state.entries.length;
  target.textContent = `${count} shown / ${total} total`;
}

function onPick(id) {
  if (state.diff) {
    state.picks = state.picks.includes(id) ? state.picks.filter((x) => x !== id) : [...state.picks, id].slice(-2);
    if (state.picks.length === 2) renderDiff();
    renderList();
    return;
  }
  state.selected = id;
  state.detail = null;
  renderMonitorOverview();
  renderList();
  loadDetail(id, state.loadToken);
}

// ---- detail --------------------------------------------------------------

async function loadDetail(id, token = state.loadToken) {
  const rec = await api("/api/request/" + encodeURIComponent(id));
  if (token !== state.loadToken || id !== state.selected) return;
  state.detail = rec;
  renderDetail();
}

function renderEmptyDetail(message = "Select a request, or start chatting in Claude Code.") {
  $("#detail").innerHTML = `<div class="empty">${esc(message)}</div>`;
  renderCurrentSummary();
  renderMonitorOverview();
}

const TABS = ["flow", "original", "forwarded", "compression", "system", "messages", "tools", "response", "headers"];

function renderDetail() {
  const rec = state.detail;
  if (!rec) return renderEmptyDetail();
  renderCurrentSummary();
  renderMonitorOverview(rec);
  const d = $("#detail");
  d.innerHTML = "";
  const tabs = el("div", { className: "tabs" });
  for (const t of TABS) {
    const tab = el("div", { className: "tab" + (t === state.tab ? " on" : ""), textContent: t });
    tab.onclick = () => { state.tab = t; renderDetail(); };
    tabs.append(tab);
  }
  d.append(tabs);
  const pane = el("div", { className: "pane" });
  pane.innerHTML = paneHtml(rec, state.tab);
  d.append(pane);
}

function renderCurrentSummary() {
  const target = $("#requestSummary");
  if (!target) return;
  const entry = state.entries.find((e) => e.id === state.selected);
  if (!entry) {
    target.textContent = state.session ? "No model request selected" : "No session selected";
    return;
  }
  const status = entry.error ? "transport error" : entry.pending ? "pending" : `HTTP ${entry.status}`;
  const parts = [
    `#${entry.seq}`,
    entry.model || entry.format || "probe",
    status,
    `${entry.nMessages} msg`,
    `${entry.nTools} tools`,
  ];
  const cost = state.detail?.id === entry.id ? state.detail?.parsed?.cost?.usd : null;
  if (cost != null) parts.push("$" + cost.toFixed(5));
  if (entry.compact?.enabled) parts.push(entry.compact.compressed ? `compact ${compactSavedLabel(entry.compact)}` : entry.compact.failedOpen ? "compact failed-open" : "compact skipped");
  target.textContent = parts.join(" - ");
}

function renderMonitorOverview(rec = null) {
  const target = $("#monitorOverview");
  if (!target) return;

  // Segment grid (top) + per-request metrics (below, when a request is selected)
  const segments = getEnabledSegments();
  const segHtml = segments.map((seg) =>
    `<div class="segment"><div class="seg-header">${seg.icon} ${esc(seg.title)}</div>${seg.render()}</div>`
  ).join("");

  if (!rec) {
    target.innerHTML = `
      <div class="segment-grid">${segHtml}</div>
      <div class="overview-actions">
        <button class="seg-settings-btn" id="segSettingsBtn" title="Configure segments">⚙ segments</button>
        <span class="overview-empty">Select a request for details</span>
      </div>`;
    bindSegSettingsBtn();
    return;
  }

  const parsed = rec.parsed || {};
  const c = parsed.cost || {};
  const u = parsed.response?.usage || {};
  const view = parsed.view || { messages: [], tools: [] };
  const body = rec.request?.body || {};
  const status = rec.response?.status ?? null;
  const sc = statusClass(status);
  const items = [
    ["model", body.model || rec.model || "-"],
    ["status", status != null ? "HTTP " + status : "-"],
    ["ctx", `${view.messages.length} msg / ${view.tools.length} tools`],
    ["input", fmt(u.input_tokens ?? parsed.estTokens)],
    ["output", fmt(u.output_tokens)],
    ["cache", fmt(c.cacheRead)],
    ["cost", "$" + (c.usd || 0).toFixed(5)],
    ["compact", compactSummary(rec)],
    ["stop", parsed.response?.stop_reason || "-"],
  ];
  const metrics = items.map(([k, v]) => {
    const cls = k === "status" && sc !== "ok" ? ` metric-${sc}` : "";
    return `<div class="overview-metric${cls}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  }).join("");
  const dl = (f) => `<a class="dl" href="/api/export?id=${encodeURIComponent(rec.id)}&format=${f}">${f}</a>`;
  target.innerHTML = `
    <div class="segment-grid">${segHtml}</div>
    <div class="overview-metrics">${metrics}</div>
    <div class="overview-actions">
      <button class="seg-settings-btn" id="segSettingsBtn" title="Configure segments">⚙ segments</button>
      <span>Export</span>${dl("md")}${dl("json")}${dl("har")}${dl("raw")}
    </div>`;
  bindSegSettingsBtn();
}

function paneHtml(rec, tab) {
  const parsed = rec.parsed || {};
  const view = parsed.view || { system: [], messages: [], tools: [] };
  if (tab === "flow") return flowHtml(rec);
  if (tab === "original") return blockEl("original request body", JSON.stringify(rec.request?.body || null, null, 2));
  if (tab === "forwarded") return forwardedHtml(rec);
  if (tab === "compression") return compressionHtml(rec);
  if (tab === "system") return blocksHtml(view.system);
  if (tab === "messages") return messagesHtml(view.messages);
  if (tab === "tools") return toolsHtml(view.tools);
  if (tab === "response") return responseHtml(parsed.response);
  if (tab === "headers") return blockEl("headers", JSON.stringify(rec.request?.headers || {}, null, 2));
  return "";
}

function card(k, v, sub, cls = "") {
  return `<div class="card${cls ? " " + cls : ""}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}${sub ? ` <small>${esc(sub)}</small>` : ""}</div></div>`;
}

function blockEl(label, text, tags = "") {
  return `<div class="block"><div class="h"><span>${esc(label)}</span><span>${tags}</span></div>${preBody(text)}</div>`;
}

function blocksHtml(blocks) {
  if (!blocks.length) return `<p style="color:var(--muted)">none</p>`;
  return blocks.map((b) => blockEl(b.label, b.text, b.cache ? '<span class="tag cache">cache 1h</span>' : "")).join("");
}

// A short, stable hue from a tool-call id so a tool_use and its matching
// tool_result share the same colored stripe and id chip.
function idHue(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// Long bodies fold into a <details> toggle so the history stays scannable.
// The summary reports the line count; CSS swaps "show N lines" / "hide"
// as it opens/closes; a plain show/hide toggle, no JS wiring needed.
function preBody(text) {
  const t = text || "";
  const lines = t.split("\n").length;
  const long = t.length > 800 || lines > 18;
  if (!long) return `<pre>${esc(t)}</pre>`;
  return `<details class="fold"><summary><span class="more show">show ${lines} lines</span><span class="more hide">hide</span></summary><pre>${esc(t)}</pre></details>`;
}

function messagesHtml(messages) {
  if (!messages.length) return `<p style="color:var(--muted)">none</p>`;
  return messages.map((m) => {
    const tags = [];
    if (m.cache) tags.push('<span class="tag cache">cache 1h</span>');
    if (m.type === "tool_use") tags.push(`<span class="tag tool">tool ${esc(m.name || "tool_use")}</span>`);
    else if (m.type === "tool_result") tags.push(`<span class="tag ${m.isError ? "err" : "result"}">-> ${m.isError ? "error" : "result"}</span>`);
    else if (m.type && m.type !== "text" && m.type !== "message") tags.push(`<span class="tag tool">${esc(m.type)}</span>`);
    const paired = m.type === "tool_use" || m.type === "tool_result";
    if (paired && m.callId) {
      const hue = idHue(m.callId);
      tags.push(`<span class="tag id" style="background:hsl(${hue} 60% 28%);color:hsl(${hue} 70% 82%)">${esc(String(m.callId).slice(-8))}</span>`);
    }
    const stripe = paired && m.callId ? ` style="border-left:3px solid hsl(${idHue(m.callId)} 60% 45%)"` : "";
    return `<div class="block"${stripe}><div class="h"><span>${esc(m.label)}</span><span>${tags.join("")}</span></div>${preBody(m.text)}</div>`;
  }).join("");
}

function toolsHtml(tools) {
  if (!tools.length) return `<p style="color:var(--muted)">none</p>`;
  return tools.map((t) =>
    `<div class="block"><div class="h"><span>${esc(t.name)}</span></div>` +
    preBody(`${t.description || ""}\n\n-- schema --\n${JSON.stringify(t.schema || {}, null, 2)}`) +
    `</div>`
  ).join("");
}

function responseHtml(r) {
  if (!r) return `<p style="color:var(--muted)">no response captured</p>`;
  let html = blockEl("usage", JSON.stringify(r.usage || {}, null, 2), r.streamed ? '<span class="tag tool">streamed</span>' : "");
  for (const b of r.content || []) {
    const label = b.type === "tool_use" ? `tool_use: ${b.name}` : b.type;
    const text = b.type === "tool_use" ? JSON.stringify(b.input, null, 2) : (b.text ?? b.thinking ?? JSON.stringify(b));
    html += blockEl(label, text);
  }
  if (r.error) html += blockEl("error", JSON.stringify(r.error, null, 2));
  return html;
}

// ---- flow: conversation-level sequence diagram ---------------------------
// Reconstructs the agent loop from the parsed messages[] (the full history the
// model was sent) plus this request's response (the model's latest decision,
// not yet folded back into messages). Each tool_use is paired with its
// tool_result by call_id and shares a color, so you can read: model picks a
// tool -> CLI executes it locally -> result is sent back -> model picks again.

const FLOW_ICON = {
  user: "U", assistant: "A", thinking: "T",
  tool_use: ">", skill: "S", tool_result: "<", stop: "X",
};

function oneLine(t, n = 100) {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "..." : s;
}

// A Skill tool_use input is { skill, args }; pull the skill name out of it.
function skillName(text) {
  try { const o = JSON.parse(text); return o.skill || o.name || ""; } catch { return ""; }
}

function flowSteps(rec) {
  const parsed = rec.parsed || {};
  const steps = [];
  for (const m of parsed.view?.messages || []) {
    if (m.type === "tool_use") {
      const isSkill = m.name === "Skill";
      steps.push({ kind: isSkill ? "skill" : "tool_use", name: isSkill ? skillName(m.text) || "skill" : m.name, callId: m.callId, text: m.text });
    } else if (m.type === "tool_result") {
      steps.push({ kind: "tool_result", callId: m.callId, isError: m.isError, text: m.text });
    } else if (m.type === "thinking") {
      steps.push({ kind: "thinking", text: m.text });
    } else {
      steps.push({ kind: m.role === "assistant" ? "assistant" : "user", text: m.text });
    }
  }
  // The reply to THIS request lives in the response, not yet in messages[].
  const r = parsed.response;
  if (r && Array.isArray(r.content)) {
    for (const b of r.content) {
      if (b.type === "tool_use") {
        const isSkill = b.name === "Skill";
        steps.push({ kind: isSkill ? "skill" : "tool_use", name: isSkill ? (b.input?.skill || "skill") : b.name, callId: b.id, text: JSON.stringify(b.input ?? {}, null, 2), latest: true });
      } else if (b.type === "thinking") {
        steps.push({ kind: "thinking", text: b.thinking ?? "", latest: true });
      } else {
        steps.push({ kind: "assistant", text: b.text ?? "", latest: true });
      }
    }
    if (r.stop_reason) steps.push({ kind: "stop", text: r.stop_reason });
  }
  return steps;
}

function flowHtml(rec) {
  const steps = flowSteps(rec);
  if (!steps.length) return `<p style="color:var(--muted)">no messages</p>`;
  const tools = rec.parsed?.view?.tools || [];
  const menu = tools.length
    ? `<details class="fold toolmenu"><summary><span class="more show">${tools.length} tools offered to the model</span><span class="more hide">hide tool menu</span></summary><pre>${esc(tools.map((t) => t.name).join("\n"))}</pre></details>`
    : "";

  const rows = steps.map((s) => {
    const paired = s.kind === "tool_use" || s.kind === "skill" || s.kind === "tool_result";
    const hue = s.callId ? ` style="--hue:${idHue(s.callId)}"` : "";
    const tags = [];
    if (s.kind === "skill") tags.push('<span class="tag skill">skill</span>');
    if (s.kind === "tool_result") tags.push(`<span class="tag ${s.isError ? "err" : "result"}">${s.isError ? "error" : "ok"}</span>`);
    if (s.callId) tags.push(`<span class="tag id">${esc(String(s.callId).slice(-6))}</span>`);
    if (s.latest) tags.push('<span class="tag latest">this turn</span>');
    const title =
      s.kind === "tool_use" ? `tool_use -> <b>${esc(s.name || "")}</b>` :
      s.kind === "skill" ? `Skill -> <b>${esc(s.name || "")}</b>` :
      s.kind === "tool_result" ? "tool_result -> executed locally" :
      s.kind === "stop" ? `stop_reason: ${esc(s.text)}` :
      s.kind === "thinking" ? "thinking" : s.kind;
    const body = s.kind === "stop" ? "" :
      `<details class="fold step-body"><summary><span class="prev">${esc(oneLine(s.text))}</span></summary><pre>${esc(s.text)}</pre></details>`;
    return `<div class="step ${s.kind}${paired ? " indent" : ""}"${hue}>` +
      `<span class="dot">${FLOW_ICON[s.kind] || "-"}</span>` +
      `<div class="node"><div class="lead">${title}${tags.join("")}</div>${body}</div></div>`;
  }).join("");

  return `<div class="flow">${menu}<div class="timeline">${rows}</div></div>`;
}

// ---- diff ----------------------------------------------------------------

async function renderDiff() {
  const [a, b] = state.picks;
  const diff = await api(`/api/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  const d = $("#detail");
  d.innerHTML = "";
  const pane = el("div", { className: "pane" });
  if (diff.error) { pane.innerHTML = `<p>${esc(diff.error)}</p>`; d.append(pane); return; }
  const c = diff.counts;
  pane.innerHTML =
    `<div class="cards">
      ${card("added", "+" + c.added, "blocks")}
      ${card("removed", "-" + c.removed, "blocks")}
      ${card("unchanged", c.common, "blocks")}
      ${card("cached in B", c.cachedInB, "blocks")}
     </div>
     <p style="color:var(--muted)">Comparing <b>${esc(a)}</b> -> <b>${esc(b)}</b> (later request B vs earlier A)</p>` +
    `<div class="diff-section add">+ Added in B (new context this turn)</div>` +
    (diff.added.map((x) => diffBlock(x, "add")).join("") || `<p style="color:var(--muted)">nothing new</p>`) +
    `<div class="diff-section del">- Removed since A</div>` +
    (diff.removed.map((x) => diffBlock(x, "del")).join("") || `<p style="color:var(--muted)">nothing removed</p>`);
  d.append(pane);
}

function diffBlock(x, kind) {
  const tag = x.cache ? '<span class="tag cache">cache</span>' : "";
  return `<div class="block diff-${kind}"><div class="h"><span>${esc(x.label)}</span><span>${tag}</span></div><pre>${esc((x.text || "").slice(0, 4000))}</pre></div>`;
}

// ---- segment settings modal ----------------------------------------------

function bindSegSettingsBtn() {
  const btn = $("#segSettingsBtn");
  if (btn) btn.onclick = openSegmentSettings;
}

function openSegmentSettings() {
  const cfg = loadSegmentConfig();
  const enabled = cfg.enabled || DEFAULT_SEGMENT_ORDER;

  const overlay = el("div", { className: "seg-overlay" });
  const modal = el("div", { className: "seg-modal" });

  const title = el("h2", { textContent: "Configure Segments" });
  const subtitle = el("p", { className: "seg-subtitle", textContent: "Choose which info segments appear in the overview bar." });

  const list = el("div", { className: "seg-list" });
  const allIds = Object.keys(SEGMENTS).sort((a, b) => (SEGMENTS[a].order ?? 99) - (SEGMENTS[b].order ?? 99));
  const checks = {};
  for (const id of allIds) {
    const seg = SEGMENTS[id];
    const row = el("label", { className: "seg-check" });
    const cb = el("input", { type: "checkbox" });
    cb.checked = enabled.includes(id);
    cb.dataset.segId = id;
    checks[id] = cb;
    const label = el("span", { className: "seg-check-label" },
      el("span", { textContent: `${seg.icon} ${seg.title}` }),
      el("span", { className: "seg-check-desc", textContent: segDesc(id) })
    );
    row.append(cb, label);
    list.append(row);
  }

  const layoutLabel = el("div", { className: "seg-layout-label", textContent: "Layout" });
  const layoutRow = el("div", { className: "seg-layout-row" });
  for (const l of ["grid", "bar"]) {
    const opt = el("label", { className: "seg-layout-opt" });
    const radio = el("input", { type: "radio", name: "seg-layout", value: l });
    radio.checked = (cfg.layout || "grid") === l;
    opt.append(radio, el("span", { textContent: l === "grid" ? "Grid (2×N)" : "Bar (1×N)" }));
    layoutRow.append(opt);
  }

  const actions = el("div", { className: "seg-actions" });
  const cancelBtn = el("button", { textContent: "Cancel" });
  cancelBtn.onclick = () => overlay.remove();
  const saveBtn = el("button", { className: "on", textContent: "Save" });
  saveBtn.onclick = () => {
    const newEnabled = Object.entries(checks).filter(([, cb]) => cb.checked).map(([id]) => id);
    const layout = layoutRow.querySelector("input:checked")?.value || "grid";
    saveSegmentConfig({ enabled: newEnabled, layout });
    overlay.remove();
    renderMonitorOverview(state.detail);
  };
  actions.append(cancelBtn, saveBtn);

  modal.append(title, subtitle, list, layoutLabel, layoutRow, actions);
  overlay.append(modal);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.append(overlay);
}

function segDesc(id) {
  const desc = {
    sessions: "Active capture session count and live status",
    statusCodes: "Request success rate with status code breakdown",
    profile: "Current CLI profile name",
    compact: "Headroom compression ratio and token savings",
    latency: "Average and p95 request latency",
    cost: "Estimated API cost from captured requests",
    tokens: "Cumulative input, output, and cache tokens for this session",
  };
  return desc[id] || "";
}

// ---- live + wiring -------------------------------------------------------

function connectStream() {
  try {
    const es = new EventSource("/api/stream");
    es.onmessage = (ev) => {
      const s = JSON.parse(ev.data);
      if (s.session !== (state.session || state.live)) return;
      const i = state.entries.findIndex((e) => e.id === s.id);
      if (i >= 0) state.entries[i] = s;
      else state.entries.push(s);
      state.sessionMeta.set(state.session || s.session, sessionMeta(state.entries));
      renderSessionOptions([...$("#session").options].map((o) => o.value));
      if (!state.diff && !state.selected && !s.error && statusClass(s.status) === "ok") {
        state.selected = s.id;
        loadDetail(s.id, state.loadToken);
      }
      renderList();
      if (s.id === state.selected) loadDetail(s.id, state.loadToken);
    };
  } catch {}
}

function compactSavedLabel(compact) {
  if (compact.tokensSaved != null) return `${fmt(compact.tokensSaved)} saved`;
  if (compact.ratio != null) return `${Math.round((1 - compact.ratio) * 100)}% saved`;
  return "saved";
}

function compactSummary(rec) {
  const c = rec.compression || rec.compact;
  if (!c?.enabled) return "off";
  if (c.compressed) return compactSavedLabel(c);
  if (c.failedOpen) return "failed-open";
  if (c.error) return "skipped";
  return "on";
}

function forwardedHtml(rec) {
  if (!rec.forwarded) return `<p style="color:var(--muted)">same as original request</p>`;
  const parsed = rec.parsed?.forwarded;
  const body = blockEl("forwarded request body", JSON.stringify(rec.forwarded.body || null, null, 2));
  if (!parsed?.view) return body;
  return [
    blockEl("forwarded token estimate", String(parsed.estTokens ?? "-")),
    blocksHtml(parsed.view.system || []),
    messagesHtml(parsed.view.messages || []),
    toolsHtml(parsed.view.tools || []),
    body,
  ].join("");
}

function compressionHtml(rec) {
  const c = rec.compression || { enabled: false };
  return blockEl("compression", JSON.stringify(c, null, 2));
}

$("#session").onchange = (e) => {
  state.session = e.target.value;
  state.selected = null;
  state.detail = null;
  state.entries = [];
  state.picks = [];
  renderList();
  renderEmptyDetail("Loading session...");
  loadList();
};
$("#errorsBtn").onclick = () => { state.errorsOnly = !state.errorsOnly; renderList(); };
$("#noiseBtn").onclick = () => {
  state.hideNoise = !state.hideNoise;
  if (state.hideNoise && state.selected && isNoise(state.entries.find((e) => e.id === state.selected) || {})) {
    const pick = bestEntry(state.entries);
    state.selected = pick?.id ?? null;
    state.detail = null;
    if (pick) loadDetail(pick.id, state.loadToken);
    else renderEmptyDetail("Only probe requests captured in this session.");
  }
  renderList();
};
$("#diffBtn").onclick = (e) => {
  state.diff = !state.diff;
  state.picks = [];
  e.target.textContent = "Diff: " + (state.diff ? "pick 2" : "off");
  e.target.classList.toggle("on", state.diff);
  renderList();
  if (!state.diff && state.selected) loadDetail(state.selected);
};

async function loadMeta() {
  try {
    const data = await api("/api/meta");
    state.profileName = data.profileName || null;
    state.compactEnabled = Boolean(data.compactEnabled);
  } catch {}
}

loadMeta().then(() => loadSessions()).then(connectStream);
