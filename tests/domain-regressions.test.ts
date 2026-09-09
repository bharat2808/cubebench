import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BenchmarkService, type Run, type Match } from '../packages/benchmark-core/src/index.js';
import { invertMoves, parseMoves, serializeMoves } from '../packages/cube-core/src/index.js';
import { SqliteRepository, type Actor } from '../packages/persistence/src/index.js';
import {
  errorSchema,
  resultSchema,
  toolSuccessOutputs,
  type CreateMatchInput,
  type ToolName,
} from '../packages/shared-contracts/src/index.js';

const stores: SqliteRepository[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
});
const owner: Actor = { id: 'regression-owner', role: 'community' };
function setup() {
  let time = 0;
  const store = new SqliteRepository(':memory:');
  stores.push(store);
  const service = new BenchmarkService(store, { clock: () => time });
  function call<K extends ToolName>(
    name: K,
    args: unknown,
    actor = owner,
  ): z.output<(typeof toolSuccessOutputs)[K]> {
    return toolSuccessOutputs[name].parse(service.execute(name, args, actor)) as z.output<
      (typeof toolSuccessOutputs)[K]
    >;
  }
  function create(input: Partial<CreateMatchInput> = {}, actor = owner) {
    return call('cubebench_create_match', { league: 'sprint', size: 2, ...input }, actor);
  }
  function start(match: ReturnType<typeof create>, round = 0, actor = owner) {
    const p = match.participants[0]!,
      token = p.tokens[round]!;
    const args = {
      match_id: match.match_id,
      participant_id: p.participant_id,
      round_id: token.round_id,
      participant_token: token.participant_token,
      metadata: { display_name: 'Identical public metadata' },
    };
    const response = call('cubebench_start_run', args, actor);
    return {
      response,
      args: {
        match_id: match.match_id,
        participant_id: p.participant_id,
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
    setTime: (value: number) => {
      time = value;
    },
  };
}

describe('reviewed domain regressions', () => {
  it('does not sign a successful Live solve when final move persistence crosses the deadline', () => {
    const s = setup(),
      a = s.start(s.create({ league: 'live', limits: { time_ms: 1000 } }));
    const moves = invertMoves(parseMoves(s.store.get<Run>('runs', a.args.run_id)!.scramble, 2));
    while (moves.length > 1)
      s.call('cubebench_apply_moves', {
        ...a.args,
        sequence: serializeMoves(moves.splice(0, Math.min(12, moves.length - 1))),
      });
    s.setTime(999);
    const append = s.store.appendEvent.bind(s.store);
    s.store.appendEvent = (match, round, body) =>
      append(match, round, (id) => {
        const event = body(id);
        if (event && typeof event === 'object' && 'type' in event && event.type === 'move_accepted')
          s.setTime(1001);
        return event;
      });
    const response = s.call('cubebench_apply_moves', {
      ...a.args,
      sequence: serializeMoves(moves),
    });
    expect(response.run.failure).toBe('timeout');
    const result = resultSchema.parse(s.store.list('results')[0]);
    expect(result.success).toBe(false);
    expect(result.elapsed_ms).toBe(1001);
  });
  it('retains public history when over a thousand newer private results exist', () => {
    const s = setup(),
      publicRun = s.start(s.create());
    s.call('cubebench_submit_solution', { ...publicRun.args, sequence: '' });
    const publicResult = resultSchema.parse(s.store.list('results')[0]);
    const hidden = s.start(s.create({ visibility: 'private' }));
    s.call('cubebench_submit_solution', { ...hidden.args, sequence: '' });
    const hiddenResult = resultSchema.parse(
      s.store.list('results', { match_id: hidden.args.match_id })[0],
    );
    s.store.transaction(() => {
      for (let i = 0; i < 1001; i++)
        s.store.insert(
          'results',
          `hidden-${i}`,
          { ...hiddenResult, result_id: `hidden-${i}` },
          {
            match_id: hidden.args.match_id,
            league: 'sprint',
            classification: 'community',
            size: 2,
            created_at: '2099-01-01T00:00:00.000Z',
          },
        );
    });
    const publicResults = s.service.getPublicResults('sprint', 'community', 2);
    expect(publicResults.map((result) => result.result_id)).toContain(publicResult.result_id);
    expect(publicResults).toHaveLength(1);
    const board = s.call('cubebench_get_leaderboard', {
      league: 'sprint',
      result_class: 'community',
      size: 2,
    });
    expect(board.rows[0]?.attempts).toBe(1);
  });
  it('binds authenticated submitter identity and isolates identical community metadata', () => {
    const s = setup();
    for (const actor of [owner, { id: 'copycat-owner', role: 'community' } satisfies Actor]) {
      const a = s.start(s.create({}, actor), 0, actor);
      s.call('cubebench_submit_solution', { ...a.args, sequence: '' }, actor);
      const result = resultSchema.parse(s.store.list('results', { match_id: a.args.match_id })[0]);
      expect(result).toMatchObject({ submitter_identity: actor.id, runner_identity: null });
      expect(s.service.verifyResult(result)).toBe(true);
      expect(s.service.verifyResult({ ...result, submitter_identity: 'forged' })).toBe(false);
    }
    const board = s.call('cubebench_get_leaderboard', {
      league: 'sprint',
      result_class: 'community',
      size: 2,
    });
    expect(board.rows).toHaveLength(2);
    expect(board.rows.every((row) => row.attempts === 1)).toBe(true);
  });
  it('keeps later tickets dormant then permits exactly a one-hour eligible start window', () => {
    vi.useFakeTimers();
    const beginning = new Date('2026-09-08T10:00:00Z').getTime();
    vi.setSystemTime(beginning);
    const s = setup(),
      match = s.create({ trial_count: 3, limits: { time_ms: 3600000 } }),
      first = s.start(match);
    vi.setSystemTime(beginning + 59 * 60000);
    s.setTime(59 * 60000);
    s.call('cubebench_abandon_run', first.args);
    vi.setSystemTime(beginning + 61 * 60000);
    const second = s.start(match, 1);
    s.call('cubebench_abandon_run', second.args);
    vi.setSystemTime(beginning + 121 * 60000);
    const p = match.participants[0]!,
      ticket = p.tokens[2]!;
    const denied = s.service.execute(
      'cubebench_start_run',
      {
        match_id: match.match_id,
        participant_id: p.participant_id,
        round_id: ticket.round_id,
        participant_token: ticket.participant_token,
        metadata: { display_name: 'Late' },
      },
      owner,
    );
    expect(errorSchema.parse(denied).error.category).toBe('unauthorized');
  });
  it('signs cumulative trusted usage only from verified runner attempts', () => {
    const s = setup(),
      runner: Actor = { id: 'trusted-usage-runner', role: 'runner' };
    const a = s.start(s.create({ league: 'live', ranked: true }, runner), 0, runner);
    s.call(
      'cubebench_apply_moves',
      {
        ...a.args,
        sequence: 'R',
        trusted_usage: { input_tokens: 10, output_tokens: 2, cost_usd: 0.1 },
      },
      runner,
    );
    s.call(
      'cubebench_apply_moves',
      {
        ...a.args,
        sequence: 'U',
        trusted_usage: { input_tokens: 20, output_tokens: 5, cost_usd: 0.2 },
      },
      runner,
    );
    s.call('cubebench_abandon_run', a.args, runner);
    const result = resultSchema.parse(s.store.list('results', { match_id: a.args.match_id })[0]);
    expect(result.trusted_usage).toEqual({ input_tokens: 20, output_tokens: 5, cost_usd: 0.2 });
    expect(s.service.verifyResult(result)).toBe(true);
    expect(
      s.service.verifyResult({
        ...result,
        trusted_usage: { input_tokens: 20, output_tokens: 5, cost_usd: 0 },
      }),
    ).toBe(false);
    const b = s.start(s.create());
    const denied = s.service.execute(
      'cubebench_submit_solution',
      {
        ...b.args,
        sequence: '',
        trusted_usage: { input_tokens: 1, output_tokens: 1, cost_usd: 0 },
      },
      owner,
    );
    expect(errorSchema.parse(denied).error.category).toBe('unauthorized');
    expect(s.store.get<Run>('runs', b.args.run_id)?.tool_call_count).toBe(2);
    s.call('cubebench_submit_solution', { ...b.args, sequence: '' });
    expect(
      resultSchema.parse(s.store.list('results', { match_id: b.args.match_id })[0]).trusted_usage,
    ).toBeNull();
  });
  it('still expires the first-round ticket after its initial one-hour window', () => {
    vi.useFakeTimers();
    const beginning = new Date('2026-09-08T10:00:00Z').getTime();
    vi.setSystemTime(beginning);
    const s = setup(),
      match = s.create({ trial_count: 20 });
    vi.setSystemTime(beginning + 3600000);
    const p = match.participants[0]!,
      ticket = p.tokens[0]!;
    expect(
      errorSchema.parse(
        s.service.execute(
          'cubebench_start_run',
          {
            match_id: match.match_id,
            participant_id: p.participant_id,
            round_id: ticket.round_id,
            participant_token: ticket.participant_token,
            metadata: { display_name: 'Late' },
          },
          owner,
        ),
      ).error.category,
    ).toBe('unauthorized');
  });
  it('recovers every active record beyond the old ten-thousand-row boundary', () => {
    const s = setup(),
      a = s.start(s.create());
    const template = s.store.get<Run>('runs', a.args.run_id)!;
    const matchTemplate = s.store.get<Match>('matches', a.args.match_id)!;
    s.store.transaction(() => {
      for (let i = 0; i < 10000; i++) {
        const match_id = `interrupted-match-${i}`;
        s.store.insert('matches', match_id, { ...matchTemplate, match_id }, { status: 'active' });
        s.store.insert(
          'runs',
          `interrupted-${i}`,
          { ...template, match_id, run_id: `interrupted-${i}` },
          { match_id, status: 'active', created_at: '2099-01-01T00:00:00.000Z' },
        );
      }
    });
    s.service.recoverInterrupted();
    expect(s.store.list('runs', { status: 'active' }, Number.MAX_SAFE_INTEGER)).toEqual([]);
    expect(s.store.get<Run>('runs', a.args.run_id)?.failure).toBe('disconnected');
  }, 30000);
});
