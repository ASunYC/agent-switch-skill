import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PI_PROVIDERS = {
  anthropic: { format: "anthropic", upstream: "https://api.anthropic.com" },
  openai: { format: "openai", upstream: "https://api.openai.com/v1" },
};

function optionValues(args, flag) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1]) values.push(args[++i]);
    else if (args[i].startsWith(`${flag}=`)) values.push(args[i].slice(flag.length + 1));
  }
  return values;
}

export function preparePi(args, requestedProvider, env = process.env) {
  const named = optionValues(args, "--provider");
  // A provider-qualified model is enough to choose the capture route.
  const qualifiedModels = optionValues(args, "--model")
    .filter((value) => value.includes("/"))
    .map((value) => value.split("/")[0]);
  const chosen = [requestedProvider, ...named, ...qualifiedModels].filter(Boolean);
  const provider = chosen[0] || "anthropic";
  if (!PI_PROVIDERS[provider]) {
    throw new Error(`unsupported Pi provider "${provider}". Capture currently supports: ${Object.keys(PI_PROVIDERS).join(", ")}.`);
  }
  if (chosen.some((value) => value !== provider)) {
    throw new Error("conflicting Pi providers in --pi-provider, --provider, or --model. Select one provider for this capture run.");
  }
  return {
    provider,
    format: PI_PROVIDERS[provider].format,
    upstream: piConfiguredUpstream(provider, env) || PI_PROVIDERS[provider].upstream,
    args: named.length || qualifiedModels.length ? args : ["--provider", provider, ...args],
  };
}

export function piConfiguredUpstream(provider, env = process.env) {
  const home = env.PI_CODING_AGENT_DIR || path.join(env.USERPROFILE || env.HOME || os.homedir(), ".pi", "agent");
  try {
    const config = JSON.parse(fs.readFileSync(path.join(home, "models.json"), "utf8"));
    return config?.providers?.[provider]?.baseUrl || null;
  } catch {
    return null;
  }
}
