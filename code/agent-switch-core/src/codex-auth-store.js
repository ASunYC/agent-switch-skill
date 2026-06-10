import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { profileBase } from "./profiles.js";

const STORE_VERSION = 1;

export function codexAuthStoreRoot(env = process.env) {
  return path.join(profileBase(env), "codex", ".accounts");
}

export function codexAuthAccountsDir(env = process.env) {
  return path.join(codexAuthStoreRoot(env), "accounts");
}

function indexPath(env = process.env) {
  return path.join(codexAuthStoreRoot(env), "index.json");
}

export function loadCodexAuthIndex(env = process.env) {
  const file = indexPath(env);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      version: STORE_VERSION,
      currentAccountId: parsed.currentAccountId || null,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
  } catch {
    return { version: STORE_VERSION, currentAccountId: null, accounts: [] };
  }
}

export function saveCodexAuthIndex(index, env = process.env) {
  const root = codexAuthStoreRoot(env);
  fs.mkdirSync(root, { recursive: true });
  const normalized = {
    version: STORE_VERSION,
    currentAccountId: index.currentAccountId || null,
    accounts: [...(index.accounts || [])].sort((a, b) =>
      String(b.lastUsedAt || b.updatedAt || "").localeCompare(String(a.lastUsedAt || a.updatedAt || ""))
    ),
  };
  fs.writeFileSync(indexPath(env), JSON.stringify(normalized, null, 2) + "\n");
  return normalized;
}

export function listCodexAuthAccounts(env = process.env) {
  return loadCodexAuthIndex(env).accounts;
}

export function loadCodexAuthAccount(id, env = process.env) {
  const safe = safeAccountId(id);
  if (!safe) return null;
  const file = path.join(codexAuthAccountsDir(env), `${safe}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function saveCodexAuthAccountFromDir(authDir, opts = {}) {
  const env = opts.env || process.env;
  const authPath = path.join(authDir, "auth.json");
  if (!fs.existsSync(authPath)) {
    throw new Error(`Codex auth.json was not found after login: ${authPath}`);
  }
  const authJson = JSON.parse(fs.readFileSync(authPath, "utf8"));
  return saveCodexAuthAccount(authJson, opts);
}

export function saveCodexAuthAccount(authJson, opts = {}) {
  const env = opts.env || process.env;
  const now = new Date().toISOString();
  const info = describeCodexAuth(authJson);
  const id = info.stableId || hashJson(authJson).slice(0, 16);
  const existing = loadCodexAuthAccount(id, env);
  const label = opts.label || existing?.label || info.label || `codex-${id.slice(0, 8)}`;
  const record = {
    id,
    label,
    email: info.email || existing?.email || null,
    authMode: info.authMode,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastUsedAt: existing?.lastUsedAt || null,
    authJson,
  };
  fs.mkdirSync(codexAuthAccountsDir(env), { recursive: true });
  fs.writeFileSync(
    path.join(codexAuthAccountsDir(env), `${id}.json`),
    JSON.stringify(record, null, 2) + "\n"
  );
  const index = loadCodexAuthIndex(env);
  const summary = accountSummary(record);
  index.accounts = index.accounts.filter((a) => a.id !== id);
  index.accounts.push(summary);
  return { account: record, index: saveCodexAuthIndex(index, env) };
}

export function injectCodexAuthAccount(profileDir, accountId, env = process.env) {
  const account = loadCodexAuthAccount(accountId, env);
  if (!account) throw new Error(`Codex auth account not found: ${accountId}`);
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "auth.json"), JSON.stringify(account.authJson, null, 2) + "\n");
  const now = new Date().toISOString();
  account.lastUsedAt = now;
  fs.writeFileSync(
    path.join(codexAuthAccountsDir(env), `${account.id}.json`),
    JSON.stringify(account, null, 2) + "\n"
  );
  const index = loadCodexAuthIndex(env);
  index.currentAccountId = account.id;
  index.accounts = index.accounts.filter((a) => a.id !== account.id);
  index.accounts.push(accountSummary(account));
  saveCodexAuthIndex(index, env);
  fs.writeFileSync(
    path.join(profileDir, ".agent-switch-codex-auth.json"),
    JSON.stringify({
      accountId: account.id,
      label: account.label,
      email: account.email,
      injectedAt: now,
    }, null, 2) + "\n"
  );
  return account;
}

export function removeCodexAuthAccount(accountId, env = process.env) {
  const safe = safeAccountId(accountId);
  if (!safe) throw new Error(`invalid Codex auth account id: ${accountId}`);
  const account = loadCodexAuthAccount(safe, env);
  const file = path.join(codexAuthAccountsDir(env), `${safe}.json`);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  const index = loadCodexAuthIndex(env);
  index.accounts = index.accounts.filter((a) => a.id !== safe);
  if (index.currentAccountId === safe) index.currentAccountId = null;
  saveCodexAuthIndex(index, env);
  return account;
}

export function describeCodexAuth(authJson) {
  const authMode = String(authJson?.auth_mode || authJson?.authMode || "").toLowerCase() || "unknown";
  const tokenPayload = decodeJwtPayload(authJson?.tokens?.id_token || authJson?.tokens?.idToken);
  const email = tokenPayload?.email || tokenPayload?.preferred_username || null;
  const subject = tokenPayload?.sub || authJson?.tokens?.account_id || null;
  const apiKey = typeof authJson?.OPENAI_API_KEY === "string"
    ? authJson.OPENAI_API_KEY
    : typeof authJson?.openai_api_key === "string"
      ? authJson.openai_api_key
      : null;
  const apiKeyTail = apiKey ? apiKey.slice(-6) : null;
  const stableSeed = email || subject || (apiKey ? `api-key:${hashString(apiKey).slice(0, 16)}` : null);
  return {
    authMode,
    email,
    stableId: stableSeed ? hashString(`${authMode}:${stableSeed}`).slice(0, 16) : null,
    label: email || (apiKeyTail ? `api-key-${apiKeyTail}` : subject),
  };
}

function accountSummary(record) {
  return {
    id: record.id,
    label: record.label,
    email: record.email,
    authMode: record.authMode,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastUsedAt: record.lastUsedAt,
  };
}

function hashJson(value) {
  return hashString(JSON.stringify(value));
}

function hashString(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(payload.length + ((4 - payload.length % 4) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function safeAccountId(id) {
  const text = String(id || "").trim();
  return /^[a-f0-9]{8,64}$/i.test(text) ? text : null;
}
