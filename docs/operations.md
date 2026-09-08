# Operations, deployment and troubleshooting

## Supported topology

Run one authoritative Node.js service per SQLite database on a persistent local disk. The stdio processes are gateways to that service, not independent benchmark engines. SQLite uses WAL, a 5-second busy timeout and `BEGIN IMMEDIATE` transactions. A mutation commits aggregate state, accepted/rejected attempt evidence, durable events and terminal signed result together. SSE only polls committed events. Active runs fail as disconnected after a process restart; they never silently resume with a different monotonic clock.

The `Repository` port isolates persistence from protocol and UI. Its current implementation is SQLite. A PostgreSQL/multi-worker deployment requires a new asynchronous transaction adapter and explicit worker ownership of each monotonic run timer; that topology is not implemented or claimed tested. Use operator provisioned identities and a single service for this MVP.

## Install, migrate and build

```sh
npm ci
npm run db:migrate
npm run build
npm start
```

`db:migrate` is idempotent. Migration history is stored in `migrations`. Repository construction also applies pending migrations, so a fresh development service works after install. Schema migration code is in `packages/persistence/src/index.ts`. Indexes support match lookup, result filtering, event replay, owners and globally unique scramble seeds. Database triggers disallow changes/deletion of signed results and committed events. Do not manually edit or reset production records.

For development run `npm run dev`; Vite is mounted inside the service, so UI, cookie sessions and SSE share the same origin. Bind defaults to `127.0.0.1:4310`. `.env.example` documents configuration; the application reads exported process environment, not `.env` automatically. If using a local `.env`, export it explicitly using your shell before starting. Never commit it.

## Hosted service

1. Build on the server or ship built `dist/` plus package manifests/lockfile. Install runtime dependencies with `npm ci --omit=dev` after the build. Keep the working directory at this project root.
2. Mount a persistent private directory for the database and Ed25519 private key. Restrict it to the service user; preserve the same signing key across restarts.
3. Terminate TLS with your reverse proxy, proxy to the loopback service, preserve the public Host header, disable response buffering for `/api/matches/*/stream`, and allow long-lived SSE. Keep the backend inaccessible from the public network.
4. Set `NODE_ENV=production`, a HTTPS `CUBEBENCH_PUBLIC_URL`, exact allowed hosts/origins, and your external OAuth issuer/JWKS. OAuth access tokens must have the MCP resource URL as their audience and `cubebench:compete` scope. Trusted ranked subjects also need `cubebench:run-ranked` and an operator allowlist entry.
5. Start through a process supervisor with graceful SIGTERM and restart on failure. Run only one benchmark authority against the database. Verify `/api/config`, unauthorized `/mcp` returns 401 with discovery metadata, and a scoped client can discover tools.
6. Back up the database with SQLite's backup mechanism (or stop the service before copying database plus WAL consistently), and back up the private key securely. Test restore in an isolated database/port; never point a test service at the live database.

Production mode enforces HTTPS configuration and adds HSTS/CSP/no-store policies. OAuth authorization-server registration/consent flows belong to the configured issuer; CubeBench is the resource server. No live external OAuth provider was configured during local verification; JWT verifier tests use locally signed fixtures.

## Environment variables

| Variable                    | Default                   | Meaning                                                       |
| --------------------------- | ------------------------- | ------------------------------------------------------------- |
| `PORT`                      | `4310`                    | Authoritative HTTP listening port                             |
| `HOST`                      | `127.0.0.1`               | Listening interface; keep loopback behind proxy               |
| `NODE_ENV`                  | unset                     | `production` enables hosted TLS/security requirements         |
| `CUBEBENCH_DB`              | `.data/cubebench.sqlite`  | Persistent SQLite path, relative to process cwd               |
| `CUBEBENCH_SIGNING_KEY`     | `.data/signing-key.pem`   | Private Ed25519 PEM; created mode0600 on first start          |
| `CUBEBENCH_PUBLIC_URL`      | `http://127.0.0.1:4310`   | Public base URL without `/mcp`; required explicitly for OAuth |
| `CUBEBENCH_ALLOWED_HOSTS`   | localhost,127.0.0.1,[::1] | Comma-separated exact hostnames, no scheme/port               |
| `CUBEBENCH_ALLOWED_ORIGINS` | own/public origin         | Comma-separated exact browser origins                         |
| `CUBEBENCH_OAUTH_ISSUER`    | unset                     | External issuer; set with JWKS URL                            |
| `CUBEBENCH_OAUTH_JWKS`      | unset                     | HTTPS verification key-set endpoint in production             |
| `CUBEBENCH_TRUSTED_RUNNERS` | unset                     | Comma-separated trusted OAuth subject identifiers             |
| `CUBEBENCH_URL`             | `http://127.0.0.1:4310`   | stdio gateway's authoritative service base URL                |
| `CUBEBENCH_TOKEN`           | required for stdio        | CubeBench access credential only                              |
| `PLAYWRIGHT_BROWSERS_PATH`  | Playwright default        | `.cache/playwright` keeps browser binaries inside project     |

HTTP request limits are 128 KiB JSON, 600 requests/minute per socket IP, 32 concurrent requests per IP, including spectator streams. They are injectable in `SecurityOptions` for tests/embedding. Behind a single reverse proxy these per-IP limits deliberately apply to the proxy connection rather than trusting spoofable forwarded headers; configure upstream per-user/IP admission for a larger deployment. Official cube sizes are fixed to2–7; engine callers can configure `createSolved(size,maximumSize)`.

## Privacy and retention

CubeBench stores public competitor metadata, benchmark evidence, anonymous human history, hashed access credentials and audit records. No emails/passwords/provider credentials are requested. Public results include declared model/harness metadata and pseudonymous submitter/runner IDs; choose private match visibility for restricted results. Privacy erasure/retention tooling is an operator follow-up; records are retained locally until an operator performs an explicit archival migration. Signed result/event immutability is deliberate. Browser users can clear their anonymous cookie to begin a separate practice identity; this does not delete old database records.

## Troubleshooting

- **stdio exits immediately:** run the authority first, set CUBEBENCH_TOKEN and CUBEBENCH_URL, and use an absolute built entry path. Keep stdout reserved for JSON-RPC; launch through Node directly rather than an npm script that emits banners.
- **401:** provision a fresh scoped CubeBench token, or verify OAuth signature/issuer/audience/expiry/scope. Model API keys are not valid here.
- **403 Host/Origin:** configure exact public host/origin on hosted deployments. Do not disable the guard. Browser write requests need same-origin plus `X-CubeBench: 1`.
- **404 for a match/run/export:** it may be private, hidden behind the round reveal barrier, or not owned by this session. Complete the match before exporting seeds and signed results.
- **Waiting spectators:** all entrants must start before the round becomes public. A participant's authorized run response is immediate. This is a fairness barrier.
- **Expired participant:** start inside that round's eligible one-hour window. Earlier rounds must finish before later trials activate. Already used tokens cannot reset an attempt.
- **429:** reduce request frequency/concurrent streams and obey Retry-After. Spectators should use SSE instead of repeated full snapshots.
- **SQLite busy or strange run interruption:** ensure only one authoritative process uses that database. Gateways must connect over HTTP.
- **WebGL unavailable:** use the accessible face buttons and canonical textual/net state; a renderer fallback leaves the human controls usable. Ensure hardware/browser WebGL support for the 3D view.
- **Missing Playwright browser:** `PLAYWRIGHT_BROWSERS_PATH=.cache/playwright npx playwright install chromium`, then run tests with that same environment.
- **Signing key changed:** previous signatures require the previous trusted public key. Restore the original key; never rewrite old results with a new signature.
