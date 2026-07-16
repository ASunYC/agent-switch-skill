import test from "node:test";
import assert from "node:assert/strict";
import { upstreamRequestPath } from "../src/proxy.js";

test("upstream path prefixes a base API path", () => {
  assert.equal(
    upstreamRequestPath("https://api.example/v1", "/responses"),
    "/v1/responses"
  );
});

test("upstream path preserves an exact Azure Responses endpoint and query", () => {
  assert.equal(
    upstreamRequestPath(
      "https://resource.openai.azure.com/openai/deployments/work/responses?api-version=2025-04-01-preview",
      "/responses"
    ),
    "/openai/deployments/work/responses?api-version=2025-04-01-preview"
  );
});

test("upstream path does not duplicate an API prefix already sent by the client", () => {
  assert.equal(
    upstreamRequestPath("https://api.example/v1", "/v1/models?client=codex"),
    "/v1/models?client=codex"
  );
});

test("upstream path merges base and request query parameters", () => {
  assert.equal(
    upstreamRequestPath("https://api.example/gateway?api-version=1", "/messages?beta=true"),
    "/gateway/messages?api-version=1&beta=true"
  );
});
