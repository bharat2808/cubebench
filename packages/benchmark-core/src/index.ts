import { randomBytes, randomUUID, randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  applyMoves,
  generateScramble,
  isSolved,
  parseMoves,
  COLOR_SCHEME,
  type Move,
} from '../../cube-core/src/index.js';
import {
  hashToken,
  type Actor,
  type Credential,
  type Repository,
} from '../../persistence/src/index.js';
import {
  toolInputs,
  toolOutput,
  VERSIONS,
  type ToolName,
  type Failure,
  type RunView,
  type ResultRecord,
  type CubeEvent,
  type MatchView,
  createMatchSchema,
  metadataSchema,
  normalizePublicUrl,
} from '../../shared-contracts/src/index.js';
import type { Match, Run, Round } from './types.js';
import { digest, ResultSigner } from './signatures.js';
export { canonicalJson } from './signatures.js';
export type { Match, Run } from './types.js';
export class DomainError extends Error {
  constructor(
    readonly category: Failure,
    message: string,
  ) {
    super(message);
  }
}
const failure = (category: Failure, message: string) => ({
  ok: false as const,
  error: { category, message },
});
const START_WINDOW_MS = 3600000;
const MAX_RUN_TIME_MS = 3600000;
const LEAGUE_INSTRUCTIONS = {
  sprint:
    'Submit exactly one complete solution with cubebench_submit_solution. If a community run needs more time, call cubebench_extend_timeout before the timeout expires, up to a one-hour total timeout. No intermediate execution, hints or reset. The clock is running.',
  live: 'Call cubebench_apply_moves with legal moves up to the remaining move budget. Reasoning and round trips count. If the remaining timeout is insufficient, community runs may call cubebench_extend_timeout before it expires, up to a one-hour total timeout. Visual playback may trail execution. No hints or reset. The clock is running.',
};
export class BenchmarkService {
  readonly publicKey: string;
  private readonly signer: ResultSigner;
  private readonly clock: () => number;
  private readonly publicUrl: string;
  constructor(
    readonly store: Repository,
    options: {
      clock?: () => number;
      signingKeyPath?: string;
      signingKeyPem?: string;
      publicUrl?: string;
    } = {},
  ) {
    this.clock = options.clock ?? (() => performance.now());
    this.publicUrl = normalizePublicUrl(options.publicUrl);
    this.signer = new ResultSigner({
      path: options.signingKeyPath,
      privateKeyPem: options.signingKeyPem,
    });
    this.publicKey = this.signer.publicKey;
    this.store.transaction(() => {
      for (const league of ['sprint', 'live'])
        this.store.put('formats', `${league}-${VERSIONS.format}`, {
          id: `${league}-v2`,
          version: VERSIONS.format,
          league,
          sizes: [2, 3, 4, 5, 6, 7],
          metric: 'verified_wall_clock_ms',
        });
    });
  }
  execute(name: ToolName, args: unknown, actor: Actor): unknown {
    try {
      const schema = toolInputs[name];
      if (!schema)
        throw new DomainError(
          'malformed_tool_arguments',
          'Unknown CubeBench tool. Read cubebench_get_rules.',
        );
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        this.rejectMalformed(name, args, actor);
        return failure(
          'malformed_tool_arguments',
          'Arguments do not match the declared tool schema. Use explicit identifiers and documented fields.',
        );
      }
      const a = parsed.data as Record<string, unknown>;
      let output: unknown;
      switch (name) {
        case 'cubebench_get_rules':
          output = {
            ok: true,
            versions: VERSIONS,
            leagues: [
              { id: 'sprint', instructions: LEAGUE_INSTRUCTIONS.sprint },
              { id: 'live', instructions: LEAGUE_INSTRUCTIONS.live },
            ],
            notation:
              "Whitespace-separated face turns U R F D L B, suffix ' or 2; Rw/3Rw wide; 2R inner; 2-3Rw range; x y z rotations; M E S only on odd cubes. See notation 1.0.0. Move count is one per notation token, including rotations.",
            sizes: [2, 3, 4, 5, 6, 7],
            maximum_size: 20,
            limits: { time_ms: 300000, moves: 1000, tool_calls: 200 },
            scoring:
              'Fastest verified monotonic wall-clock solve wins within league, size and trust class. Trial aggregate placement: completion rate descending, then median successful time ascending; all-failure entries unplaced. No optimality claim.',
            failures: [
              'solved',
              'unsolved_submission',
              'invalid_notation',
              'illegal_move_for_cube_size',
              'malformed_tool_arguments',
              'move_limit_exceeded',
              'tool_call_limit_exceeded',
              'timeout',
              'abandoned',
              'disconnected',
              'unauthorized',
              'internal_server_error',
            ],
            fairness:
              'Fresh seeded random legal scrambles, not uniform random states. Identical state and budgets per round. The generating sequence stays hidden until every entrant in the round finishes. Start counts as call 1; reads and rejected authorized calls count. Warmups never rank. Public state is delayed until all entrants start.',
          };
          break;
        case 'cubebench_list_formats':
          output = { ok: true, formats: this.store.list('formats') };
          break;
        case 'cubebench_create_match':
          output = this.createMatch(a, actor);
          break;
        case 'cubebench_start_run':
          output = this.startRun(a, actor);
          break;
        case 'cubebench_get_match':
          output = { ok: true, match: this.getMatch(a.match_id as string, actor) };
          break;
        case 'cubebench_get_results': {
          const m = this.requireMatch(a.match_id as string, actor, true);
          if (m.status !== 'completed')
            throw new DomainError(
              'unauthorized',
              'Full results are available only after the match completes.',
            );
          output = {
            ok: true,
            results: this.store.list<ResultRecord>('results', { match_id: m.match_id }),
            public_key: this.publicKey,
            export_version: '1.0.0',
          };
          break;
        }
        case 'cubebench_get_leaderboard':
          output = this.leaderboard(
            a.league as 'sprint' | 'live',
            a.result_class as 'verified' | 'community',
            a.size as number,
            a.limit as number,
          );
          break;
        default:
          output = this.runTool(name, a, actor);
      }
      // Validate the full structured envelope at the domain/transport boundary.
      const checked = toolOutput(name).safeParse(output);
      if (!checked.success) throw new Error('Internal output schema mismatch');
      return checked.data;
    } catch (error) {
      return error instanceof DomainError
        ? failure(error.category, error.message)
        : failure(
            'internal_server_error',
            'CubeBench could not complete this operation. No credentials or internal details are exposed.',
          );
    }
  }
  private requireMatch(id: string, actor?: Actor, ownerOnly = false): Match {
    const m = this.store.get<Match>('matches', id);
    if (
      !m ||
      ((ownerOnly || m.visibility === 'private') &&
        m.owner_id !== actor?.id &&
        actor?.role !== 'admin')
    )
      throw new DomainError('unauthorized', 'Match is unavailable to this caller.');
    return m;
  }
  private createMatch(args: Record<string, unknown>, actor: Actor) {
    const input = createMatchSchema.parse(args);
    if (input.ranked && actor.role !== 'runner' && actor.role !== 'admin')
      throw new DomainError(
        'unauthorized',
        'Ranked matches require an authenticated trusted runner.',
      );
    if (input.ranked && input.warmup)
      throw new DomainError('malformed_tool_arguments', 'Warmups cannot be ranked.');
    return this.store.transaction(() => {
      const match_id = randomUUID();
      const participants = Array.from({ length: input.entrant_count }, (_, i) => ({
        participant_id: randomUUID(),
        display_name: `Entrant ${i + 1}`,
      }));
      const rounds: Round[] = Array.from({ length: input.trial_count }, (_, index) => {
        const seed = randomBytes(32).toString('hex');
        const generated = generateScramble(input.size, seed);
        const execution_order = participants.map((p) => p.participant_id);
        for (let i = execution_order.length - 1; i > 0; i--) {
          const j = randomInt(i + 1);
          [execution_order[i], execution_order[j]] = [execution_order[j]!, execution_order[i]!];
        }
        return {
          round_id: randomUUID(),
          index,
          seed,
          scramble: generated.scramble,
          state: generated.state,
          execution_order,
        };
      });
      const created_at = new Date().toISOString();
      const expires_at = new Date(
        Date.parse(created_at) +
          input.entrant_count * input.trial_count * input.limits.time_ms +
          input.trial_count * START_WINDOW_MS,
      ).toISOString();
      const m: Match = {
        ...input,
        match_id,
        owner_id: actor.id,
        created_at,
        expires_at,
        status: 'waiting',
        rounds,
        participants,
      };
      this.saveMatch(m);
      for (const round of rounds)
        this.store.insert('rounds', round.round_id, round, { match_id, seed: round.seed });
      const credentials = participants.map((p) => {
        this.store.insert('participants', p.participant_id, p, { match_id });
        return {
          participant_id: p.participant_id,
          tokens: rounds.map((r) => {
            const expires_at =
              r.index === 0
                ? new Date(Date.parse(created_at) + START_WINDOW_MS).toISOString()
                : m.expires_at;
            const participant_token = randomBytes(32).toString('base64url');
            this.store.insert(
              'tokens',
              hashToken(participant_token),
              {
                hash: hashToken(participant_token),
                actor,
                expires_at,
                purpose: 'participant',
                match_id,
                participant_id: p.participant_id,
                round_id: r.round_id,
                used: false,
              } satisfies Credential,
              { match_id, participant_id: p.participant_id },
            );
            return { round_id: r.round_id, participant_token, expires_at };
          }),
        };
      });
      this.store.insert(
        'audit',
        randomUUID(),
        {
          action: 'match_created',
          actor_id: actor.id,
          match_id,
          ranked: input.ranked,
          at: m.created_at,
        },
        { match_id, owner_id: actor.id },
      );
      this.emit(m, null, 'match_created');
      return {
        ok: true,
        match_id,
        spectator_url:
          input.visibility === 'public' ? `${this.publicUrl}/#match/${match_id}` : null,
        participants: credentials,
        rounds: rounds.map(({ round_id, index, execution_order }) => ({
          round_id,
          index,
          execution_order,
        })),
      };
    });
  }
  private startRun(a: Record<string, unknown>, actor: Actor) {
    return this.store.transaction(() => {
      const cred = this.store.get<Credential>('tokens', hashToken(a.participant_token as string));
      const m = this.store.get<Match>('matches', a.match_id as string);
      if (
        !m ||
        !cred ||
        cred.purpose !== 'participant' ||
        cred.used ||
        Date.parse(cred.expires_at) <= Date.now() ||
        cred.match_id !== a.match_id ||
        cred.participant_id !== a.participant_id ||
        cred.round_id !== a.round_id
      )
        throw new DomainError(
          'unauthorized',
          'Participant token is invalid, expired, or already used.',
        );
      if (m.ranked && (actor.id !== m.owner_id || !['runner', 'admin'].includes(actor.role)))
        throw new DomainError(
          'unauthorized',
          'Only the authenticated match runner may start ranked participants.',
        );
      const round = m.rounds.find((r) => r.round_id === a.round_id)!;
      const existing = this.store.list<Run>('runs', { match_id: m.match_id }, 200);
      if (
        round.index > 0 &&
        m.rounds
          .slice(0, round.index)
          .some(
            (r) =>
              existing.filter((run) => run.round_id === r.round_id && run.status === 'finished')
                .length !== m.entrant_count,
          )
      )
        throw new DomainError(
          'unauthorized',
          'Complete earlier rounds before starting this trial.',
        );
      // Preissued later-round tickets are dormant until all earlier rounds finish.
      const eligibleAt =
        round.index === 0
          ? Date.parse(m.created_at)
          : Math.max(
              ...existing
                .filter((run) => run.round_id === m.rounds[round.index - 1]!.round_id)
                .map((run) => Date.parse(run.finished_at!)),
            );
      if (Date.now() >= eligibleAt + START_WINDOW_MS)
        throw new DomainError(
          'unauthorized',
          'The one-hour start window for this round has expired.',
        );
      if (
        existing.some((r) => r.participant_id === a.participant_id && r.round_id === round.round_id)
      )
        throw new DomainError('unauthorized', 'This participant already started the round.');
      const metadata = metadataSchema.parse(a.metadata);
      metadata.mcp_client_identity = actor.clientIdentity ?? metadata.mcp_client_identity;
      const run: Run = {
        run_id: randomUUID(),
        match_id: m.match_id,
        participant_id: a.participant_id as string,
        round_id: round.round_id,
        actor,
        league: m.league,
        size: m.size,
        state: structuredClone(round.state),
        initial_state: structuredClone(round.state),
        scramble: round.scramble,
        seed: round.seed,
        status: 'active',
        failure: null,
        started_at: new Date().toISOString(),
        started_mono: this.clock(),
        finished_at: null,
        elapsed_ms: 0,
        first_move_ms: null,
        accepted: [],
        tool_call_count: 1,
        timeline: [],
        attempts: [],
        metadata,
        trusted_usage: null,
        verification: m.ranked ? 'verified' : 'community',
        limits: m.limits,
        result_id: null,
      };
      run.timeline.push({
        index: 1,
        tool: 'cubebench_start_run',
        received_at: run.started_at,
        elapsed_ms: 0,
        duration_ms: 0,
        outcome: 'started',
      });
      this.store.put(
        'tokens',
        cred.hash,
        { ...cred, used: true },
        { match_id: m.match_id, participant_id: run.participant_id },
      );
      const run_token = randomBytes(32).toString('base64url');
      this.store.insert(
        'tokens',
        hashToken(run_token),
        {
          hash: hashToken(run_token),
          actor,
          expires_at: new Date(Date.now() + m.limits.time_ms + 3600000).toISOString(),
          purpose: 'run',
          match_id: m.match_id,
          participant_id: run.participant_id,
          round_id: round.round_id,
          run_id: run.run_id,
        } satisfies Credential,
        { match_id: m.match_id, participant_id: run.participant_id },
      );
      m.status = 'active';
      m.participants.find((p) => p.participant_id === run.participant_id)!.display_name =
        metadata.display_name;
      this.saveMatch(m);
      this.saveRun(run);
      this.emit(m, run, 'run_started');
      return {
        ok: true,
        run: this.view(run),
        run_token,
        instructions: LEAGUE_INSTRUCTIONS[m.league],
        limits: m.limits,
      };
    });
  }
  private authorizeRun(a: Record<string, unknown>, actor: Actor): Run {
    const cred =
      typeof a.run_token === 'string'
        ? this.store.get<Credential>('tokens', hashToken(a.run_token))
        : undefined;
    const run = typeof a.run_id === 'string' ? this.store.get<Run>('runs', a.run_id) : undefined;
    if (
      !cred ||
      cred.purpose !== 'run' ||
      Date.parse(cred.expires_at) <= Date.now() ||
      !run ||
      cred.run_id !== run.run_id ||
      a.match_id !== run.match_id ||
      a.participant_id !== run.participant_id ||
      cred.actor.id !== actor.id
    )
      throw new DomainError('unauthorized', 'Run credentials or explicit identifiers are invalid.');
    return run;
  }
  private rejectMalformed(name: ToolName, args: unknown, actor: Actor) {
    if (
      !name.includes('_run') &&
      !['cubebench_apply_moves', 'cubebench_submit_solution'].includes(name)
    )
      return;
    if (!args || typeof args !== 'object') return;
    try {
      this.store.transaction(() => {
        const run = this.authorizeRun(args as Record<string, unknown>, actor);
        if (run.status === 'finished') return;
        this.beginCall(run, name);
        const m = this.store.get<Match>('matches', run.match_id)!;
        run.attempts.push({
          call_index: run.tool_call_count,
          sequence:
            typeof (args as Record<string, unknown>).sequence === 'string'
              ? ((args as Record<string, unknown>).sequence as string).slice(0, 60000)
              : '[malformed arguments]',
          accepted: [],
          rejected: ['[malformed arguments]'],
          failure: 'malformed_tool_arguments',
        });
        this.finish(
          m,
          run,
          this.expired(run)
            ? 'timeout'
            : run.tool_call_count > run.limits.tool_calls
              ? 'tool_call_limit_exceeded'
              : 'malformed_tool_arguments',
        );
      });
    } catch {
      /* Unattributable malformed calls never affect another run. */
    }
  }
  private beginCall(run: Run, name: string) {
    run.tool_call_count++;
    run.timeline.push({
      index: run.tool_call_count,
      tool: name,
      received_at: new Date().toISOString(),
      elapsed_ms: this.elapsed(run),
      duration_ms: 0,
      outcome: 'received',
    });
  }
  private elapsed(run: Run) {
    return run.status === 'finished'
      ? run.elapsed_ms
      : Math.max(0, this.clock() - run.started_mono);
  }
  private expired(run: Run) {
    return this.elapsed(run) >= run.limits.time_ms;
  }
  private runTool(name: ToolName, a: Record<string, unknown>, actor: Actor) {
    return this.store.transaction(() => {
      const run = this.authorizeRun(a, actor);
      const m = this.store.get<Match>('matches', run.match_id)!;
      if (run.status === 'finished') {
        if (name === 'cubebench_get_run') return { ok: true, run: this.view(run) };
        return failure(
          'unauthorized',
          'Attempt has ended. It cannot be submitted, reset, or restarted.',
        );
      }
      this.beginCall(run, name);
      if (this.expired(run) || run.tool_call_count > run.limits.tool_calls) {
        this.finish(m, run, this.expired(run) ? 'timeout' : 'tool_call_limit_exceeded');
        return name === 'cubebench_get_run' || name === 'cubebench_abandon_run'
          ? { ok: true, run: this.view(run) }
          : { ok: true, run: this.view(run), accepted_moves: [], result: this.result(run) };
      }
      if (name === 'cubebench_get_run') {
        this.completeCall(run, 'read');
        this.emit(m, run, 'budget_updated');
        this.saveRun(run);
        return { ok: true, run: this.view(run) };
      }
      if (name === 'cubebench_extend_timeout') {
        if (run.verification === 'verified' || m.ranked) {
          this.completeCall(run, 'unauthorized');
          this.emit(m, run, 'budget_updated');
          this.saveRun(run);
          return failure(
            'unauthorized',
            'Timeout extensions are available only for community runs.',
          );
        }
        const requested = a.additional_time_ms as number;
        const nextLimit = Math.min(MAX_RUN_TIME_MS, run.limits.time_ms + requested);
        if (nextLimit === run.limits.time_ms) {
          this.completeCall(run, 'timeout_extension_rejected');
          this.emit(m, run, 'budget_updated');
          this.saveRun(run);
          return failure(
            'malformed_tool_arguments',
            'The run already has the maximum one-hour timeout.',
          );
        }
        run.limits = { ...run.limits, time_ms: nextLimit };
        this.completeCall(run, `timeout_extended_to_${nextLimit}ms`);
        this.emit(m, run, 'budget_updated');
        this.saveRun(run);
        return { ok: true, run: this.view(run) };
      }
      if (name === 'cubebench_abandon_run') {
        this.finish(m, run, 'abandoned');
        return { ok: true, run: this.view(run) };
      }
      if ((name === 'cubebench_submit_solution') !== (run.league === 'sprint')) {
        this.completeCall(run, 'unauthorized');
        this.emit(m, run, 'budget_updated');
        this.saveRun(run);
        return failure(
          'unauthorized',
          `This is ${run.league} League. ${LEAGUE_INSTRUCTIONS[run.league]}`,
        );
      }
      if (a.trusted_usage !== undefined) {
        if (run.verification !== 'verified' || !['runner', 'admin'].includes(run.actor.role)) {
          this.completeCall(run, 'unauthorized');
          this.emit(m, run, 'budget_updated');
          this.saveRun(run);
          return failure('unauthorized', 'Only verified runner attempts may report trusted usage.');
        }
        // Reports are cumulative totals for this run, not per-batch increments.
        run.trusted_usage = a.trusted_usage as NonNullable<ResultRecord['trusted_usage']>;
      }
      const sequence = a.sequence as string;
      const tokens = sequence.trim() ? sequence.trim().split(/\s+/u) : [];
      const attempt: ResultRecord['attempts'][number] = {
        call_index: run.tool_call_count,
        sequence,
        accepted: [],
        rejected: [],
        failure: null,
      };
      run.attempts.push(attempt);
      this.emit(m, run, 'move_batch_received');
      let moves: Move[];
      if (run.league === 'sprint') {
        try {
          moves = parseMoves(sequence, run.size);
        } catch (e) {
          attempt.failure = this.notationFailure(e);
          attempt.rejected = tokens;
          this.emit(m, run, 'move_rejected');
          this.finish(m, run, attempt.failure);
          return { ok: true, run: this.view(run), accepted_moves: [], result: this.result(run) };
        }
        if (run.accepted.length + moves.length > run.limits.moves) {
          attempt.failure = 'move_limit_exceeded';
          attempt.rejected = tokens;
          this.finish(m, run, attempt.failure);
          return { ok: true, run: this.view(run), accepted_moves: [], result: this.result(run) };
        }
        // Prevalidate the entire sequence and compute its final state before recording any moves.
        const finalState = applyMoves(run.state, moves);
        for (const move of moves) {
          run.state = applyMoves(run.state, [move]);
          this.accept(m, run, attempt, move);
        }
        run.state = finalState;
        this.emit(m, run, 'cube_state_updated');
        const solved = isSolved(run.state);
        const verifiedElapsed = this.elapsed(run);
        this.finish(
          m,
          run,
          verifiedElapsed >= run.limits.time_ms
            ? 'timeout'
            : solved
              ? 'solved'
              : 'unsolved_submission',
          verifiedElapsed,
        );
      } else {
        for (let index = 0; index < tokens.length; index++) {
          if (this.expired(run)) {
            attempt.failure = 'timeout';
            attempt.rejected = tokens.slice(index);
            break;
          }
          if (run.accepted.length >= run.limits.moves) {
            attempt.failure = 'move_limit_exceeded';
            attempt.rejected = tokens.slice(index);
            break;
          }
          try {
            const move = parseMoves(tokens[index]!, run.size)[0]!;
            run.state = applyMoves(run.state, [move]);
            this.accept(m, run, attempt, move);
          } catch (e) {
            attempt.failure = this.notationFailure(e);
            attempt.rejected = tokens.slice(index);
            this.emit(m, run, 'move_rejected', tokens[index]!);
            break;
          }
          if (isSolved(run.state)) {
            if (index + 1 < tokens.length) attempt.rejected = tokens.slice(index + 1);
            const verifiedElapsed = this.elapsed(run);
            this.finish(
              m,
              run,
              verifiedElapsed >= run.limits.time_ms ? 'timeout' : 'solved',
              verifiedElapsed,
            );
            break;
          }
        }
        if (run.status === 'active') {
          this.emit(m, run, 'cube_state_updated');
          if (attempt.failure) this.finish(m, run, attempt.failure);
          else if (run.accepted.length >= run.limits.moves)
            this.finish(m, run, 'move_limit_exceeded');
          else if (run.tool_call_count >= run.limits.tool_calls)
            this.finish(m, run, 'tool_call_limit_exceeded');
          else {
            this.completeCall(run, 'accepted');
            this.emit(m, run, 'budget_updated');
            this.saveRun(run);
          }
        }
      }
      return {
        ok: true,
        run: this.view(run),
        accepted_moves: attempt.accepted,
        result: this.result(run),
      };
    });
  }
  private notationFailure(error: unknown): Failure {
    return error &&
      typeof error === 'object' &&
      'category' in error &&
      error.category === 'illegal_move_for_cube_size'
      ? 'illegal_move_for_cube_size'
      : 'invalid_notation';
  }
  private accept(m: Match, run: Run, attempt: ResultRecord['attempts'][number], move: Move) {
    if (run.first_move_ms === null) run.first_move_ms = this.elapsed(run);
    run.accepted.push(move.notation);
    attempt.accepted.push(move.notation);
    this.emit(m, run, 'move_accepted', move.notation);
  }
  private completeCall(run: Run, outcome: string) {
    const call = run.timeline.at(-1);
    if (call) {
      call.duration_ms = Math.max(0, this.elapsed(run) - call.elapsed_ms);
      call.outcome = outcome;
    }
  }
  private finish(m: Match, run: Run, category: Failure, elapsedMs = this.elapsed(run)) {
    if (run.status === 'finished') return;
    run.elapsed_ms = elapsedMs;
    run.status = 'finished';
    run.failure = category;
    run.finished_at = new Date().toISOString();
    this.completeCall(run, category);
    const event = this.emit(
      m,
      run,
      category === 'solved'
        ? 'cube_solved'
        : category === 'abandoned'
          ? 'run_abandoned'
          : 'run_failed',
    );
    const unsigned: Omit<ResultRecord, 'signature'> = {
      result_id: randomUUID(),
      match_id: run.match_id,
      round_id: run.round_id,
      participant_id: run.participant_id,
      run_id: run.run_id,
      league: run.league,
      classification: m.warmup ? 'practice' : m.ranked ? 'ranked' : 'community',
      verification: run.verification,
      submitter_identity: run.actor.id,
      runner_identity: run.verification === 'verified' ? run.actor.id : null,
      size: run.size,
      seed: run.seed,
      scramble: run.scramble,
      initial_state: run.initial_state,
      final_state: run.state,
      versions: VERSIONS,
      attempts: run.attempts,
      timeline: run.timeline,
      started_at: run.started_at,
      finished_at: run.finished_at,
      elapsed_ms: run.elapsed_ms,
      time_to_first_move_ms: run.first_move_ms,
      move_count: run.accepted.length,
      tool_call_count: run.tool_call_count,
      success: category === 'solved',
      failure: category,
      metadata: run.metadata,
      trusted_usage: run.trusted_usage ?? null,
      event_hash: event.hash,
      signing_key_id: this.signer.keyId,
    };
    const result: ResultRecord = { ...unsigned, signature: this.signer.sign(unsigned) };
    this.store.insert('results', result.result_id, result, {
      match_id: m.match_id,
      participant_id: run.participant_id,
      league: run.league,
      size: run.size,
      classification: result.classification,
      owner_id: m.owner_id,
      status: category,
    });
    run.result_id = result.result_id;
    this.saveRun(run);
    const all = this.store.list<Run>('runs', { match_id: m.match_id }, 200);
    const roundRuns = all.filter((candidate) => candidate.round_id === run.round_id);
    if (
      roundRuns.length === m.entrant_count &&
      roundRuns.every((candidate) => candidate.status === 'finished')
    ) {
      for (const candidate of roundRuns) this.emit(m, candidate, 'scramble_revealed');
    }
    if (
      all.length === m.entrant_count * m.trial_count &&
      all.every((r) => r.status === 'finished')
    ) {
      m.status = 'completed';
      this.saveMatch(m);
      this.emit(m, null, 'match_completed');
    }
  }
  private result(run: Run) {
    if (this.store.get<Match>('matches', run.match_id)?.status !== 'completed') return null;
    return run.result_id ? (this.store.get<ResultRecord>('results', run.result_id) ?? null) : null;
  }
  verifyResult(result: ResultRecord) {
    const { signature, ...unsigned } = result;
    return this.signer.verify(unsigned, signature);
  }
  private saveMatch(m: Match) {
    this.store.put('matches', m.match_id, m, {
      owner_id: m.owner_id,
      status: m.status,
      league: m.league,
      size: m.size,
      created_at: m.created_at,
    });
  }
  private saveRun(run: Run) {
    if (run.status === 'active') run.elapsed_ms = this.elapsed(run);
    this.store.put('runs', run.run_id, run, {
      match_id: run.match_id,
      participant_id: run.participant_id,
      status: run.status,
      owner_id: run.actor.id,
      league: run.league,
      size: run.size,
      created_at: run.started_at,
    });
  }
  private emit(
    m: Match,
    run: Run | null,
    type: CubeEvent['type'],
    move: string | null = null,
  ): CubeEvent {
    const previous = this.store.lastEvent(m.match_id) as CubeEvent | undefined;
    return this.store.appendEvent(m.match_id, run?.round_id ?? null, (id) => {
      const body: Omit<CubeEvent, 'hash'> = {
        id,
        match_id: m.match_id,
        run_id: run?.run_id ?? null,
        round_id: run?.round_id ?? null,
        type,
        at: new Date().toISOString(),
        elapsed_ms: run ? this.elapsed(run) : 0,
        move,
        state: run ? structuredClone(run.state) : null,
        run:
          run && type !== 'move_accepted' && type !== 'move_batch_received' ? this.view(run) : null,
        previous_hash: previous?.hash ?? '0'.repeat(64),
      };
      return { ...body, hash: digest(body) };
    }) as CubeEvent;
  }
  private scrambleRevealed(run: Run): boolean {
    const match = this.store.get<Match>('matches', run.match_id);
    if (!match) return false;
    if (match.status === 'completed') return true;
    const roundRuns = this.store
      .list<Run>('runs', { match_id: run.match_id }, 200)
      .filter((candidate) => candidate.round_id === run.round_id);
    return (
      roundRuns.length === match.entrant_count &&
      roundRuns.every((candidate) => candidate.status === 'finished')
    );
  }
  private view(run: Run): RunView {
    return {
      run_id: run.run_id,
      match_id: run.match_id,
      round_id: run.round_id,
      participant_id: run.participant_id,
      league: run.league,
      size: run.size,
      status: run.status,
      failure: run.failure,
      state: structuredClone(run.state),
      scramble: this.scrambleRevealed(run) ? run.scramble : null,
      previous_accepted_moves: [...run.accepted],
      move_count: run.accepted.length,
      tool_call_count: run.tool_call_count,
      elapsed_ms: this.elapsed(run),
      remaining: {
        time_ms: Math.max(0, run.limits.time_ms - this.elapsed(run)),
        moves: Math.max(0, run.limits.moves - run.accepted.length),
        tool_calls: Math.max(0, run.limits.tool_calls - run.tool_call_count),
      },
      solved: isSolved(run.state),
      versions: VERSIONS,
      face_order: ['U', 'R', 'F', 'D', 'L', 'B'],
      color_scheme: COLOR_SCHEME,
      metadata: run.metadata,
      verification: run.verification,
      started_at: run.started_at,
      finished_at: run.finished_at,
    };
  }
  private roundRevealed(m: Match, round_id: string, runs: Run[]) {
    return (
      m.status === 'completed' ||
      runs.filter((r) => r.round_id === round_id).length === m.entrant_count
    );
  }
  getMatch(matchId: string, actor?: Actor): MatchView {
    const m = this.requireMatch(matchId, actor);
    const runs = this.store.list<Run>('runs', { match_id: matchId }, 200);
    return {
      match_id: m.match_id,
      league: m.league,
      size: m.size,
      entrant_count: m.entrant_count,
      trial_count: m.trial_count,
      ranked: m.ranked,
      warmup: m.warmup,
      visibility: m.visibility,
      status: m.status,
      created_at: m.created_at,
      limits: m.limits,
      rounds: m.rounds.map((r) => ({
        round_id: r.round_id,
        index: r.index,
        revealed: this.roundRevealed(m, r.round_id, runs),
        execution_order: r.execution_order,
      })),
      participants: m.participants,
      runs: runs.filter((r) => this.roundRevealed(m, r.round_id, runs)).map((r) => this.view(r)),
    };
  }
  getPublicMatches(): MatchView[] {
    return this.store
      .list<Match>('matches', {}, 100)
      .filter((m) => m.visibility === 'public')
      .map((m) => this.getMatch(m.match_id));
  }
  getEvents(matchId: string, after = 0, actor?: Actor): CubeEvent[] {
    const m = this.requireMatch(matchId, actor);
    const runs = this.store.list<Run>('runs', { match_id: matchId }, 200);
    const events = this.store.events(matchId, after, 1000) as CubeEvent[];
    // Stop at the first hidden event, retaining its cursor until reveal; never skip and lose history.
    const hidden = events.findIndex(
      (e) => e.round_id !== null && !this.roundRevealed(m, e.round_id, runs),
    );
    return hidden < 0 ? events : events.slice(0, hidden);
  }
  getPublicRun(runId: string): { run: RunView; events: CubeEvent[] } {
    const r = this.store.get<Run>('runs', runId);
    if (!r) throw new DomainError('unauthorized', 'Run is unavailable.');
    const m = this.requireMatch(r.match_id);
    const runs = this.store.list<Run>('runs', { match_id: r.match_id }, 200);
    if (!this.roundRevealed(m, r.round_id, runs))
      throw new DomainError('unauthorized', 'Round has not been revealed to spectators.');
    const events: CubeEvent[] = [];
    let cursor = 0;
    while (true) {
      const page = this.getEvents(r.match_id, cursor);
      events.push(...page.filter((e) => e.run_id === runId));
      if (page.length < 1000) break;
      cursor = page.at(-1)!.id;
    }
    return { run: this.view(r), events };
  }
  getPublicResults(
    league?: 'sprint' | 'live',
    resultClass?: 'verified' | 'community',
    size?: number,
  ): ResultRecord[] {
    const index: Record<string, string | number> = {};
    if (league) index.league = league;
    if (size) index.size = size;
    if (resultClass) index.classification = resultClass === 'verified' ? 'ranked' : 'community';
    return this.store.list<ResultRecord>('results', index, Number.MAX_SAFE_INTEGER).filter((r) => {
      const m = this.store.get<Match>('matches', r.match_id);
      return (
        m?.visibility === 'public' &&
        m.status === 'completed' &&
        r.classification !== 'practice' &&
        (!resultClass || r.verification === (resultClass === 'verified' ? 'verified' : 'community'))
      );
    });
  }
  private leaderboard(
    league: 'sprint' | 'live',
    resultClass: 'verified' | 'community',
    size: number,
    limit = 25,
  ) {
    const records = this.getPublicResults(league, resultClass, size);
    const groups = new Map<string, ResultRecord[]>();
    for (const r of records) {
      const key = digest({
        submitter: r.submitter_identity,
        runner: r.runner_identity,
        metadata: r.metadata,
      });
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const rows = [...groups.entries()]
      .map(([identity_key, results]) => {
        const successes = results
          .filter((r) => r.success)
          .sort((a, b) => a.elapsed_ms - b.elapsed_ms);
        const times = successes.map((r) => r.elapsed_ms);
        const mid = Math.floor(times.length / 2);
        return {
          competitor: results[0]!.metadata.display_name,
          model_id: results[0]!.metadata.model_id ?? 'unspecified',
          claimed_provider: results[0]!.metadata.claimed_provider ?? 'unspecified',
          claimed_model: results[0]!.metadata.claimed_model ?? 'unspecified',
          model_snapshot: results[0]!.metadata.model_snapshot ?? null,
          harness_name: results[0]!.metadata.harness_name ?? 'unspecified',
          harness_version: results[0]!.metadata.harness_version ?? 'unspecified',
          mcp_client_identity: results[0]!.metadata.mcp_client_identity ?? 'unspecified',
          identity_key,
          attempts: results.length,
          completed: successes.length,
          completion_rate: successes.length / results.length,
          median_ms: times.length
            ? times.length % 2
              ? times[mid]!
              : (times[mid - 1]! + times[mid]!) / 2
            : null,
          mean_ms: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
          minimum_ms: times[0] ?? null,
          maximum_ms: times.at(-1) ?? null,
          best_run_id: successes[0]?.run_id ?? null,
        };
      })
      .sort(
        (a, b) =>
          b.completion_rate - a.completion_rate ||
          (a.median_ms ?? Infinity) - (b.median_ms ?? Infinity) ||
          a.identity_key.localeCompare(b.identity_key),
      )
      .slice(0, limit);
    return { ok: true, league, result_class: resultClass, size, rows };
  }
  exportResults(matchId: string, actor: Actor, format: 'json' | 'csv'): string {
    const m = this.requireMatch(matchId, actor, true);
    if (m.status !== 'completed')
      throw new DomainError('unauthorized', 'Export is available after all trials finish.');
    const results = this.store.list<ResultRecord>('results', { match_id: matchId }, 200);
    if (format === 'json')
      return JSON.stringify(
        { export_version: '1.0.0', public_key: this.publicKey, results },
        null,
        2,
      );
    const headers = [
      'export_version',
      'result_id',
      'match_id',
      'round_id',
      'participant_id',
      'run_id',
      'league',
      'classification',
      'verification',
      'size',
      'elapsed_ms',
      'move_count',
      'tool_call_count',
      'success',
      'failure',
      'display_name',
      'signature',
      'record_json',
    ];
    const cell = (value: unknown) => {
      const raw = String(value ?? '');
      const safe = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    return (
      [
        headers,
        ...results.map((r) => [
          '1.0.0',
          r.result_id,
          r.match_id,
          r.round_id,
          r.participant_id,
          r.run_id,
          r.league,
          r.classification,
          r.verification,
          r.size,
          r.elapsed_ms,
          r.move_count,
          r.tool_call_count,
          r.success,
          r.failure,
          r.metadata.display_name,
          r.signature,
          JSON.stringify(r),
        ]),
      ]
        .map((row) => row.map(cell).join(','))
        .join('\r\n') + '\r\n'
    );
  }
  sweep() {
    this.store.transaction(() => {
      for (const r of this.store.list<Run>('runs', { status: 'active' }, Number.MAX_SAFE_INTEGER)) {
        if (this.expired(r))
          this.finish(this.store.get<Match>('matches', r.match_id)!, r, 'timeout');
      }
      for (const m of this.store.list<Match>('matches', {}, Number.MAX_SAFE_INTEGER)) {
        if (
          m.status !== 'completed' &&
          Date.parse(m.expires_at) <= Date.now() &&
          !this.store
            .list<Run>('runs', { match_id: m.match_id }, 200)
            .some((r) => r.status === 'active')
        ) {
          m.status = 'completed';
          this.saveMatch(m);
          this.emit(m, null, 'match_completed');
        }
      }
    });
  }
  recoverInterrupted() {
    this.store.transaction(() => {
      for (const r of this.store.list<Run>('runs', { status: 'active' }, Number.MAX_SAFE_INTEGER)) {
        // No cross-process monotonic clock reconstruction; interruption is a failure, never a rank.
        r.started_mono = this.clock() - r.elapsed_ms;
        this.finish(this.store.get<Match>('matches', r.match_id)!, r, 'disconnected');
      }
    });
  }
  close() {
    /* Repository lifecycle belongs to the service host. */
  }
}
