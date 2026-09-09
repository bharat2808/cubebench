import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { SqliteRepository, type Actor } from '../packages/persistence/src/index.js';
import { BenchmarkService, type Run } from '../packages/benchmark-core/src/index.js';
import {
  toolSuccessOutputs,
  errorSchema,
  type ToolName,
} from '../packages/shared-contracts/src/index.js';
import { parseMoves, invertMoves, serializeMoves } from '../packages/cube-core/src/index.js';
const actor: Actor = { id: 'test-owner', role: 'community' };
function setup() {
  let time = 100;
  const store = new SqliteRepository(':memory:');
  const service = new BenchmarkService(store, { clock: () => time });
  return {
    store,
    service,
    tick: (ms: number) => {
      time += ms;
    },
  };
}
function ok<N extends ToolName>(
  s: ReturnType<typeof setup>,
  name: N,
  args: unknown,
  owner = actor,
): z.infer<(typeof toolSuccessOutputs)[N]> {
  return toolSuccessOutputs[name].parse(s.service.execute(name, args, owner)) as z.infer<
    (typeof toolSuccessOutputs)[N]
  >;
}
const meta = { display_name: 'Test agent' };
function enter(
  s: ReturnType<typeof setup>,
  league: 'sprint' | 'live' = 'sprint',
  entrant_count = 1,
) {
  const match = ok(s, 'cubebench_create_match', { league, size: 3, entrant_count });
  const p = match.participants[0]!,
    t = p.tokens[0]!;
  const start = ok(s, 'cubebench_start_run', {
    match_id: match.match_id,
    participant_id: p.participant_id,
    round_id: t.round_id,
    participant_token: t.participant_token,
    metadata: meta,
  });
  const args = {
    match_id: match.match_id,
    participant_id: p.participant_id,
    run_id: start.run.run_id,
    run_token: start.run_token,
  };
  return { match, start, args };
}
const solution = (scramble: string) => serializeMoves(invertMoves(parseMoves(scramble, 3)));
const runScramble = (s: ReturnType<typeof setup>, runId: string) =>
  s.store.get<Run>('runs', runId)!.scramble;
describe('benchmark acceptance', () => {
  it('conceals fresh scrambles and gives identical round state to every entrant', () => {
    const s = setup(),
      a = enter(s, 'sprint', 2);
    const pre = ok(s, 'cubebench_get_match', { match_id: a.match.match_id });
    expect(pre.match.runs).toEqual([]);
    expect(JSON.stringify(a.match)).not.toContain('scramble');
    const p = a.match.participants[1]!,
      t = p.tokens[0]!;
    const b = ok(s, 'cubebench_start_run', {
      match_id: a.match.match_id,
      participant_id: p.participant_id,
      round_id: t.round_id,
      participant_token: t.participant_token,
      metadata: meta,
    });
    expect(b.run.state).toEqual(a.start.run.state);
    const fresh = enter(s);
    expect(runScramble(s, fresh.args.run_id)).not.toEqual(runScramble(s, a.args.run_id));
  });
  it('verifies Sprint once with authoritative elapsed time and immutable signature', () => {
    const s = setup(),
      a = enter(s);
    s.tick(1234);
    const r = ok(s, 'cubebench_submit_solution', {
      ...a.args,
      sequence: solution(runScramble(s, a.args.run_id)),
    });
    expect(r.result?.success).toBe(true);
    expect(r.result?.elapsed_ms).toBe(1234);
    expect(s.service.verifyResult(r.result!)).toBe(true);
    expect(s.service.verifyResult({ ...r.result!, elapsed_ms: 1 })).toBe(false);
    expect(
      errorSchema.parse(
        s.service.execute('cubebench_submit_solution', { ...a.args, sequence: 'R' }, actor),
      ).ok,
    ).toBe(false);
    expect(s.store.get('results', r.result!.result_id)).toEqual(r.result);
  });
  it('Live accepts long batches while preserving wrong-league isolation', () => {
    const s = setup(),
      a = enter(s, 'live');
    expect(
      errorSchema.parse(
        s.service.execute('cubebench_submit_solution', { ...a.args, sequence: 'R' }, actor),
      ).error.category,
    ).toBe('unauthorized');
    const batch = ok(s, 'cubebench_apply_moves', {
      ...a.args,
      sequence: Array(13).fill('R').join(' '),
    });
    expect(batch.accepted_moves).toHaveLength(13);
    expect(ok(s, 'cubebench_get_run', a.args).run.failure).toBeNull();
  });
  it('never accepts community claims as a verified runner', () => {
    const s = setup();
    expect(
      errorSchema.parse(
        s.service.execute(
          'cubebench_create_match',
          { league: 'sprint', size: 3, ranked: true },
          actor,
        ),
      ).error.category,
    ).toBe('unauthorized');
    const a = enter(s);
    const r = ok(s, 'cubebench_submit_solution', {
      ...a.args,
      sequence: solution(runScramble(s, a.args.run_id)),
    });
    expect(r.result?.verification).toBe('community');
    expect(
      ok(s, 'cubebench_get_leaderboard', { league: 'sprint', size: 3, result_class: 'verified' })
        .rows,
    ).toEqual([]);
  });
  it('malformed Sprint submission ends the attempt without corrupting state', () => {
    const s = setup(),
      a = enter(s);
    const r = ok(s, 'cubebench_submit_solution', { ...a.args, sequence: 'R rubbish' });
    expect(r.result?.failure).toBe('invalid_notation');
    expect(r.result?.final_state).toEqual(a.start.run.state);
  });
  it('timeouts, abandoning and token replay cannot lead to valid results', () => {
    const s = setup(),
      a = enter(s);
    s.tick(300001);
    expect(ok(s, 'cubebench_get_run', a.args).run.failure).toBe('timeout');
    const b = enter(s);
    expect(ok(s, 'cubebench_abandon_run', b.args).run.failure).toBe('abandoned');
    const p = b.match.participants[0]!,
      t = p.tokens[0]!;
    expect(
      errorSchema.parse(
        s.service.execute(
          'cubebench_start_run',
          {
            match_id: b.match.match_id,
            participant_id: p.participant_id,
            round_id: t.round_id,
            participant_token: t.participant_token,
            metadata: meta,
          },
          actor,
        ),
      ).ok,
    ).toBe(false);
  });
});
