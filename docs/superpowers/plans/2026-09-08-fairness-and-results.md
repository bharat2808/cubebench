# CubeBench fairness and results implementation plan

1. Add regression tests proving active run/event views hide scrambles and terminal round views reveal them.
2. Add a regression test proving Live accepts more than 12 moves in one call, then remove the batch cap while retaining request and move-budget limits.
3. Make result filters optional at the browser API boundary and test aggregate retrieval.
4. Update Result Explorer loading/filter defaults and leaderboard defaults; handle nullable scrambles in replay.
5. Update protocol descriptions and generated schemas, then run focused tests, the full test suite, typecheck/build, and browser smoke verification.
