# CubeBench implementation plan

Spec: `docs/architecture.md`. All changes remain inside this project. No provider integrations or secrets. Execute continuously using tests and independent package ownership; user has authorized routine choices.

1. **Foundation and contracts** — npm workspace, strict compiler, lint/format/test/build scripts; shared schemas for state, run, match, metadata, events and eleven tools. Acceptance: all schemas reject extra properties, fixed catalog order, outputs cover every result branch. Interfaces: `CubeState`, `Move`, `createSolved`, `parseMoves`, `applyMoves`, `invertMoves`, `generateScramble`, `isSolved`; benchmark `execute(name,args,actor)` returns schema-checked object.
2. **Pure cube engine** — write failing Vitest tests before implementation. Represent every sticker by integer position/normal mapping; map legal layer turns to permutations. Tests: all 2–7 sizes, face/wide/indexed/inner/slices/rotations, inverses, fourth powers, seeded scramble inverse, serial round trip, invalid notation and random properties. Document grammar and limits. Acceptance: real known face mappings plus algebra invariants, not merely self-consistent inverse bugs.
3. **Persistence and benchmark** — migrations for identities/tokens/matches/rounds/runs/results/events/formats/history/audit/projections. Atomic mutation+event+result boundary. Write fake-monotonic-clock tests first for concurrent entrants, hidden scramble, Sprint single submission, Live order, limits, wrong league, token ownership/replay, restart, signed results, separate leaderboard and repeated statistics. Acceptance: no unauthorized read or mutation, no async gap inside a run transition; immutable results and events replay final state.
4. **MCP and HTTP** — SDK v2 factory with strict schemas/prompt. Modern HTTP and legacy SDK compatibility, stdio gateway to same authority. Auth/JWKS, host/origin, body/rate/concurrency limits, public sanitized arena and browser session APIs. Acceptance: official SDK clients discover/call/finish Sprint and Live on HTTP and stdio; missing/invalid credentials fail; errors sanitized; stdout only protocol. Inspector manual tool discovery/rules/call.
5. **Web and renderer** — isolated React modules, responsive glass CSS, accessible 3D facelets with queued slice turns and orbit/zoom. Human deterministic/random/custom scrambles, undo/redo, explicit reset choice, timer, history/PBs; arena/create/live/replay/results/guide/settings. Shared event cursor recovers after reconnect, pause/seek only renderer. Acceptance: Playwright complete human flow and mocked agent matches, keyboard/320px/reduced motion/high contrast, visible error/empty/loading states.
6. **Delivery and review** — documentation for setup/deploy/env/migrate/MCP/rules/trust/notation/security/troubleshoot/export/compatibility; generate tool JSON schemas from source; reviewed acceptance map and commands with actual outputs. Run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`, Inspector CLI and UI. Resolve failures, then independent review for load-bearing security/fairness defects. No completion claim while checks fail.

## Progress ledger

- Preflight: new isolated directory; parent ChatGPT-specific instructions superseded by explicit standalone brief. Architecture and SDK research completed before implementation.
- Interface review: cube engine consumed by benchmark and web; shared contract schema is the integration authority. Persistence only consumed by service. SSE public view must enforce round-start reveal barrier.

## Execution ledger

- Foundation/contracts: implemented; strict schemas exported, SDK documentation verified.
- Pure cube engine: implemented; 21 property/conventional mapping tests pass.
- Persistence/benchmark: implemented; 32 domain/persistence tests pass, signatures and review regressions included.
- MCP/HTTP/SSE: implemented; 20 protocol/security/schema/backpressure tests pass, Inspector strict+manual UI verified.
- Web: implemented; all 15 browser tests pass, including real MCP→SSE matches, scramble preview, live standings and accessibility.
- Review fixes: no prefiltered leaderboard cap, stable submitter identity, deadline-at-verification, all-row restart recovery, dormant later-round tickets, portable schemas, hardened Host, bounded SSE buffers.
- Final gates: clean npm ci, schema generation, formatting, lint, strict type checking, 73 unit/integration/protocol tests, 15 browser tests and production build passed. Dependency audit: zero vulnerabilities. Inspector CLI and manual UI passed.
