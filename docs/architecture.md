# CubeBench — requirements and architecture v1

## Product and scope

A standalone, provider-neutral Rubik's Cube arena. External MCP harnesses own inference, credentials, prompts and tool execution. CubeBench never calls model APIs or accepts provider secrets. Support human practice and two strictly separate leagues: one-shot Sprint and interactive Live (12 moves per batch). Official ranking is verified monotonic wall-clock duration. Support sizes 2–7 with an NxN engine capped by configuration. No solver/code execution tool.

## Boundaries

- `packages/cube-core`: pure facelet engine, parser, normalization, inverses, seeded scrambles, state validation. No transport, persistence, React or Three dependencies.
- `packages/shared-contracts`: strict Zod schemas, types, versions and tool descriptors.
- `packages/persistence`: SQLite migrations, repositories and explicit atomic transactions. Persistence port isolates database dialect.
- `packages/benchmark-core`: authorization, match rounds, run transitions, budgets, monotonic clocks, signatures and statistics.
- `packages/realtime`: durable cursor-based browser SSE replay. Publication reads committed events.
- `packages/mcp-server`: SDK v2 factory, stdio gateway, authenticated Streamable HTTP, human/public HTTP routes, security and lifecycle.
- `packages/web`: Vite/React glass interface, queued Three.js renderer, human practice, arena/replay/results/settings.

## Decisions and trade-offs

1. Node 22+, npm workspace, strict TypeScript. Official MCP server/client/node SDK 2.0.0 supports 2026-07-28 through `createMcpHandler`/`serveStdio`; preserve supported legacy initialize clients. No deprecated HTTP+SSE MCP transport.
2. Single authoritative process owns monotonic timers. stdio is a gateway to the same service, preventing clock/database divergence. Restart terminates unfinished runs as disconnected; never reconstruct official elapsed time from wall clock. Horizontal benchmark execution needs explicit worker ownership before deployment.
3. SQLite WAL with immediate transactions and durable event outbox is simple to install. JSON aggregate records retain versioned detail; indexed projections serve leaderboards. Production adapter contract requires atomic aggregate/result/event/projection writes. PostgreSQL replacement is documented, not falsely claimed implemented.
4. Browser SSE uses cursor recovery and committed database rows. This is a spectator channel, separate from MCP transport. Withhold all round state and move events from spectators until all participants in that round have started or the match ends, preventing pre-start scramble leaks. Authorized participant receives their state immediately.
5. Locally provisioned scoped bearer tokens are random, hashed and expiring. Hosted OAuth resource-server mode validates issuer/audience/expiry/signature using configured JWKS, exposes protected-resource metadata, and maps trusted subjects to runner roles. No bundled authorization server. Hosted deployment requires TLS and an external OAuth issuer.
6. Participant start tokens have a one-hour eligible window (later trials remain dormant until the previous round completes), are hashed, single-use and bound to match/participant/round. Start exchanges them for an expiring hashed run token, carried explicitly with IDs. Ranked creation requires runner authority; self-reported community metadata cannot elevate identity.
7. Signed immutable results use Ed25519 and canonical JSON. Event hashes form a tamper-evident chain. Signed results bind final event hash, versions, states, seed, calls and attempts. No optimality claim.
8. Cube state uses six row-major faces ordered U,R,F,D,L,B with fixed color identities. Integer sticker coordinates and normals allow all NxN layer operations. Whole rotations do not affect solved detection. Human edits get structural/color validation; full general NxN reachability is explicitly unsupported.
9. Human history uses an anonymous HttpOnly session and local recovery; human results are always practice. Same-origin JSON mutation protection. No account/password management in MVP.
10. Design: warm off-white text on charcoal, mint accent, restrained translucent panels; responsive sidebar/top navigation, readable table cards, explicit cube moves, color labels, reduced motion and high contrast. Orbit/zoom are renderer-only; visual pause never affects official runs.

## Fairness and transitions

Fresh cryptographic seed per round, unique database constraint, reproducible seeded random legal move sequence (not uniform random state). Equal round scramble/limits/versions. Tokens for repeated trials issued once, rounds advance after previous round completion; execution order cryptographically shuffled. Concurrent clients can start independently. Start records authoritative monotonic time immediately before state delivery; stop after deterministic solve verification. Start counts as the first run call, every authorized run operation counts thereafter including reads and malformed calls. Exactly one Sprint submission terminates even on invalid notation/unsolved; Live accepts moves in order and stops at solved/budget/failure. Invalid argument envelopes attributable to an authorized run consume budget and terminally fail that attempt, preventing retries from being free. No reset tool; abandoning is irreversible for that attempt.

## Acceptance coverage

Standalone install/migrate/dev/build; SDK clients complete both leagues over both transports; identical hidden round scramble, unique fresh rounds; 2–7 engine invariants and random properties; immutable signed exports JSON/CSV; explicit roles and separate leaderboards; persisted/recovered spectator events; keyboard/touch/mobile/reduced-motion/high-contrast human and replay flows; formatting, ESLint, typecheck, Vitest, Playwright, MCP Inspector and production build all pass before completion.

## Primary references (checked 2026-09-08)

- https://modelcontextprotocol.io/specification/2026-07-28
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html
- https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html
- https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients.html
- https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions.html
  Registry confirmed @modelcontextprotocol/{server,client,node} 2.0.0. Harness compatibility is evidence-based, not inferred from brand names.

## Review decisions implemented

- Signed submitter identity separates community aggregates even when metadata is copied.
- Deadline checked and frozen at verification, including Live final moves.
- All eligible history participates in aggregation; all interrupted runs are recovered.
- Later-round tickets have eligibility-relative expiry; local access credentials can be renewed with stable identity.
- Inspector portability normalization preserves JSON Schema semantics while avoiding bare false tuple-items and multi-type arrays.
- Browser typography minimum12px; graphics lazy-loaded with accessible WebGL fallback.
