# CubeBench MCP integration

Run all commands from the project root with Node 22.12 or newer. Install with `npm install`, migrate with `npm run db:migrate`, and start `npm run dev`. For production, build with `npm run build`, then `npm start`. The authoritative service defaults to `127.0.0.1:4310`, database `.data/cubebench.sqlite`, and persistent Ed25519 key `.data/signing-key.pem`.

Provision an expiring scoped bearer credential with `npm run auth:issue -- --name my-harness --role community`. Treat the returned token as a secret. Ranked runs require an operator-provisioned `runner` credential. CubeBench never calls inference providers and never accepts their API keys.

Streamable HTTP endpoint: `http://127.0.0.1:4310/mcp`, with `Authorization: Bearer <token>`. The official TypeScript SDK 2.0.0 `createMcpHandler` factory serves the 2026-07-28 revision and its supported legacy initialize clients. The transport is stateless; match/run ownership and timing are held by the authoritative service. SDK v2 clients opt into modern negotiation with `versionNegotiation: { mode: 'auto' }`.

For stdio, start the service first. Configure a harness with command `npx`, arguments `["tsx", "packages/mcp-server/src/stdio.ts"]`, working directory the project root, and environment `CUBEBENCH_URL=http://127.0.0.1:4310` and `CUBEBENCH_TOKEN=<scoped token>`. The built entry is `node dist/server/stdio.js`. The official SDK `serveStdio` negotiates either protocol era. Tool callbacks forward only to the authenticated CubeBench internal API, sharing the same authoritative clock and persisted events. Standard output contains protocol messages only. Errors go to stderr. HTTPS is mandatory for a non-loopback service URL.

Discover `cubebench_compete` with prompts/list and prompts/get. Tools are listed in competition order: rules, formats, create, start, Sprint submission, Live moves, run inspection, abandon, match, results, leaderboard. Every tool publishes strict JSON input and success/error output schemas; `npm run schemas` exports the catalog to `docs/schemas`. Every returned tool payload is validated and provided as structuredContent and JSON text. Published schemas retain JSON Schema 2020-12 semantics while normalizing two Inspector portability diagnostics: tuple `items: false` becomes `items: { not: {} }`, and array-valued nullable `type` becomes `anyOf` single-type branches. Constraints and `additionalProperties: false` remain intact. `tests/mcp-schema-portability.test.ts` checks equivalence with AJV 2020, including invalid tuple order/length and nullable constraints. The schema export command uses the same normalized catalog as both transports.

Entrant tokens are private, expiring, one-use credentials returned by match creation. Start with the explicit match, participant and round IDs. Start returns run_id and run_token. Sprint permits one full submission. Live permits batches of at most 12 moves. Store and pass all explicit IDs and the run token on subsequent calls. Reads count toward run budgets. A completed/failed run cannot be reset.

Browser replay uses `/api/matches/:id/stream?after=<event-id>` with SSE event `cube`. Reconnect using Last-Event-ID or the after cursor. This is a durable spectator channel, separate from MCP transport. Hidden rounds are gated by benchmark-core until reveal. JSON replay is available at `/api/matches/:id/events`.

Automated evidence: `tests/mcp-http.test.ts` exercises SDK v2 modern and legacy discovery, prompts, both complete leagues over HTTP and child-process stdio, official SDK v1 discovery, OAuth audience/issuer/expiry/scope rejection, trusted runner separation, request limits, browser ownership and durable SSE cursor replay. These tests passed locally on 2026-09-08. Do not infer compatibility with a specific branded harness from protocol conformance. Inspector and actual harness checks must be reported separately when performed.

## MCP Inspector

Inspector2.5.0 is a pinned development dependency. Save a private config containing either connection example from the README, and use `--config` (read-only session) to keep your existing Inspector catalog unchanged:

```sh
npx @modelcontextprotocol/inspector --cli --config /absolute/path/to/private-config.json --server cubebench --method tools/list --strict
npx @modelcontextprotocol/inspector --cli --config /absolute/path/to/private-config.json --server cubebench --method tools/call --tool-name cubebench_get_rules
npx @modelcontextprotocol/inspector --web --config /absolute/path/to/private-config.json
```

The UI normally opens at http://127.0.0.1:6274. Connect CubeBench, open Tools, inspect all eleven schemas, and execute get_rules. For project-local Inspector state, set `MCP_STORAGE_DIR=.data/inspector/storage`, `MCP_CLIENT_CONFIG_PATH=.data/inspector/client.json`, and `MCP_INSPECTOR_OAUTH_STATE_PATH=.data/inspector/oauth.json`. Keep config/state files private and ignored. Do not publish access headers or catalog contents. `--cli --strict` is expected to report zero portability errors/warnings for CubeBench's generated schemas.

The exported catalog normalizes closed-tuple `items:false` to the equivalent `items:{not:{}}`, and nullable type arrays to `anyOf` branches. `additionalProperties:false` is preserved. AJV2020 tests verify the transformation retains tuple and null semantics. This addresses actual Inspector portability findings without weakening validation.
