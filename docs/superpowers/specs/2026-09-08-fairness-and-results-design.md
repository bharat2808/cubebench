# CubeBench fairness and results design

## Goal

Prevent participants from recovering the solution by inverting a disclosed scramble, let Live League accept any batch that fits the configured attempt budget, and make existing results discoverable without guessing a populated filter combination.

## Protocol

- A started run returns the scrambled facelet state, but `run.scramble` is `null` until every entrant in that round has finished.
- Active events and match/run views follow the same rule. Once a round finishes, `scramble_revealed` events publish each run with its scramble. Signed terminal result records continue to contain seed and scramble for reproducibility.
- Live move batches have no arbitrary 12-move batch cap. Parsing and application remain sequential, stop at solved/invalid/expired/budget-exhausted, and report unconsumed tokens as rejected.
- Request strings remain bounded for resource safety; the authoritative move cap remains `limits.moves` (maximum 10,000).

## Results experience

- The public results endpoint accepts optional league, class, and size filters.
- Result Explorer defaults to all sizes and both result classes for its selected league, with explicit filters available.
- Loading is distinct from a genuinely empty result set.
- Leaderboards remain comparable within one league/size/class bucket, but Community defaults to the populated Live bucket while Verified defaults to Sprint.

## Compatibility

Making `run.scramble` nullable is a breaking public schema change, so schema/prompt/format versions move to 2.0.0. Historical signed result records remain valid because their embedded version values and immutable payloads are unchanged.
