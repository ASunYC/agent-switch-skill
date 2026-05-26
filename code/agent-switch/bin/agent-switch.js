#!/usr/bin/env node
import { main } from "../src/agent-switch.js";

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`agent-switch: ${error.stack || error.message}\n`);
  process.exit(1);
});
