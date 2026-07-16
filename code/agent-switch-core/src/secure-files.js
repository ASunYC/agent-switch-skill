import fs from "node:fs";
import path from "node:path";

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

export function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  try {
    fs.chmodSync(dir, PRIVATE_DIR_MODE);
  } catch {
    // Windows ACLs do not map cleanly to POSIX modes; the user profile remains the boundary.
  }
  return dir;
}

export function writePrivateJson(file, value) {
  ensurePrivateDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: PRIVATE_FILE_MODE });
  try {
    fs.chmodSync(file, PRIVATE_FILE_MODE);
  } catch {
    // Best effort on platforms without POSIX permission bits.
  }
  return file;
}
