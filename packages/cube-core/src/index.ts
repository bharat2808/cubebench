/** Pure integer-coordinate facelet engine. No platform or transport dependencies. */
export type Face = 'U' | 'R' | 'F' | 'D' | 'L' | 'B';
export type Vector = [number, number, number];
export type CubeState = { size: number; facelets: Record<Face, Face[]> };
export type Move = {
  face: Face | 'x' | 'y' | 'z';
  layers: number[];
  turns: 1 | 2 | 3;
  notation: string;
  axis: 0 | 1 | 2;
  quarterTurns: number;
};
export const FACE_ORDER: readonly Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];
export const COLOR_SCHEME: Record<Face, string> = {
  U: 'white',
  R: 'red',
  F: 'green',
  D: 'yellow',
  L: 'orange',
  B: 'blue',
};
export const ENGINE_VERSION = '1.0.0';
export const NOTATION_VERSION = '1.0.0';
export const GENERATOR_VERSION = '1.0.0';
const specifications: Record<Face | 'x' | 'y' | 'z', { axis: 0 | 1 | 2; positive: boolean }> = {
  R: { axis: 0, positive: true },
  L: { axis: 0, positive: false },
  U: { axis: 1, positive: true },
  D: { axis: 1, positive: false },
  F: { axis: 2, positive: true },
  B: { axis: 2, positive: false },
  x: { axis: 0, positive: true },
  y: { axis: 1, positive: true },
  z: { axis: 2, positive: true },
};
function checkSize(size: number, max = Number.MAX_SAFE_INTEGER): void {
  if (
    !Number.isSafeInteger(size) ||
    size < 2 ||
    !Number.isSafeInteger(max) ||
    max < 2 ||
    size > max
  )
    throw new Error(`Cube size must be an integer from 2 to ${max}`);
}
export function createSolved(size: number, maxSize = 20): CubeState {
  checkSize(size, maxSize);
  return {
    size,
    facelets: Object.fromEntries(
      FACE_ORDER.map((face) => [face, Array<Face>(size * size).fill(face)]),
    ) as Record<Face, Face[]>,
  };
}
export function faceletGeometry(
  size: number,
  face: Face,
  index: number,
): { position: Vector; normal: Vector } {
  checkSize(size);
  if (!FACE_ORDER.includes(face) || !Number.isInteger(index) || index < 0 || index >= size * size)
    throw new Error('Invalid facelet');
  const r = Math.floor(index / size),
    c = index % size,
    m = size - 1;
  switch (face) {
    case 'F':
      return { position: [c, m - r, m], normal: [0, 0, 1] };
    case 'B':
      return { position: [m - c, m - r, 0], normal: [0, 0, -1] };
    case 'R':
      return { position: [m, m - r, m - c], normal: [1, 0, 0] };
    case 'L':
      return { position: [0, m - r, c], normal: [-1, 0, 0] };
    case 'U':
      return { position: [c, m, r], normal: [0, 1, 0] };
    case 'D':
      return { position: [c, 0, m - r], normal: [0, -1, 0] };
  }
}
function destination(size: number, p: Vector, n: Vector): [Face, number] {
  const [x, y, z] = p,
    m = size - 1;
  if (n[0] === 1) return ['R', (m - y) * size + m - z];
  if (n[0] === -1) return ['L', (m - y) * size + z];
  if (n[1] === 1) return ['U', z * size + x];
  if (n[1] === -1) return ['D', (m - z) * size + x];
  if (n[2] === 1) return ['F', (m - y) * size + x];
  return ['B', (m - y) * size + m - x];
}
function rotate(v: Vector, axis: 0 | 1 | 2, offset: number): Vector {
  const [x, y, z] = v;
  if (axis === 0) return [x, offset - z, y];
  if (axis === 1) return [z, y, offset - x];
  return [offset - y, x, z];
}
const suffix = (turns: number): string => (turns === 1 ? '' : turns === 2 ? '2' : "'");
export class CubeNotationError extends Error {
  readonly name = 'CubeNotationError';
  constructor(
    message: string,
    readonly category: 'invalid_notation' | 'illegal_move_for_cube_size',
  ) {
    super(message);
  }
}
export function parseMoves(sequence: string, size: number): Move[] {
  try {
    checkSize(size);
  } catch {
    throw new CubeNotationError('Invalid cube size', 'illegal_move_for_cube_size');
  }
  if (typeof sequence !== 'string')
    throw new CubeNotationError('Move sequence must be a string', 'invalid_notation');
  if (sequence.length > 100000)
    throw new CubeNotationError('Move sequence is too long', 'invalid_notation');
  if (!sequence.trim()) return [];
  return sequence
    .trim()
    .split(/\s+/u)
    .map((original) => {
      let token = original;
      const middle = /^([MES])(2|')?$/.exec(token);
      if (middle) {
        if (size % 2 === 0)
          throw new CubeNotationError(
            'M/E/S require an odd cube size; use indexed layers on even cubes',
            'illegal_move_for_cube_size',
          );
        const faces: Record<string, Face> = { M: 'L', E: 'D', S: 'F' };
        token = `${(size + 1) / 2}${faces[middle[1]!]!}${middle[2] ?? ''}`;
      }
      const rotation = /^([xyz])(2|')?$/.exec(token);
      if (rotation) {
        const face = rotation[1] as 'x' | 'y' | 'z',
          turns = rotation[2] === '2' ? 2 : rotation[2] === "'" ? 3 : 1;
        return {
          face,
          layers: Array.from({ length: size }, (_, i) => i),
          turns,
          notation: face + suffix(turns),
          axis: specifications[face].axis,
          quarterTurns: -turns,
        };
      }
      const match = /^(?:(\d+)(?:-(\d+))?)?([URFDLBurfdlb])(w)?(2|')?$/.exec(token);
      if (!match) throw new CubeNotationError(`Invalid move: ${original}`, 'invalid_notation');
      const face = match[3]!.toUpperCase() as Face;
      const wide = Boolean(match[4]) || match[3] !== face;
      const first = match[1] === undefined ? undefined : Number(match[1]);
      const last = match[2] === undefined ? undefined : Number(match[2]);
      if (last !== undefined && !wide)
        throw new CubeNotationError('Layer ranges require w', 'invalid_notation');
      const start = last !== undefined ? first! : wide ? 1 : (first ?? 1);
      const end = last ?? (wide ? (first ?? 2) : (first ?? 1));
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 1 ||
        end < start ||
        (wide && last === undefined && end < 2)
      )
        throw new CubeNotationError(`Invalid layer specification: ${original}`, 'invalid_notation');
      if (end > size)
        throw new CubeNotationError(
          `Layer outside cube: ${original}`,
          'illegal_move_for_cube_size',
        );
      const spec = specifications[face];
      const layers = Array.from({ length: end - start + 1 }, (_, i) =>
        spec.positive ? size - (start + i) : start + i - 1,
      );
      const turns: 1 | 2 | 3 = match[5] === '2' ? 2 : match[5] === "'" ? 3 : 1;
      const base =
        start === end
          ? `${start === 1 ? '' : start}${face}`
          : start === 1
            ? `${end === 2 ? '' : end}${face}w`
            : `${start}-${end}${face}w`;
      return {
        face,
        layers,
        turns,
        notation: base + suffix(turns),
        axis: spec.axis,
        quarterTurns: (spec.positive ? -1 : 1) * turns,
      };
    });
}
export function serializeMoves(moves: readonly Move[]): string {
  return moves.map((move) => move.notation).join(' ');
}
export function invertMoves(moves: readonly Move[]): Move[] {
  return [...moves].reverse().map((move) => {
    const turns = (4 - move.turns) as 1 | 2 | 3;
    return {
      ...move,
      layers: [...move.layers],
      turns,
      quarterTurns: (move.quarterTurns < 0 ? -1 : 1) * turns,
      notation: move.notation.replace(/(?:2|')$/u, '') + suffix(turns),
    };
  });
}
export function applyMoves(state: CubeState, moves: readonly Move[] | string): CubeState {
  const validation = validateState(state);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  const parsed = typeof moves === 'string' ? parseMoves(moves, state.size) : moves;
  let result: CubeState = {
    size: state.size,
    facelets: Object.fromEntries(FACE_ORDER.map((f) => [f, [...state.facelets[f]]])) as Record<
      Face,
      Face[]
    >,
  };
  for (const move of parsed) {
    // Reject forged derived fields: notation is the canonical source of move intent.
    const verified = parseMoves(move.notation, state.size);
    const expected = verified[0];
    if (
      verified.length !== 1 ||
      !expected ||
      expected.face !== move.face ||
      expected.axis !== move.axis ||
      expected.turns !== move.turns ||
      expected.quarterTurns !== move.quarterTurns ||
      expected.layers.length !== move.layers.length ||
      expected.layers.some((v, i) => v !== move.layers[i])
    )
      throw new Error('Invalid move object');
    const next: CubeState = {
      size: state.size,
      facelets: Object.fromEntries(FACE_ORDER.map((f) => [f, [...result.facelets[f]]])) as Record<
        Face,
        Face[]
      >,
    };
    const layers = new Set(move.layers),
      steps = ((move.quarterTurns % 4) + 4) % 4;
    for (const face of FACE_ORDER)
      for (let i = 0; i < state.size * state.size; i++) {
        let { position, normal } = faceletGeometry(state.size, face, i);
        if (!layers.has(position[move.axis])) continue;
        for (let step = 0; step < steps; step++) {
          position = rotate(position, move.axis, state.size - 1);
          normal = rotate(normal, move.axis, 0);
        }
        const [target, index] = destination(state.size, position, normal);
        next.facelets[target][index] = result.facelets[face][i]!;
      }
    result = next;
  }
  return result;
}
export function isSolved(state: CubeState): boolean {
  if (
    !FACE_ORDER.every(
      (face) =>
        Array.isArray(state.facelets[face]) &&
        state.facelets[face].length === state.size * state.size &&
        state.facelets[face].every((color) => color === state.facelets[face][0]),
    ) ||
    new Set(FACE_ORDER.map((face) => state.facelets[face][0])).size !== 6
  )
    return false;
  const normals: Record<Face, Vector> = {
    R: [1, 0, 0],
    L: [-1, 0, 0],
    U: [0, 1, 0],
    D: [0, -1, 0],
    F: [0, 0, 1],
    B: [0, 0, -1],
  };
  const oriented = (face: Face): Vector | undefined => normals[state.facelets[face][0]!];
  const right = oriented('R'),
    up = oriented('U'),
    front = oriented('F');
  if (!right || !up || !front) return false;
  const cross: Vector = [
    right[1] * up[2] - right[2] * up[1],
    right[2] * up[0] - right[0] * up[2],
    right[0] * up[1] - right[1] * up[0],
  ];
  if (!cross.every((v, i) => v === front[i])) return false;
  return (
    [
      ['R', 'L'],
      ['U', 'D'],
      ['F', 'B'],
    ] as const
  ).every(([a, b]) => oriented(a)!.every((v, i) => v === -(oriented(b)?.[i] ?? NaN)));
}
export function validateState(value: unknown): {
  valid: boolean;
  errors: string[];
  reachability: 'unchecked' | 'solved';
} {
  const errors: string[] = [];
  if (!value || typeof value !== 'object')
    return { valid: false, errors: ['State must be an object'], reachability: 'unchecked' };
  const candidate = value as Partial<CubeState>;
  if (!Number.isSafeInteger(candidate.size) || candidate.size! < 2)
    errors.push('Invalid cube size');
  if (!candidate.facelets || typeof candidate.facelets !== 'object')
    errors.push('Missing facelets');
  if (errors.length) return { valid: false, errors, reachability: 'unchecked' };
  const state = candidate as CubeState,
    counts = Object.fromEntries(FACE_ORDER.map((f) => [f, 0])) as Record<Face, number>;
  for (const face of FACE_ORDER) {
    const colors = state.facelets[face];
    if (!Array.isArray(colors) || colors.length !== state.size * state.size) {
      errors.push(`Face ${face} must have ${state.size * state.size} stickers`);
      continue;
    }
    for (const color of colors) {
      if (!FACE_ORDER.includes(color)) errors.push(`Invalid color on ${face}`);
      else counts[color]++;
    }
  }
  for (const face of FACE_ORDER)
    if (counts[face] !== state.size * state.size)
      errors.push(`Color ${face} count must be ${state.size * state.size}`);
  return {
    valid: errors.length === 0,
    errors,
    reachability: errors.length === 0 && isSolved(state) ? 'solved' : 'unchecked',
  };
}
export function serializeState(state: CubeState): string {
  const validation = validateState(state);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  return JSON.stringify({
    size: state.size,
    facelets: Object.fromEntries(FACE_ORDER.map((f) => [f, state.facelets[f]])),
  });
}
export function deserializeState(serialized: string): CubeState {
  const state: unknown = JSON.parse(serialized);
  const validation = validateState(state);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  return state as CubeState;
}
/** FNV-1a UTF-16 seed hash and Mulberry32. Versioned reproducibility, not cryptographic randomness. */
export function generateScramble(
  size: number,
  seed: string,
  length = Math.max(20, size * 10),
): { seed: string; scramble: string; state: CubeState } {
  checkSize(size);
  if (typeof seed !== 'string' || !Number.isSafeInteger(length) || length < 1 || length > 10000)
    throw new Error('Invalid scramble seed or length');
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  const random = (): number => {
    hash = (hash + 0x6d2b79f5) | 0;
    let t = hash;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const tokens: string[] = [];
  let previousAxis = -1;
  for (let i = 0; i < length; i++) {
    const available = FACE_ORDER.filter((f) => specifications[f].axis !== previousAxis);
    const face = available[Math.floor(random() * available.length)]!;
    previousAxis = specifications[face].axis;
    const width = 1 + Math.floor(random() * Math.floor(size / 2));
    const turns = 1 + Math.floor(random() * 3);
    tokens.push(
      `${width === 1 ? '' : width === 2 ? '' : width}${face}${width === 1 ? '' : 'w'}${suffix(turns)}`,
    );
  }
  const scramble = tokens.join(' ');
  return { seed, scramble, state: applyMoves(createSolved(size, size), scramble) };
}
