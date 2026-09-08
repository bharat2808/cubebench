# Cube notation and state format — v1.0.0

The engine uses fixed color identities U=white, R=red, F=green, D=yellow, L=orange, B=blue. These are identifiers, not current world positions after rotations. Face arrays are ordered U,R,F,D,L,B, and each face is row-major when looking directly at that face from outside. Geometry uses x=right, y=up, z=front, with integer sticker positions from 0 through N−1 and signed unit normals. In particular U's first row is adjacent to B, and D's first row is adjacent to F. R's first column is adjacent to F, and B's first column is adjacent to R.

Moves are separated by whitespace. The parser accepts an empty algorithm. Parentheses, comments, commutators and concatenated unseparated moves are not supported.

| Form        | Meaning                                                   |
| ----------- | --------------------------------------------------------- |
| R L U D F B | One clockwise quarter turn, looking directly at that face |
| R' / R2     | Counterclockwise quarter / half turn                      |
| Rw / 3Rw    | First two / first three layers measured from R            |
| r / u       | Lowercase aliases for Rw / Uw                             |
| 2R          | Only the second layer measured from R                     |
| 2-3Rw       | Inclusive second through third layers measured from R     |
| x y z       | Whole cube rotations in the R, U, F directions            |
| M E S       | Odd sizes only: central layer in the L, D, F direction    |

Every form accepts a prime or 2 suffix, including slices and rotations. A layer index must be between 1 and N. A wide move without a range must have at least two layers. Ranges must be ascending; a singleton range normalizes to an indexed move. M/E/S are rejected on even sizes because there is no single center layer: use indexed moves or ranges explicitly. On a 5×5, M normalizes to 3L, E to 3D, and S to 3F.

Normalization removes redundant leading zeros and the outer-layer index 1, uses uppercase face letters, omits the default width 2 on wide moves, and preserves explicit rotations. It does not combine adjacent moves or rewrite arbitrary equivalent algorithms. The grammar's forms identify the same layer operation canonically; different descriptions from opposite faces are not algebraically canonicalized. `serializeMoves(invertMoves(parseMoves(sequence, N)))` produces the inverse algorithm in reverse order.

A parsed Move carries its normalized notation, original face direction, selected coordinate layers, axis (0=x, 1=y, 2=z), turn count (1/2/3), and signed right-handed quarterTurns. R/U/F and x/y/z have negative signed turns; L/D/B have positive signed turns. For example R on size N selects coordinate layer N−1 on axis 0 and has quarterTurns −1. The engine checks Move objects against their notation before applying them and never mutates input state or moves.

`createSolved(N)` defaults to a maximum size of 20; `createSolved(N, configuredMaximum)` permits another configured maximum. Official competition sizes are 2–7. Engine operations on existing states accept their size; API boundaries must enforce their configured maximum before accepting untrusted states. Work and storage scale with N² per move. Input algorithm text is limited to 100,000 characters, and generated scrambles to 10,000 moves.

Serialized states are JSON `{size, facelets}` with six arrays in the documented face order. Validation checks shape, known color identities and exactly N² stickers of each color. Solved detection permits the 24 proper whole-cube orientations and excludes reflected/oppositely swapped face arrangements. For nonsolved states, full NxN physical reachability is **not** checked: a structurally valid edit can still be physically impossible. `reachability: "unchecked"` reports this explicitly; only a properly oriented solved arrangement receives `"solved"`.

Scramble generator v1 hashes the UTF-16 seed with FNV-1a and samples using Mulberry32. The default length is max(20,10N). Each step picks a face on a different axis from the preceding step, a width from 1 through floor(N/2), and a turn count from 1 through 3. This is a reproducible legal random-move scramble, not a uniform random-state scramble or a cryptographic PRNG. The benchmark service supplies a fresh cryptographic seed. Reproduction requires the same size, seed, length and generator version. No solver or optimality claim is included.

Parser failures are exported `CubeNotationError` instances with stable `category` values. `invalid_notation` covers malformed grammar, non-string or oversized text, zero layer indices, descending ranges, unsafe integer indices and one-layer wide notation. `illegal_move_for_cube_size` covers syntactically valid layers exceeding N, M/E/S on even sizes and invalid cube dimensions. Consumers should match the category rather than error prose.
