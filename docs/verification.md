# Verification evidence

Environment: macOS arm64, Node 22.23.2, npm 10.9.8. Work is isolated to this project. No sibling storefront code/assets changed. All browser installs, fixture databases, Inspector credentials and logs are project-local and ignored.

## Automated gates

Final clean-install verification on 2026-09-08:

| Command                                                       | Result                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `npm ci`                                                      | Clean lockfile install passed (461 packages)                          |
| `npm run db:migrate`                                          | Migration 1 applied successfully; repeated construction is idempotent |
| `npm run format:check`                                        | All matched files use Prettier style                                  |
| `npm run lint`                                                | Exit 0                                                                |
| `npm run typecheck`                                           | Strict TypeScript exit 0                                              |
| `npm test`                                                    | 73 tests across 8 files passed                                        |
| `PLAYWRIGHT_BROWSERS_PATH=.cache/playwright npm run test:e2e` | 15 browser tests passed                                               |
| `npm run build`                                               | Vite client + Node ESM service/stdio built                            |
| `npm audit`                                                   | 0 vulnerabilities after pinning esbuild override ^0.28.2              |

The large graphics chunk is a nonblocking Vite warning: the Three/R3F renderer is lazy-loaded (~902 KB raw/~240 KB gzip); initial application JS is ~238 KB raw/~75 KB gzip. Installed Three/R3F emits an upstream THREE.Clock deprecation warning in development; behavior passes browser tests. These are visible warnings, not hidden failing commands.

Coverage includes 2–7 cube properties and known conventional mappings; exact-inverse scramble behavior; schema rejection; all league transitions and budgets; hidden/repeated round seeds; immutable results/signatures/hash chain; actor isolation; private/public eligibility; real 10,001-record restart recovery; credential renewal; OAuth scope/audience/issuer/expiry; HTTP Host/Origin/rate/body limits; SSE backpressure; official modern/legacy protocol clients; and strict portable schemas.

Browser coverage includes real HTTP MCP→authority→SSE→rendered Sprint/Live solves and reload recovery; mocked delayed/reconnected event playback; visual pause/seek; human scramble/custom/seed/undo/redo/reset/save and independent scramble preview; live timers, tool counts and standings; keyboard; 320px layout; 12px minimum typography; reduced motion; normal/high-contrast axe audits; orbit drag does not turn; and unavailable WebGL fallback.

## Inspector manual verification

Inspector 2.5.0 connected over authenticated Streamable HTTP, displaying negotiated MCP 2025-11-25. All eleven tools were visible in deterministic order, without schema-warning badges after normalization. Manually executed cubebench_get_rules; Inspector showed TOOLS/CALL OK and Structured Output.

CLI checks against the built service and built stdio gateway succeeded with `tools/list --strict` and `tools/call --tool-name cubebench_get_rules`. Both returned structured JSON; strict discovery produced no portability errors or warnings. Private transcripts remain under `.data/inspector/`, excluded from distributable artifacts. No branded harness compatibility is claimed beyond the matrix.

## Known limitations and operating boundaries

- Single authoritative process and SQLite local disk; no horizontal timer ownership or PostgreSQL adapter implementation. The persistence interface and transaction boundary isolate future work.
- External OAuth issuer interactive registration/consent, TLS reverse-proxy hosting and real branded agent harnesses were not tested against live services. Local JWT fixtures and protocol clients were tested.
- General nonsolved NxN physical reachability is not proven. The engine reports structural/color validation and explicitly unchecked reachability. Official input comes from legal scrambles/moves.
- Seeded random legal scrambles are not uniformly sampled states. No solution optimality claims.
- Generic notation normalization handles grammar aliases; it does not minimize whole algorithms or canonicalize all opposite-face descriptions.
- Human identities are anonymous browser sessions; no account sync, retention UI, passkeys or recovery flow. Signed benchmark records are deliberately immutable.
- Public arena lists the newest 100 matches and personal history the newest 100 solves; full completed match export and leaderboard statistics retain their underlying evidence. Larger deployments need paginated browse/history UI and a compact preaggregated leaderboard cache.
- Model identity/usage is asserted by the authenticated runner, never independently proven by MCP. Community entries are explicitly unverified and isolated by authenticated submitter.

## Three next improvements

1. Add leased benchmark worker ownership and PostgreSQL transactions, with compact leaderboard projections and load tests.
2. Test real harness configurations and a hosted OAuth issuer end-to-end, and publish signed compatibility fixtures.
3. Add durable human accounts/history pagination and optimize the graphics bundle for slower devices.
