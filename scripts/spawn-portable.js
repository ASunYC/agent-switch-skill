import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function quoteCmdArg(arg) {
  const value = String(arg);
  if (!value) return '""';
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/g, "$&$&")}"`;
}

function resolveWindowsCommand(command, env) {
  if (/[\\/]/.test(command)) return command;
  for (const dir of String(env.PATH || env.Path || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    if (fs.existsSync(candidate)) return candidate;
  }
  return command;
}

export function spawnPortable(command, args, options = {}) {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) {
    return spawnSync(command, args, options);
  }
  const env = options.env || process.env;
  const comspec = env.ComSpec || env.COMSPEC || "cmd.exe";
  const commandLine = ["call", quoteCmdArg(resolveWindowsCommand(command, env)), ...args.map(quoteCmdArg)].join(" ");
  return spawnSync(comspec, ["/d", "/c", commandLine], {
    ...options,
    windowsVerbatimArguments: true,
  });
}
