# Hermes Local API

Hermes is a local Docker-hosted API service, not a spawned CLI.

## Default Endpoint

```text
http://127.0.0.1:8642
```

Known health endpoint:

```http
GET /health
```

Expected healthy response:

```json
{"status":"ok","platform":"hermes-agent"}
```

## Authorization Rule

Do not assume Hermes has an Authorization token configured.

When a Hermes call returns `401` and no saved config exists, ask the user for the required auth value. Save the answer for future Hermes calls in:

```text
~/.agent-switch/hermes.json
```

Use:

```json
{
  "baseUrl": "http://127.0.0.1:8642",
  "authHeader": "Authorization",
  "authValue": "Bearer <token>"
}
```

If the user gives only a raw token, store it as `Bearer <token>`. If the user gives a full header value beginning with `Bearer `, store it unchanged.

Treat `hermes.json` as sensitive local data. Do not print the saved token back to the user. If permissions can be set on the platform, restrict the file to the current user.

## Call Flow

1. Check `~/.agent-switch/hermes.json`.
2. If missing, call `/health` to confirm Hermes is running.
3. If an authenticated endpoint returns `401`, ask the user for the Authorization value.
4. Save the config.
5. Retry the Hermes request with the saved header.
6. If Hermes still returns `401`, ask the user to confirm or replace the saved auth value.

## Notes

- Do not reuse `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`, or unrelated provider credentials unless the user explicitly says Hermes uses them.
- If Hermes exposes OpenAI-compatible endpoints, prefer `/v1/models`, `/v1/chat/completions`, or `/v1/responses` according to the user's requested operation.
- If the endpoint shape is unknown, inspect health and model endpoints first, then ask the user before trying destructive or state-changing calls.
