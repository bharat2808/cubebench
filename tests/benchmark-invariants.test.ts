import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BenchmarkService, type Match, type Run } from '../packages/benchmark-core/src/index.js';
import { digest } from '../packages/benchmark-core/src/signatures.js';
import {
  applyMoves,
  invertMoves,
  parseMoves,
  serializeMoves,
} from '../packages/cube-core/src/index.js';
import { SqliteRepository, type Actor } from '../packages/persistence/src/index.js';
import {
  errorSchema,
  eventSchema,
  resultSchema,
  toolSuccessOutputs,
  type CreateMatchInput,
  type ToolName,
} from '../packages/shared-contracts/src/index.js';

const stores: SqliteRepository[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const community: Actor = { id: 'community-owner', role: 'community' };
const runner: Actor = {
  id: 'trusted-runner',
  role: 'runner',
  clientIdentity: 'authenticated-harness',
};
function setup() {
  let time = 100;
  const store = new SqliteRepository(':memory:');
  stores.push(store);
  const service = new BenchmarkService(store, { clock: () => time });
  function call<K extends ToolName>(
    name: K,
    args: unknown,
    actor: Actor = community,
  ): z.output<(typeof toolSuccessOutputs)[K]> {
    return toolSuccessOutputs[name].parse(service.execute(name, args, actor)) as z.output<
      (typeof toolSuccessOutputs)[K]
    >;
  }
  function create(input: Partial<CreateMatchInput> = {}, actor: Actor = community) {
    return call('cubebench_create_match', { league: 'sprint', size: 3, ...input }, actor);
  }
  function start(
    match: ReturnType<typeof create>,
    entrant = 0,
    trial = 0,
    actor: Actor = community,
  ) {
    const participant = match.participants[entrant]!;
    const ticket = participant.tokens[trial]!;
    const response = call(
      'cubebench_start_run',
      {
        match_id: match.match_id,
        participant_id: participant.participant_id,
        round_id: ticket.round_id,
        participant_token: ticket.participant_token,
        metadata: {
          display_name: 'Invariant agent',
          claimed_provider: 'claimed provider',
          claimed_model: 'claimed model',
          mcp_client_identity: 'spoofed-harness',
        },
      },
      actor,
    );
    return {
      response,
      args: {
        match_id: match.match_id,
        participant_id: participant.participant_id,
        run_id: response.run.run_id,
        run_token: response.run_token,
      },
    };
  }
  return {
    store,
    service,
    call,
    create,
    start,
    tick: (ms: number) => {
      time += ms;
    },
  };
}
function inverse(scramble: string) {
  return serializeMoves(invertMoves(parseMoves(scramble, 3)));
}
function storedRun(s: ReturnType<typeof setup>, id: string) {
  return s.store.get<Run>('runs', id)!;
}
function internalScramble(s: ReturnType<typeof setup>, runId: string) {
  return storedRun(s, runId).scramble;
}

describe('benchmark independent fairness and security invariants', () => {
  it('exposes only the difficulty label, never the internal scramble length', () => {
    const s = setup(),
      match = s.create({ difficulty: 'extra_hard' }),
      a = s.start(match);
    expect(a.response.run.difficulty).toBe('extra_hard');
    expect(s.service.getMatch(match.match_id).difficulty).toBe('extra_hard');
    const serialized = JSON.stringify(a.response.run);
    expect(serialized).not.toContain('scramble_length');
    // The scramble value stays hidden while the round is active; the field
    // may exist in the view as null, and must never carry the sequence.
    expect(a.response.run.scramble).toBeNull();
    expect(Object.keys(a.response.run)).not.toContain('scramble_length');
  });
  it('defaults difficulty to medium and keeps it reproducible per level', () => {
    const s = setup(),
      plain = s.create();
    expect(plain.difficulty).toBe('medium');
    const a = s.start(plain);
    expect(a.response.run.difficulty).toBe('medium');
    const levels = ['easy', 'medium', 'hard', 'extra_hard'] as const;
    for (const difficulty of levels) {
      const created = s.create({ difficulty });
      expect(created.difficulty).toBe(difficulty);
    }
  });

  it('withholds the scramble from active tools and events until the round is complete', () => {
    const s = setup(),
      match = s.create({ entrant_count: 2 }),
      a = s.start(match),
      b = s.start(match, 1);
    const secret = internalScramble(s, a.args.run_id);
    expect(a.response.run.scramble).toBeNull();
    expect(s.call('cubebench_get_run', a.args).run.scramble).toBeNull();
    expect(JSON.stringify(s.service.getMatch(match.match_id))).not.toContain(secret);
    expect(JSON.stringify(s.service.getEvents(match.match_id))).not.toContain(secret);

    s.call('cubebench_submit_solution', { ...a.args, sequence: inverse(secret) });
    expect(s.call('cubebench_get_run', a.args).run.scramble).toBeNull();
    s.call('cubebench_submit_solution', {
      ...b.args,
      sequence: inverse(internalScramble(s, b.args.run_id)),
    });

    expect(s.call('cubebench_get_run', a.args).run.scramble).toBe(secret);
    expect(s.service.getMatch(match.match_id).runs[0]?.scramble).toBe(secret);
    expect(
      s.service.getEvents(match.match_id).some((event) => event.type === 'scramble_revealed'),
    ).toBe(true);
  });
  it('accepts a Live sequence larger than twelve moves in one call', () => {
    const s = setup(),
      a = s.start(s.create({ league: 'live' }));
    const solution = inverse(internalScramble(s, a.args.run_id));
    expect(solution.split(' ').length).toBeGreaterThan(12);
    const response = s.call('cubebench_apply_moves', { ...a.args, sequence: solution });
    expect(response.run.failure).toBe('solved');
    expect(response.accepted_moves.length).toBeGreaterThan(12);
  });
  it('never exposes seeds through early terminal mutation results', () => {
    const s = setup(),
      match = s.create({ entrant_count: 2, trial_count: 2 }),
      a = s.start(match);
    const persisted = s.store.get<Match>('matches', match.match_id)!;
    expect(JSON.stringify(match)).not.toContain(persisted.rounds[0]!.seed);
    expect(JSON.stringify(a.response)).not.toContain(persisted.rounds[0]!.seed);
    const finish = s.call('cubebench_submit_solution', { ...a.args, sequence: '' });
    expect(finish.result).toBeNull();
    expect(JSON.stringify(finish)).not.toContain(persisted.rounds[0]!.seed);
    expect(
      errorSchema.parse(
        s.service.execute('cubebench_get_results', { match_id: match.match_id }, community),
      ).error.category,
    ).toBe('unauthorized');
    expect(s.service.getEvents(match.match_id).every((event) => event.round_id === null)).toBe(
      true,
    );
  });
  it('repeated rounds have unique seeds and cannot start until all earlier entrants finish', () => {
    const s = setup(),
      match = s.create({ entrant_count: 2, trial_count: 3 });
    const rounds = s.store.get<Match>('matches', match.match_id)!.rounds;
    expect(new Set(rounds.map((r) => r.seed)).size).toBe(3);
    expect(new Set(rounds.map((r) => r.scramble)).size).toBe(3);
    const ticket = match.participants[0]!.tokens[1]!;
    const nextArgs = {
      match_id: match.match_id,
      participant_id: match.participants[0]!.participant_id,
      round_id: ticket.round_id,
      participant_token: ticket.participant_token,
      metadata: { display_name: 'Next trial' },
    };
    const a = s.start(match);
    s.call('cubebench_submit_solution', { ...a.args, sequence: '' });
    expect(
      errorSchema.parse(s.service.execute('cubebench_start_run', nextArgs, community)).error
        .category,
    ).toBe('unauthorized');
    const b = s.start(match, 1);
    s.call('cubebench_abandon_run', b.args);
    const next = s.call('cubebench_start_run', nextArgs);
    expect(internalScramble(s, next.run.run_id)).not.toBe(internalScramble(s, a.args.run_id));
    expect(s.store.list('runs', { match_id: match.match_id })).toHaveLength(3);
  });
  it('serializes overlapping same-run submissions into exactly one immutable result', async () => {
    const s = setup(),
      match = s.create(),
      a = s.start(match);
    const args = { ...a.args, sequence: inverse(internalScramble(s, a.args.run_id)) };
    const outputs = await Promise.all(
      Array.from({ length: 8 }, () =>
        Promise.resolve().then(() =>
          s.service.execute('cubebench_submit_solution', args, community),
        ),
      ),
    );
    expect(
      outputs.filter(
        (output) => toolSuccessOutputs.cubebench_submit_solution.safeParse(output).success,
      ),
    ).toHaveLength(1);
    expect(s.store.list('results', { match_id: match.match_id })).toHaveLength(1);
    expect(storedRun(s, a.args.run_id).tool_call_count).toBe(2);
  });
  it('wrong explicit IDs, tokens and actors cannot consume budget or mutate state', () => {
    const s = setup(),
      a = s.start(s.create({ league: 'live' }));
    const before = storedRun(s, a.args.run_id);
    for (const [args, actor] of [
      [{ ...a.args, match_id: randomUUID() }, community],
      [{ ...a.args, participant_id: randomUUID() }, community],
      [{ ...a.args, run_id: randomUUID() }, community],
      [{ ...a.args, run_token: 'wrong-token-xxxxxxxxxxxxxxxxxxxxxxxx' }, community],
      [a.args, { id: 'other-person', role: 'community' }],
    ] as const) {
      expect(
        errorSchema.parse(
          s.service.execute('cubebench_apply_moves', { ...args, sequence: 'R' }, actor),
        ).error.category,
      ).toBe('unauthorized');
      expect(storedRun(s, a.args.run_id)).toEqual(before);
    }
  });
  it('Live retains accepted prefix and records rejected suffix on invalid notation', () => {
    const s = setup(),
      a = s.start(s.create({ league: 'live' }));
    const response = s.call('cubebench_apply_moves', { ...a.args, sequence: 'R U rubbish F' });
    expect(response.accepted_moves).toEqual(['R', 'U']);
    expect(response.run.state).toEqual(applyMoves(a.response.run.state, 'R U'));
    expect(response.run.failure).toBe('invalid_notation');
    const result = resultSchema.parse(s.store.list('results')[0]);
    expect(result.attempts[0]).toMatchObject({ accepted: ['R', 'U'], rejected: ['rubbish', 'F'] });
  });
  it('replay move events reconstruct final state and form a verifiable hash chain', () => {
    const s = setup(),
      a = s.start(s.create({ league: 'live' }));
    s.call('cubebench_apply_moves', { ...a.args, sequence: 'R U F2' });
    s.call('cubebench_abandon_run', a.args);
    const events = s.service.getEvents(a.args.match_id).map((event) => eventSchema.parse(event));
    let previous = '0'.repeat(64),
      state = a.response.run.state;
    for (const event of events) {
      const { hash, ...body } = event;
      expect(event.previous_hash).toBe(previous);
      expect(digest(body)).toBe(hash);
      previous = hash;
      if (event.type === 'move_accepted') {
        state = applyMoves(state, event.move!);
        expect(event.state).toEqual(state);
      }
    }
    const result = resultSchema.parse(s.store.list('results')[0]);
    expect(state).toEqual(result.final_state);
    expect(
      events.some((event) => event.hash === result.event_hash && event.type === 'run_abandoned'),
    ).toBe(true);
    expect(s.service.getEvents(a.args.match_id, events[1]!.id)).toEqual(events.slice(2));
  });
  it('long public replay includes its terminal event beyond the first event page', () => {
    const s = setup(),
      a = s.start(s.create({ league: 'live' }));
    for (let batch = 0; batch < 80; batch++)
      s.call('cubebench_apply_moves', { ...a.args, sequence: Array(12).fill('R').join(' ') });
    s.call('cubebench_abandon_run', a.args);
    const replay = s.service.getPublicRun(a.args.run_id);
    expect(replay.events.some((event) => event.type === 'run_abandoned')).toBe(true);
    expect(replay.events.at(-1)?.type).toBe('scramble_revealed');
    expect(replay.events.filter((event) => event.type === 'move_accepted')).toHaveLength(960);
  });
  it('move budgets accept only the legal Live prefix and reject Sprint atomically', () => {
    const s = setup();
    for (const league of ['live', 'sprint'] as const) {
      const a = s.start(s.create({ league, limits: { moves: 2 } }));
      const response =
        league === 'live'
          ? s.call('cubebench_apply_moves', { ...a.args, sequence: 'R U F' })
          : s.call('cubebench_submit_solution', { ...a.args, sequence: 'R U F' });
      expect(response.run.failure).toBe('move_limit_exceeded');
      expect(response.run.move_count).toBe(league === 'live' ? 2 : 0);
      expect(response.run.state).toEqual(
        applyMoves(a.response.run.state, league === 'live' ? 'R U' : ''),
      );
    }
  });
  it('reads count toward the tool budget and exhausted calls cannot accept moves', () => {
    const s = setup(),
      a = s.start(s.create({ league: 'live', limits: { tool_calls: 2 } }));
    const read = s.call('cubebench_get_run', a.args);
    expect(read.run.tool_call_count).toBe(2);
    expect(read.run.remaining.tool_calls).toBe(0);
    const over = s.call('cubebench_apply_moves', { ...a.args, sequence: 'R' });
    expect(over.run.failure).toBe('tool_call_limit_exceeded');
    expect(over.accepted_moves).toEqual([]);
    expect(over.run.state).toEqual(a.response.run.state);
  });
  it('timeout includes idle thinking and sweep and restart never produce success', () => {
    const s = setup(),
      a = s.start(s.create({ limits: { time_ms: 1000 } }));
    s.tick(1000);
    s.service.sweep();
    expect(storedRun(s, a.args.run_id).failure).toBe('timeout');
    const b = s.start(s.create());
    s.tick(42);
    const restarted = new BenchmarkService(s.store, { clock: () => 7 });
    restarted.recoverInterrupted();
    expect(storedRun(s, b.args.run_id)).toMatchObject({
      status: 'finished',
      failure: 'disconnected',
      elapsed_ms: 0,
    });
    expect(
      s.store.list<z.output<typeof resultSchema>>('results').every((result) => !result.success),
    ).toBe(true);
  });
  it('empty Sprint submission terminates as unsolved and preserves its initial state', () => {
    const s = setup(),
      a = s.start(s.create());
    const response = s.call('cubebench_submit_solution', { ...a.args, sequence: '  ' });
    expect(response.run.failure).toBe('unsolved_submission');
    expect(response.run.state).toEqual(a.response.run.state);
  });
  it('signatures bind seed, state, timing, identity and the final event hash; storage is immutable', () => {
    const s = setup(),
      a = s.start(s.create());
    s.tick(27);
    s.call('cubebench_submit_solution', {
      ...a.args,
      sequence: inverse(internalScramble(s, a.args.run_id)),
    });
    const result = resultSchema.parse(s.store.list('results')[0]);
    expect(s.service.verifyResult(result)).toBe(true);
    for (const tampered of [
      { ...result, seed: 'other' },
      { ...result, event_hash: '0'.repeat(64) },
      { ...result, elapsed_ms: 26 },
      { ...result, runner_identity: 'forged' },
      { ...result, final_state: applyMoves(result.final_state, 'R') },
    ])
      expect(s.service.verifyResult(tampered)).toBe(false);
    expect(() => s.store.put('results', result.result_id, { ...result, elapsed_ms: 1 })).toThrow(
      'immutable result',
    );
    expect(() =>
      s.store.db.prepare('DELETE FROM results WHERE id=?').run(result.result_id),
    ).toThrow('immutable result');
    expect(() =>
      s.store.db.prepare('UPDATE events SET body=? WHERE match_id=?').run('{}', a.args.match_id),
    ).toThrow('immutable event');
    expect(s.store.get('results', result.result_id)).toEqual(result);
  });
  it('warmup and private results stay off boards, and league and trust classes stay separate', () => {
    const s = setup();
    for (const input of [
      { league: 'sprint', warmup: true },
      { league: 'sprint', visibility: 'private' },
      { league: 'sprint' },
      { league: 'live' },
      { league: 'sprint', ranked: true },
    ] satisfies Partial<CreateMatchInput>[]) {
      const actor = 'ranked' in input ? runner : community;
      const a = s.start(s.create(input, actor), 0, 0, actor);
      if (input.league === 'sprint')
        s.call(
          'cubebench_submit_solution',
          { ...a.args, sequence: inverse(internalScramble(s, a.args.run_id)) },
          actor,
        );
      else {
        const moves = inverse(internalScramble(s, a.args.run_id)).split(' ');
        for (let i = 0; i < moves.length; i += 12)
          s.call(
            'cubebench_apply_moves',
            { ...a.args, sequence: moves.slice(i, i + 12).join(' ') },
            actor,
          );
      }
    }
    for (const [league, result_class, count] of [
      ['sprint', 'community', 1],
      ['live', 'community', 1],
      ['sprint', 'verified', 1],
      ['live', 'verified', 0],
    ] as const) {
      const board = s.call('cubebench_get_leaderboard', { league, result_class, size: 3 });
      expect(board.rows.reduce((sum, row) => sum + row.attempts, 0)).toBe(count);
    }
  });
  it('verified runner and client identity derive from authenticated actor, never metadata', () => {
    const s = setup(),
      match = s.create({ ranked: true }, runner);
    const ticket = match.participants[0]!.tokens[0]!;
    const startArgs = {
      match_id: match.match_id,
      participant_id: match.participants[0]!.participant_id,
      round_id: ticket.round_id,
      participant_token: ticket.participant_token,
      metadata: { display_name: 'Pretending runner' },
    };
    expect(
      errorSchema.parse(s.service.execute('cubebench_start_run', startArgs, community)).error
        .category,
    ).toBe('unauthorized');
    const a = s.start(match, 0, 0, runner);
    expect(a.response.run.metadata.mcp_client_identity).toBe(runner.clientIdentity);
    s.call('cubebench_submit_solution', { ...a.args, sequence: '' }, runner);
    const result = resultSchema.parse(s.store.list('results')[0]);
    expect(result.verification).toBe('verified');
    expect(result.runner_identity).toBe(runner.id);
  });
});
