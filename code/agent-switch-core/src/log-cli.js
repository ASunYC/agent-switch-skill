import fs from "node:fs";
import path from "node:path";
import { legacyRoot } from "./paths.js";
import { listSessions, hasCapturedLogs, readEntryByIdMulti, rmSession, loadSession } from "./store.js";
import { renderExport } from "./export.js";

export function exportEntry(id, opts) {
  if (!id) {
    process.stderr.write("agent-switch export: missing entry id. Usage: agent-switch export <session>/<seq>\n");
    process.exit(1);
  }
  const rec = readEntryByIdMulti(opts.readRoots, id);
  if (!rec) {
    process.stderr.write(`agent-switch: no entry ${id}\n`);
    process.exit(1);
  }
  process.stdout.write(renderExport(rec, opts.format || "raw").body + "\n");
}

export function migrate(opts) {
  const cwd = process.cwd();
  const src = path.resolve(legacyRoot(cwd));
  const dest = path.resolve(opts.dir);

  if (!fs.existsSync(src)) {
    process.stderr.write(`agent-switch migrate: no ./.agent-switch in ${cwd}\n`);
    process.exit(1);
  }

  if (!hasCapturedLogs(src)) {
    process.stderr.write(`agent-switch migrate: no .json logs in ./.agent-switch (only empty session folders?)\n`);
    process.exit(1);
  }

  fs.mkdirSync(dest, { recursive: true });
  let files = 0;

  for (const session of listSessions(src)) {
    const srcDir = path.join(src, session);
    const destDir = path.join(dest, session);
    fs.mkdirSync(destDir, { recursive: true });
    for (const f of fs.readdirSync(srcDir)) {
      if (!f.endsWith(".json")) continue;
      const destFile = path.join(destDir, f);
      if (fs.existsSync(destFile)) continue;
      fs.copyFileSync(path.join(srcDir, f), destFile);
      files++;
    }
  }

  if (!files) {
    process.stderr.write(
      `agent-switch migrate: no new files to copy (dest already has every ./.agent-switch log from this project)\n` +
      `  dest: ${dest}\n`
    );
    process.exit(0);
  }

  process.stderr.write(
    `agent-switch migrate: copied ${files} file(s) from ./.agent-switch (${cwd}) ->${dest}\n` +
    `  (only logs under the current project's ./.agent-switch; other directories are untouched.)\n`
  );
}

// `agent-switch repack [session]` -force-migrate legacy records to v2 by reading them
// (reads auto-migrate in place). With no session, repacks every session.
export function repack(opts) {
  for (const root of opts.readRoots) {
    const sessions = listSessions(root);
    for (const s of sessions) {
      if (opts.session && s !== opts.session) continue;
      loadSession(root, s); // side effect: rewrites legacy files as v2
    }
  }
  process.stdout.write("agent-switch: repack complete\n");
}

// `agent-switch rm <session>` -delete a session across read roots and GC orphan blobs.
export function rmCmd(session, opts) {
  if (!session) {
    process.stderr.write("agent-switch rm: usage: agent-switch rm <session>\n");
    process.exit(1);
  }
  if (session !== path.basename(session) || session === "." || session === "..") {
    process.stderr.write(`agent-switch rm: invalid session: ${session}\n`);
    process.exit(1);
  }
  let removed = 0;
  for (const root of opts.readRoots) {
    if (fs.existsSync(path.join(root, session))) { rmSession(root, session); removed++; }
  }
  if (!removed) {
    process.stderr.write(`agent-switch rm: session not found: ${session}\n`);
    process.exit(1);
  }
  process.stdout.write(`agent-switch: removed ${session}\n`);
}
