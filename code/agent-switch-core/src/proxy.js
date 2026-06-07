// Reverse proxy: Claude Code talks plain HTTP to this server (via
// ANTHROPIC_BASE_URL), we capture the full request + streamed response and
// forward to the real Anthropic API over HTTPS. No TLS interception needed.

import http from "node:http";
import https from "node:https";
import { compactAnthropicBody, normalizeCompactOptions } from "./compact.js";

export function createProxy({ upstream, store, compact }) {
  const up = new URL(upstream);
  const client = up.protocol === "http:" ? http : https;
  const compactOpts = normalizeCompactOptions(compact);

  return http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const bodyBuf = Buffer.concat(chunks);
      let body;
      try {
        body = JSON.parse(bodyBuf.toString("utf8"));
      } catch {
        body = bodyBuf.length ? bodyBuf.toString("utf8") : null;
      }

      const rec = store.add({
        request: {
          method: req.method,
          url: req.url,
          headers: { ...req.headers },
          body,
        },
      });

      let outboundBody = body;
      let outboundBuf = bodyBuf;
      let compression = compactOpts.enabled
        ? { enabled: true, engine: compactOpts.engine, baseUrl: compactOpts.baseUrl, compressed: false }
        : null;
      try {
        if (compactOpts.enabled && req.method === "POST" && body && typeof body === "object" && !Array.isArray(body)) {
          const result = await compactAnthropicBody(body, compactOpts);
          outboundBody = result.body;
          compression = result.meta;
          outboundBuf = compression.compressed ? Buffer.from(JSON.stringify(outboundBody)) : bodyBuf;
          rec.forwarded = {
            method: req.method,
            url: req.url,
            headers: { ...req.headers },
            body: outboundBody,
          };
          rec.compression = compression;
          store.update(rec);
        } else if (compactOpts.enabled) {
          compression = {
            ...compression,
            error: "request is not a JSON POST body",
            failedOpen: compactOpts.fail === "open",
          };
          rec.compression = compression;
          store.update(rec);
        }
      } catch (e) {
        rec.compression = {
          ...compression,
          error: e.message,
          failedOpen: false,
        };
        store.update(rec);
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        return res.end(`agent-switch: compact failed: ${e.message}`);
      }

      // Forward upstream. Strip accept-encoding so the captured response is
      // plain text (no gzip/br to decode) -Claude Code handles uncompressed fine.
      const headers = { ...req.headers, host: up.host };
      delete headers["accept-encoding"];
      if (compactOpts.enabled && outboundBuf !== bodyBuf) {
        headers["content-length"] = String(outboundBuf.length);
      }

      const proxyReq = client.request(
        {
          protocol: up.protocol,
          hostname: up.hostname,
          port: up.port || (up.protocol === "http:" ? 80 : 443),
          path: (up.pathname === "/" ? "" : up.pathname) + req.url,
          method: req.method,
          headers,
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          const respChunks = [];
          proxyRes.on("data", (c) => {
            respChunks.push(c);
            res.write(c);
          });
          proxyRes.on("end", () => {
            res.end();
            rec.response = {
              status: proxyRes.statusCode,
              headers: proxyRes.headers,
              raw: Buffer.concat(respChunks).toString("utf8"),
              finishedAt: Date.now(),
            };
            store.update(rec);
          });
        }
      );

      proxyReq.on("error", (e) => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        res.end(`agent-switch: upstream error: ${e.message}`);
        rec.response = { error: e.message, finishedAt: Date.now() };
        store.update(rec);
      });

      proxyReq.end(outboundBuf);
    });
  });
}
