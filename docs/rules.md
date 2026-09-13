# League rules and trusted-runner operation

Schema, prompt, and format are version 2.0.0. Engine, notation, and generator are version 1.0.0. SDK transport revision is independently negotiated. Official cube sizes are 2,3,4,5,6,7. The engine can represent larger NxN cubes through a configured maximum (default 20); the official API only accepts 2–7.

## Sprint

Start redeems an expiring one-use participant token, fixes the scramble and returns the canonical scrambled facelet state while withholding the generating sequence. The authoritative timer starts during that response. Make exactly one `cubebench_submit_solution` call with a full whitespace-separated algorithm. The service parses and validates the complete algorithm before modifying state. Invalid notation, oversized layers, a move-budget violation or an unsolved final state ends the attempt. There is no retry, intermediate execution, hint or reset. A read is available, consumes a call, and never pauses time. The run finishes only after deterministic final-state verification.

## Live

Start returns the same versioned state and budgets. Each `cubebench_apply_moves` accepts a non-empty sequence bounded by the request size and the attempt's remaining move budget. Moves are validated and executed in order, persisted and published individually. Valid moves preceding an invalid move remain accepted; the invalid move and remainder are rejected, and the run fails. When a move solves the cube, the run ends immediately and unused tail moves are recorded as unexecuted. Visual animation queues can lag behind authoritative execution without changing timing.

## Limits and failures

Defaults: 300,000 ms, 1,000 moves, 200 run calls. Match limits can be 1,000–3,600,000 ms, 1–10,000 moves, 2–2,000 calls. Official-compatible `extra_hard` is restricted to 3x3 Live matches: it uses a verified optimal-depth-20 fixture, a 1,800,000 ms timeout, a 20-move cap and 21 recorded calls (start plus 20 post-start interaction steps). Each Live call must contain exactly one move at this level. Start counts as call one. Authorized reads, wrong-league operations and malformed attributable run calls count. Invalid arguments without sufficient authentic run credentials cannot affect another run. Camera manipulation and spectator controls never count. A timeout sweep runs every 250 ms; every authorized run call also checks the monotonic deadline. Human time is personal practice time, never official benchmark time.

Failure categories: `solved`, `unsolved_submission`, `invalid_notation`, `illegal_move_for_cube_size`, `malformed_tool_arguments`, `move_limit_exceeded`, `tool_call_limit_exceeded`, `timeout`, `abandoned`, `disconnected`, `unauthorized`, `internal_server_error`. Unknown or unauthenticated calls return sanitized errors. Ended attempts cannot mutate immutable results. Interrupted active runs are failed as disconnected after restart because a monotonic timestamp cannot be reconstructed across process lifetimes.

## Round fairness

Match creation cryptographically seeds each round; a unique database index prevents seed reuse. The legal move generator is deterministic, not uniform over reachable states. Size, budgets, scramble and all domain versions are identical within the round. Participants cannot choose ranked seeds or request another scramble. Each entrant receives only the facelet state after starting. Public spectators see the round state only after all entrants start; the generating sequence is revealed after every entrant in that round finishes, and complete seed-bearing results are released only when the match completes. Round-one tickets expire one hour after creation. Later-trial tickets remain dormant until the previous round finishes, then have a one-hour eligible start window. Their initial returned expires_at is an outer scheduling bound that includes serial entrants and trial windows. The sweep closes abandoned schedules at that outer bound once active attempts finish.

A runner may start entrants concurrently with independent requests. `execution_order` supplies a cryptographically shuffled participant order per repeated trial for sequential harness orchestration. CubeBench does not manage harness processes or model scheduling. Complete the preceding round before starting the next. Warmups are explicitly practice and never enter either ranked or community benchmark projections.

## Identity, scoring and integrity

A community token can create only community/warmup matches. A trusted runner/admin token can create ranked matches; the same authenticated owner must start their entrants. A transferred participant token is not sufficient to elevate a community actor. Self-reported display name/provider/model/snapshot/harness/version/reasoning effort/system-prompt hash are retained without treating them as independently attested. No model-provider secret is requested. Observed MCP client identity is recorded when supplied by the SDK; stateless legacy HTTP has the documented identity limitation.

Solved attempts sort by monotonic elapsed time inside their league/size/trust class. Aggregate rows group exact runner and competitor metadata; completion rate sorts descending, then median successful duration ascending. Mean/min/max and all-failure null times are also reported. No result claims optimality. Human practice history is excluded from benchmark boards. Aggregation also binds the authenticated submitter identity, preventing another community identity from copying metadata to alter an existing aggregate.

Results are immutable database rows, signed over canonical JSON using the persistent Ed25519 key. Signatures bind all IDs, states, seed, versions, move attempts, call timeline, timings, metadata and a terminal event hash. Event records form a per-match SHA-256 chain. Verification proves integrity relative to the published public key, not physical control of a model. Protect and back up the signing key separately from publicly served assets.

Verified runner/admin calls may include `trusted_usage` on apply_moves or submit_solution: cumulative input_tokens, output_tokens and cost_usd. Later reports replace earlier totals, never sum them. Community reports are unauthorized and consume the run call without attaching cost. These are runner-supplied accounting values, not independently measured inference usage.
