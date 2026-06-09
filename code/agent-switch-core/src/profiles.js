import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const PROFILE_TOOLS = {
  claude: {
    label: "Claude Code",
    envVar: "CLAUDE_CONFIG_DIR",
    defaultHome: (env = process.env) => path.join(env.AGENT_SWITCH_PROFILE_SOURCE_HOME || os.homedir(), ".claude"),
    linkable: ["settings.json", "skills", "agents", "plugins", "commands"],
    neverLink: [".credentials.json", "todos", "projects", "history.jsonl"],
  },
  codex: {
    label: "Codex",
    envVar: "CODEX_HOME",
    defaultHome: (env = process.env) => path.join(env.AGENT_SWITCH_PROFILE_SOURCE_HOME || os.homedir(), ".codex"),
    linkable: ["config.toml", "skills", "agents", "prompts", "mcp-configs", "plugins"],
    neverLink: ["auth.json", "sessions", "history.jsonl"],
  },
  opencode: {
    label: "OpenCode",
    envVar: "OPENCODE_CONFIG_DIR",
    defaultHome: (env = process.env) => path.join(env.AGENT_SWITCH_PROFILE_SOURCE_HOME || os.homedir(), ".opencode"),
    linkable: [],
    neverLink: ["auth.json", "sessions", "history.jsonl"],
  },
};

export class ProfileError extends Error {
  constructor(message, code = "PROFILE_ERROR") {
    super(message);
    this.name = "ProfileError";
    this.code = code;
  }
}

export function profileBase(env = process.env) {
  return path.resolve(env.AGENT_SWITCH_PROFILE_HOME || path.join(os.homedir(), ".agent-switch", "profiles"));
}

export function parseProfileSpec(spec, defaultTool = null) {
  const raw = String(spec || "").trim();
  if (!raw) throw new ProfileError("profile name is required");
  const parts = raw.split("/");
  let tool;
  let name;
  if (parts.length === 1) {
    tool = defaultTool;
    name = parts[0];
  } else if (parts.length === 2) {
    [tool, name] = parts;
  } else {
    throw new ProfileError(`invalid profile "${raw}". Use <tool>/<name> or <name>.`);
  }
  if (!tool) throw new ProfileError(`profile "${raw}" needs a tool prefix, e.g. codex/work`);
  if (!PROFILE_TOOLS[tool]) {
    throw new ProfileError(`unsupported profile tool "${tool}". Supported: ${Object.keys(PROFILE_TOOLS).join(", ")}`);
  }
  if (!NAME_RE.test(name || "")) {
    throw new ProfileError(`invalid profile name "${name}". Use letters, numbers, dot, dash, or underscore.`);
  }
  return { tool, name, spec: `${tool}/${name}` };
}

export function profileDir(tool, name, env = process.env) {
  const parsed = parseProfileSpec(`${tool}/${name}`);
  return path.join(profileBase(env), parsed.tool, parsed.name);
}

export function profileToolForProvider(provider) {
  if (provider?.command === "claude") return "claude";
  if (provider?.command === "codex") return "codex";
  if (provider?.command === "opencode") return "opencode";
  return null;
}

export function profileEnv(tool, dir) {
  const def = PROFILE_TOOLS[tool];
  if (!def) throw new ProfileError(`unsupported profile tool "${tool}"`);
  return { [def.envVar]: dir };
}

export function resolveRunProfile(provider, requested, env = process.env) {
  if (!requested) return null;
  const expectedTool = profileToolForProvider(provider);
  if (!expectedTool) {
    throw new ProfileError(`profiles are not supported for ${provider?.label || "this provider"}`);
  }
  const parsed = parseProfileSpec(requested, expectedTool);
  if (parsed.tool !== expectedTool) {
    throw new ProfileError(
      `${provider?.label || "this provider"} uses ${expectedTool} profiles, not ${parsed.tool}/${parsed.name}`
    );
  }
  const dir = profileDir(parsed.tool, parsed.name, env);
  if (!fs.existsSync(dir)) {
    throw new ProfileError(
      `profile ${parsed.spec} does not exist. Create it first: agent-switch profile new ${parsed.spec}`,
      "PROFILE_MISSING"
    );
  }
  return {
    ...parsed,
    dir,
    env: profileEnv(parsed.tool, dir),
    envVar: PROFILE_TOOLS[parsed.tool].envVar,
  };
}

export function createProfile(spec, opts = {}) {
  const parsed = parseProfileSpec(spec);
  const env = opts.env || process.env;
  const dir = profileDir(parsed.tool, parsed.name, env);
  fs.mkdirSync(dir, { recursive: true });
  const metaPath = path.join(dir, ".agent-switch-profile.json");
  if (!fs.existsSync(metaPath)) {
    fs.writeFileSync(metaPath, JSON.stringify({
      tool: parsed.tool,
      name: parsed.name,
      createdAt: new Date().toISOString(),
      shared: Boolean(opts.shared),
    }, null, 2) + "\n");
  }
  const linked = opts.shared ? shareDefaults(parsed.tool, dir, env) : [];
  return { ...parsed, dir, env: profileEnv(parsed.tool, dir), linked };
}

export function listProfiles(tool = null, env = process.env) {
  const base = profileBase(env);
  const tools = tool ? [parseProfileSpec(`${tool}/default`).tool] : Object.keys(PROFILE_TOOLS);
  const rows = [];
  for (const t of tools) {
    const toolDir = path.join(base, t);
    if (!fs.existsSync(toolDir)) continue;
    for (const name of fs.readdirSync(toolDir)) {
      if (!NAME_RE.test(name)) continue;
      const dir = path.join(toolDir, name);
      if (fs.statSync(dir).isDirectory()) rows.push({ tool: t, name, spec: `${t}/${name}`, dir });
    }
  }
  rows.sort((a, b) => a.spec.localeCompare(b.spec));
  return rows;
}

export function deleteProfile(spec, opts = {}) {
  const parsed = parseProfileSpec(spec);
  const dir = profileDir(parsed.tool, parsed.name, opts.env || process.env);
  if (!opts.yes) {
    throw new ProfileError(`refusing to delete ${parsed.spec} without --yes`);
  }
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return { ...parsed, dir };
}

function shareDefaults(tool, targetDir, env = process.env) {
  const def = PROFILE_TOOLS[tool];
  const sourceHome = def.defaultHome(env);
  const linked = [];
  for (const rel of def.linkable) {
    const source = path.join(sourceHome, rel);
    const target = path.join(targetDir, rel);
    if (!fs.existsSync(source) || fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    linked.push({ name: rel, mode: linkOrCopy(source, target) });
  }
  return linked;
}

function linkOrCopy(source, target) {
  const stat = fs.statSync(source);
  try {
    if (stat.isDirectory()) {
      fs.symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
      return "linked";
    }
    fs.linkSync(source, target);
    return "linked";
  } catch {}
  try {
    fs.symlinkSync(source, target, stat.isDirectory() ? "dir" : "file");
    return "linked";
  } catch {}
  fs.cpSync(source, target, { recursive: true });
  return "copied";
}
