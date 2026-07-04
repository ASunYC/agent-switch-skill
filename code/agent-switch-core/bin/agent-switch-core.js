#!/usr/bin/env node
import { main } from "../src/cli.js";

main(process.argv.slice(2)).then((code) => {
  if (typeof code === "number") process.exitCode = code;
}).catch((e) => {
  process.stderr.write(`agent-switch: ${e.stack || e.message}\n`);
  process.exit(1);
});
