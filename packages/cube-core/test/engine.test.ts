import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  applyMoves,
  createSolved,
  CubeNotationError,
  deserializeState,
  faceletGeometry,
  generateScramble,
  invertMoves,
  isSolved,
  parseMoves,
  serializeMoves,
  serializeState,
  validateState,
} from '../src/index';

describe('cube engine', () => {
  for (const size of [2, 3, 4, 5, 6, 7]) {
    it(`${size}: every legal face move has order four and inverse`, () => {
      const solved = createSolved(size);
      for (const token of [
        'R',
        'L',
        'U',
        'D',
        'F',
        'B',
        'Rw',
        '2R',
        'x',
        'y',
        'z',
        ...(size >= 3 ? ['3Rw', '2-3Rw'] : []),
      ]) {
        expect(applyMoves(solved, Array(4).fill(token).join(' '))).toEqual(solved);
        const moves = parseMoves(token, size);
        expect(applyMoves(applyMoves(solved, moves), invertMoves(moves))).toEqual(solved);
      }
    });
    it(`${size}: random algorithms preserve counts and invert`, () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.constantFrom('R', 'U', 'F', 'B', 'L', 'D', 'Rw', '2R', 'x', 'y', 'z', "R'", 'F2'),
            { maxLength: 80 },
          ),
          (tokens) => {
            const moves = parseMoves(tokens.join(' '), size);
            const state = applyMoves(createSolved(size), moves);
            expect(validateState(state).valid).toBe(true);
            expect(applyMoves(state, invertMoves(moves))).toEqual(createSolved(size));
          },
        ),
        { numRuns: 30 },
      );
    });
  }
  it('uses conventional face mappings for R U F and opposite faces', () => {
    const s = createSolved(3);
    expect(applyMoves(s, 'R').facelets.U.filter((_, i) => i % 3 === 2)).toEqual(['F', 'F', 'F']);
    expect(applyMoves(s, 'U').facelets.F.slice(0, 3)).toEqual(['R', 'R', 'R']);
    expect(applyMoves(s, 'F').facelets.R.filter((_, i) => i % 3 === 0)).toEqual(['U', 'U', 'U']);
    expect(applyMoves(s, 'L').facelets.F.filter((_, i) => i % 3 === 0)).toEqual(['U', 'U', 'U']);
    expect(applyMoves(s, 'D').facelets.F.slice(6)).toEqual(['L', 'L', 'L']);
    expect(applyMoves(s, 'B').facelets.U.slice(0, 3)).toEqual(['R', 'R', 'R']);
  });
  it('wide, indexed, range, middle and rotations agree with independent compositions', () => {
    const s = createSolved(5);
    for (const [a, b] of [
      ['Rw', 'R 2R'],
      ['3Rw', 'R 2R 3R'],
      ['2-3Rw', '2R 3R'],
      ['M', '3L'],
      ['E', '3D'],
      ['S', '3F'],
      ['x', 'R 2R 3R 4R 5R'],
      ['y', '5Uw'],
      ['z', '5Fw'],
    ])
      expect(applyMoves(s, a!)).toEqual(applyMoves(s, b!));
    expect(serializeMoves(parseMoves("r u2 03Rw' M", 5))).toBe("Rw Uw2 3Rw' 3L");
  });
  it('rejects malformed and out of range syntax', () => {
    for (const token of [
      'R3',
      "R2'",
      '0R',
      '1Rw',
      '4Rw',
      '2-1Rw',
      '0-2Rw',
      '2-4Rw',
      'RR',
      'Q',
      'xw',
      '2x',
      'R()',
      'R;',
      'M',
      'E',
      'S',
    ])
      expect(() => parseMoves(token, 2)).toThrow();
    for (const size of [0, 1, 2.5, 21, NaN]) expect(() => createSolved(size)).toThrow();
    expect(createSolved(21, 30).size).toBe(21);
  });
  it('solved orientation and state serialization', () => {
    const state = applyMoves(createSolved(3), 'x y z');
    expect(isSolved(state)).toBe(true);
    expect(deserializeState(serializeState(state))).toEqual(state);
    expect(() => deserializeState('{}')).toThrow();
    const s = createSolved(3);
    [s.facelets.U[0], s.facelets.R[0]] = [s.facelets.R[0]!, s.facelets.U[0]!];
    expect(validateState(s)).toEqual({ valid: true, errors: [], reachability: 'unchecked' });
    expect(validateState(null).valid).toBe(false);
  });
  it('seeded scramble reproducibility and inverses', () => {
    for (const n of [2, 3, 4, 5, 6, 7]) {
      const a = generateScramble(n, 'same seed');
      expect(a).toEqual(generateScramble(n, 'same seed'));
      expect(a.scramble).not.toEqual(generateScramble(n, 'other seed').scramble);
      expect(applyMoves(a.state, invertMoves(parseMoves(a.scramble, n)))).toEqual(createSolved(n));
    }
  });
  it('recognizes all proper orientations and rejects mirrored solved-looking edits', () => {
    const signatures = new Set<string>();
    for (const top of ['', 'x', 'x2', "x'", 'z', "z'"]) {
      for (const spin of ['', 'y', 'y2', "y'"]) {
        const state = applyMoves(createSolved(3), `${top} ${spin}`);
        expect(isSolved(state)).toBe(true);
        signatures.add(serializeState(state));
      }
    }
    expect(signatures.size).toBe(24);
    const mirrored = createSolved(3);
    [mirrored.facelets.R, mirrored.facelets.L] = [mirrored.facelets.L, mirrored.facelets.R];
    expect(isSolved(mirrored)).toBe(false);
    expect(validateState(mirrored)).toEqual({ valid: true, errors: [], reachability: 'unchecked' });
  });
  it('does not mutate arguments and rejects forged move metadata', () => {
    const state = createSolved(3),
      original = serializeState(state),
      moves = parseMoves("R U'", 3);
    const before = JSON.stringify(moves);
    applyMoves(state, moves);
    invertMoves(moves);
    expect(serializeState(state)).toBe(original);
    expect(JSON.stringify(moves)).toBe(before);
    expect(() => applyMoves(state, [{ ...moves[0]!, axis: 2 }])).toThrow('Invalid move object');
  });
  it('provides stable typed notation failure categories', () => {
    for (const [token, category] of [
      ['R3', 'invalid_notation'],
      ['0R', 'invalid_notation'],
      ['1Rw', 'invalid_notation'],
      ['3-2Rw', 'invalid_notation'],
      ['2-3R', 'invalid_notation'],
      ['9007199254740992R', 'invalid_notation'],
      ['3R', 'illegal_move_for_cube_size'],
      ['3Rw', 'illegal_move_for_cube_size'],
      ['2-3Rw', 'illegal_move_for_cube_size'],
      ['M', 'illegal_move_for_cube_size'],
      ['E', 'illegal_move_for_cube_size'],
      ['S', 'illegal_move_for_cube_size'],
    ] as const) {
      let caught: unknown;
      try {
        parseMoves(token, 2);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CubeNotationError);
      expect(caught).toMatchObject({ category, name: 'CubeNotationError' });
    }
  });
  it('face-on row-major geometry', () => {
    expect(faceletGeometry(3, 'F', 0)).toEqual({ position: [0, 2, 2], normal: [0, 0, 1] });
    expect(faceletGeometry(3, 'B', 0)).toEqual({ position: [2, 2, 0], normal: [0, 0, -1] });
    expect(faceletGeometry(3, 'U', 0)).toEqual({ position: [0, 2, 0], normal: [0, 1, 0] });
  });
});
