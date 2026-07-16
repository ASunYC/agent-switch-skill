import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as hermes from "../src/hermes.js";

test("Hermes health can replace an invalid saved authorization in a TTY", () => {
  const error = new hermes.HermesAuthError("expired");

  assert.equal(typeof hermes.shouldPromptForAuth, "function");
  assert.equal(hermes.shouldPromptForAuth(error, true), true);
  assert.equal(hermes.shouldPromptForAuth(error, false), false);
});

test("Hermes auth loader accepts UTF-8 BOM config files", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switch-hermes-bom-"));
  const expected = {
    baseUrl: "http://127.0.0.1:8642",
    authHeader: "Authorization",
    authValue: "Bearer test-token",
  };
  fs.writeFileSync(path.join(home, "hermes.json"), `\uFEFF${JSON.stringify(expected)}`, "utf8");

  assert.deepEqual(hermes.loadHermesAuth({ AGENT_SWITCH_PROFILE_HOME: home }), expected);
});
