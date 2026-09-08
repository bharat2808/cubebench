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
export type Match = {
  match_id: string;
  owner_id: string;
  league: 'sprint' | 'live';
  size: number;
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
