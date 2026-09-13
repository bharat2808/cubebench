import type { CubeState } from '../../cube-core/src/index.js';
import type { Actor } from '../../persistence/src/index.js';
import type {
  CompetitorMetadata,
  Failure,
  Limits,
  ResultRecord,
} from '../../shared-contracts/src/index.js';
export type Round = {
  round_id: string;
  index: number;
  seed: string;
  scramble: string;
  state: CubeState;
  execution_order: string[];
};
export type Participant = { participant_id: string; display_name: string };
export type Difficulty = 'easy' | 'medium' | 'hard' | 'extra_hard';

/**
 * Difficulty is the only difficulty signal visible to MCP clients. The scramble
 * length produced for each level is an internal benchmark-service concern; it is
 * never serialized into match, run, or result views before the round completes.
 *
 * The official CubeBench paper defines its long-horizon 3x3 cases by verified
 * optimal depth (8, 12, 16, or 20), not by the number of random scramble moves.
 * `extra_hard` therefore uses the official depth-20 fixture bucket below.
 */
export const DIFFICULTY_SCRAMBLE_LENGTHS: Record<Difficulty, number> = {
  easy: 15,
  medium: 20,
  hard: 30,
  // Retained for the non-official fallback path; 3x3 extra_hard uses fixtures.
  extra_hard: 20,
};

/**
 * Official CubeBench hard-20 fixtures, sourced from cube20.org through the
 * Princeton-AI2-Lab/CubeBench repository. The compact face+turn notation uses
 * 1, 2, 3 for clockwise, half, and counter-clockwise quarter turns.
 */
const OFFICIAL_EXTRA_HARD_FIXTURES = [
  'F2L2F2U3B2U2F2R3D3L1F3U3L1B1D3L1F1L3F3L2',
  'L2D2L1D2R3F2R2B2U1F3D1L3B3R1D1R1F3U2R1U3',
  'D3L2F2L1R2U1B1U3R3D3F1B3D2R3D2R1U2R1F2U2',
  'B2U2B2L1D2U2L2B1L3B2D3F1D3L1U1L2B2D1B3R3',
  'L1F1R1U3D1L3F1D3F1L2F1D1R2B2D2F1U2D2F3U2',
  'R2B1U2B3U2L2F1B2L3B1D3B1U1B2D2B3R3F3D1L1',
  'L1D2F3L2B1D3U1L2U1L1U3R3U1F3L2U2B1U2L2U2',
  'U1L1U3R3F1L1U1B1D3R2B2R1F1B2D3B2L2D2R2D3',
  'B3L2U1R2L3F2B1U3R1D3B1L1U3B1D2B3L2B2R2F2',
  'U2F2L2U3F2U1R2U2F2L3U2B3D3L2U1L1U2F3R1B1',
  'L1B2U2R2B2D2R1U1B3F2D3F2L1R2F3U2B3U3R3D3',
  'R1D3R2F3U1B1D1F1R1U1L3U2B1D3L2U3L2F2U3F2',
  'B2F2L1F2L2B2R2F2D1L1U3B3U3R2U1F2D3L1B3F1',
  'R1B3L1D3F1D2B3U3B1R3U2R2L2B2D1L2U1R2U2R2',
  'D2R2B3D2B2D2L2B2F3D3L3U2R1U3B3D3F1L1B2R3',
] as const;

function stableFixtureIndex(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return (hash >>> 0) % OFFICIAL_EXTRA_HARD_FIXTURES.length;
}

export function officialExtraHardScramble(seed: string): string {
  const compact = OFFICIAL_EXTRA_HARD_FIXTURES[stableFixtureIndex(seed)]!;
  return compact.replace(/([URFDLB])(1|2|3)/gu, (_, face: string, turn: string) =>
    `${face}${turn === '1' ? '' : turn === '2' ? '2' : "'"}`,
  ).trim().split(/(?=[URFDLB])/u).join(' ');
}

export const DIFFICULTY_NAMES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'extra_hard'];

export type Match = {
  match_id: string;
  owner_id: string;
  league: 'sprint' | 'live';
  size: number;
  difficulty: Difficulty;
  entrant_count: number;
  trial_count: number;
  ranked: boolean;
  warmup: boolean;
  visibility: 'public' | 'private';
  limits: Limits;
  status: 'waiting' | 'active' | 'completed';
  created_at: string;
  expires_at: string;
  rounds: Round[];
  participants: Participant[];
};
export type Run = {
  run_id: string;
  match_id: string;
  participant_id: string;
  round_id: string;
  actor: Actor;
  league: 'sprint' | 'live';
  size: number;
  difficulty: Difficulty;
  state: CubeState;
  initial_state: CubeState;
  scramble: string;
  seed: string;
  status: 'active' | 'finished';
  failure: Failure | null;
  started_at: string;
  started_mono: number;
  finished_at: string | null;
  elapsed_ms: number;
  first_move_ms: number | null;
  accepted: string[];
  tool_call_count: number;
  timeline: ResultRecord['timeline'];
  attempts: ResultRecord['attempts'];
  metadata: CompetitorMetadata;
  trusted_usage: ResultRecord['trusted_usage'];
  verification: 'verified' | 'community';
  limits: Limits;
  result_id: string | null;
};
