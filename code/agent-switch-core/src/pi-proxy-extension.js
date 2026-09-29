// Loaded by Pi with -e for this process only; no changes to models.json.
export default function registerCaptureProxy(pi) {
  const provider = process.env.AGENT_SWITCH_PI_PROVIDER;
  const baseUrl = process.env.AGENT_SWITCH_PI_PROXY_URL;
  if (!provider || !baseUrl) throw new Error("agent-switch: Pi capture extension is missing proxy configuration");
  pi.registerProvider(provider, { baseUrl });
}
