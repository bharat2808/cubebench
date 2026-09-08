import { z } from 'zod';

export const VERSIONS = {
  schema: '1.0.0',
  engine: '1.0.0',
  notation: '1.0.0',
  generator: '1.0.0',
  prompt: '1.0.0',
  format: '1.0.0',
} as const;
export const faceSchema = z.enum(['U', 'R', 'F', 'D', 'L', 'B']);
export const cubeSchema = z.strictObject({
  size: z.number().int().min(2).max(20),
  facelets: z.strictObject({
    U: z.array(faceSchema),
    R: z.array(faceSchema),
    F: z.array(faceSchema),
    D: z.array(faceSchema),
    L: z.array(faceSchema),
    B: z.array(faceSchema),
  }),
});
export const leagueSchema = z.enum(['sprint', 'live']);
export const failureSchema = z.enum([
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
]);
export type Failure = z.infer<typeof failureSchema>;
export const metadataSchema = z.strictObject({
  display_name: z.string().min(1).max(80),
  claimed_provider: z.string().max(80).default('unspecified'),
  claimed_model: z.string().max(160).default('unspecified'),
  model_snapshot: z.string().max(160).nullable().default(null),
  harness_name: z.string().max(80).default('unspecified'),
  harness_version: z.string().max(80).default('unspecified'),
  reasoning_effort: z.string().max(80).nullable().default(null),
  system_prompt_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .default(null),
  mcp_client_identity: z.string().max(160).default('unspecified'),
});
export type CompetitorMetadata = z.infer<typeof metadataSchema>;
export const limitsSchema = z.strictObject({
  time_ms: z.number().int().min(1000).max(3600000).default(300000),
  moves: z.number().int().min(1).max(10000).default(1000),
  tool_calls: z.number().int().min(2).max(2000).default(200),
});
export type Limits = z.infer<typeof limitsSchema>;
export const versionsSchema = z.strictObject({
  schema: z.string(),
  engine: z.string(),
  notation: z.string(),
  generator: z.string(),
  prompt: z.string(),
  format: z.string(),
});
export const remainingSchema = z.strictObject({
  time_ms: z.number().min(0),
  moves: z.number().int().min(0),
  tool_calls: z.number().int().min(0),
});
export const runViewSchema = z.strictObject({
  run_id: z.string(),
  match_id: z.string(),
  round_id: z.string(),
  participant_id: z.string(),
  league: leagueSchema,
  size: z.number().int(),
  status: z.enum(['active', 'finished']),
  failure: failureSchema.nullable(),
  state: cubeSchema,
  scramble: z.string(),
  previous_accepted_moves: z.array(z.string()),
  move_count: z.number().int(),
  tool_call_count: z.number().int(),
  elapsed_ms: z.number().min(0),
  remaining: remainingSchema,
  solved: z.boolean(),
  versions: versionsSchema,
  face_order: z.tuple([
    z.literal('U'),
    z.literal('R'),
    z.literal('F'),
    z.literal('D'),
    z.literal('L'),
    z.literal('B'),
  ]),
  color_scheme: z.strictObject({
    U: z.string(),
    R: z.string(),
    F: z.string(),
    D: z.string(),
    L: z.string(),
    B: z.string(),
  }),
  metadata: metadataSchema,
  verification: z.enum(['verified', 'community']),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});
export type RunView = z.infer<typeof runViewSchema>;
export const publicRunSchema = runViewSchema
  .omit({ scramble: true })
  .extend({ scramble: z.string().nullable() });
export const matchViewSchema = z.strictObject({
  match_id: z.string(),
  league: leagueSchema,
  size: z.number().int(),
  entrant_count: z.number().int(),
  trial_count: z.number().int(),
  ranked: z.boolean(),
  warmup: z.boolean(),
  visibility: z.enum(['public', 'private']),
  status: z.enum(['waiting', 'active', 'completed']),
  created_at: z.string(),
  limits: limitsSchema,
  rounds: z.array(
    z.strictObject({
      round_id: z.string(),
      index: z.number().int(),
      revealed: z.boolean(),
      execution_order: z.array(z.string()),
    }),
  ),
  participants: z.array(z.strictObject({ participant_id: z.string(), display_name: z.string() })),
  runs: z.array(publicRunSchema),
});
export type MatchView = z.infer<typeof matchViewSchema>;
export const callSchema = z.strictObject({
  index: z.number().int(),
  tool: z.string(),
  received_at: z.string(),
  elapsed_ms: z.number().min(0),
  duration_ms: z.number().min(0),
  outcome: z.string(),
});
export const attemptSchema = z.strictObject({
  call_index: z.number().int(),
  sequence: z.string(),
  accepted: z.array(z.string()),
  rejected: z.array(z.string()),
  failure: failureSchema.nullable(),
});
export const trustedUsageSchema = z.strictObject({
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cost_usd: z.number().min(0),
});
export const resultSchema = z.strictObject({
  result_id: z.string(),
  match_id: z.string(),
  round_id: z.string(),
  participant_id: z.string(),
  run_id: z.string(),
  league: leagueSchema,
  classification: z.enum(['ranked', 'community', 'practice']),
  verification: z.enum(['verified', 'community']),
  submitter_identity: z.string(),
  runner_identity: z.string().nullable(),
  size: z.number().int(),
  seed: z.string(),
  scramble: z.string(),
  initial_state: cubeSchema,
  final_state: cubeSchema,
  versions: versionsSchema,
  attempts: z.array(attemptSchema),
  timeline: z.array(callSchema),
  started_at: z.string(),
  finished_at: z.string(),
  elapsed_ms: z.number().min(0),
  time_to_first_move_ms: z.number().min(0).nullable(),
  move_count: z.number().int(),
  tool_call_count: z.number().int(),
  success: z.boolean(),
  failure: failureSchema,
  metadata: metadataSchema,
  trusted_usage: trustedUsageSchema.nullable(),
  event_hash: z.string(),
  signature: z.string(),
  signing_key_id: z.string(),
});
export type ResultRecord = z.infer<typeof resultSchema>;
export const leaderboardRowSchema = z.strictObject({
  competitor: z.string(),
  identity_key: z.string(),
  attempts: z.number().int(),
  completed: z.number().int(),
  completion_rate: z.number(),
  median_ms: z.number().nullable(),
  mean_ms: z.number().nullable(),
  minimum_ms: z.number().nullable(),
  maximum_ms: z.number().nullable(),
  best_run_id: z.string().nullable(),
});
export const eventSchema = z.strictObject({
  id: z.number().int(),
  match_id: z.string(),
  run_id: z.string().nullable(),
  round_id: z.string().nullable(),
  type: z.enum([
    'match_created',
    'run_started',
    'scramble_revealed',
    'move_batch_received',
    'move_accepted',
    'move_rejected',
    'cube_state_updated',
    'budget_updated',
    'cube_solved',
    'run_failed',
    'run_abandoned',
    'match_completed',
  ]),
  at: z.string(),
  elapsed_ms: z.number(),
  move: z.string().nullable(),
  state: cubeSchema.nullable(),
  run: runViewSchema.nullable(),
  previous_hash: z.string(),
  hash: z.string(),
});
export type CubeEvent = z.infer<typeof eventSchema>;
const id = z.string().uuid();
const token = z.string().min(20).max(256);
export const runArgs = { match_id: id, participant_id: id, run_id: id, run_token: token };
export const createMatchSchema = z.strictObject({
  league: leagueSchema,
  size: z.number().int().min(2).max(7),
  entrant_count: z.number().int().min(1).max(8).default(1),
  trial_count: z.number().int().min(1).max(20).default(1),
  ranked: z.boolean().default(false),
  warmup: z.boolean().default(false),
  visibility: z.enum(['public', 'private']).default('public'),
  limits: limitsSchema.default({ time_ms: 300000, moves: 1000, tool_calls: 200 }),
});
export type CreateMatchInput = z.input<typeof createMatchSchema>;
export const errorSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({ category: failureSchema, message: z.string() }),
});
const success = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject({ ok: z.literal(true), ...shape });
const formats = z.array(
  z.strictObject({
    id: z.string(),
    version: z.string(),
    league: leagueSchema,
    sizes: z.array(z.number()),
    metric: z.literal('verified_wall_clock_ms'),
  }),
);
export const toolInputs = {
  cubebench_get_rules: z.strictObject({}),
  cubebench_list_formats: z.strictObject({}),
  cubebench_create_match: createMatchSchema,
  cubebench_start_run: z.strictObject({
    match_id: id,
    participant_id: id,
    round_id: id,
    participant_token: token,
    metadata: metadataSchema,
  }),
  cubebench_submit_solution: z.strictObject({
    ...runArgs,
    sequence: z.string().max(60000),
    trusted_usage: trustedUsageSchema.optional(),
  }),
  cubebench_apply_moves: z.strictObject({
    ...runArgs,
    sequence: z.string().min(1).max(256),
    trusted_usage: trustedUsageSchema.optional(),
  }),
  cubebench_get_run: z.strictObject(runArgs),
  cubebench_abandon_run: z.strictObject(runArgs),
  cubebench_get_match: z.strictObject({ match_id: id }),
  cubebench_get_results: z.strictObject({ match_id: id }),
  cubebench_get_leaderboard: z.strictObject({
    league: leagueSchema,
    result_class: z.enum(['verified', 'community']),
    size: z.number().int().min(2).max(7),
    limit: z.number().int().min(1).max(100).default(25),
  }),
} as const;
const rules = success({
  versions: versionsSchema,
  leagues: z.array(z.strictObject({ id: leagueSchema, instructions: z.string() })),
  notation: z.string(),
  sizes: z.array(z.number()),
  maximum_size: z.number(),
  limits: limitsSchema,
  scoring: z.string(),
  failures: z.array(failureSchema),
  fairness: z.string(),
});
export const toolSuccessOutputs = {
  cubebench_get_rules: rules,
  cubebench_list_formats: success({ formats }),
  cubebench_create_match: success({
    match_id: id,
    participants: z.array(
      z.strictObject({
        participant_id: id,
        tokens: z.array(
          z.strictObject({ round_id: id, participant_token: token, expires_at: z.string() }),
        ),
      }),
    ),
    rounds: z.array(
      z.strictObject({ round_id: id, index: z.number(), execution_order: z.array(id) }),
    ),
  }),
  cubebench_start_run: success({
    run: runViewSchema,
    run_token: token,
    instructions: z.string(),
    limits: limitsSchema,
  }),
  cubebench_submit_solution: success({
    run: runViewSchema,
    accepted_moves: z.array(z.string()),
    result: resultSchema.nullable(),
  }),
  cubebench_apply_moves: success({
    run: runViewSchema,
    accepted_moves: z.array(z.string()),
    result: resultSchema.nullable(),
  }),
  cubebench_get_run: success({ run: runViewSchema }),
  cubebench_abandon_run: success({ run: runViewSchema }),
  cubebench_get_match: success({ match: matchViewSchema }),
  cubebench_get_results: success({
    results: z.array(resultSchema),
    public_key: z.string(),
    export_version: z.literal('1.0.0'),
  }),
  cubebench_get_leaderboard: success({
    league: leagueSchema,
    result_class: z.enum(['verified', 'community']),
    size: z.number(),
    rows: z.array(leaderboardRowSchema),
  }),
} as const;
export type ToolName = keyof typeof toolInputs;
export const TOOL_ORDER = Object.keys(toolInputs) as ToolName[];
export const toolOutput = (name: ToolName) => z.union([toolSuccessOutputs[name], errorSchema]);
export const descriptions: Record<ToolName, string> = {
  cubebench_get_rules: 'Read league rules and notation before entering. No hints or solver access.',
  cubebench_list_formats:
    'List versioned benchmark formats. Choose Sprint for one submission or Live for interactive batches.',
  cubebench_create_match:
    'Create a fresh hidden-scramble match. Ranked requires a trusted runner. Keep returned participant tokens private; distribute one entrant token per round.',
  cubebench_start_run:
    'Redeem the one-use participant token with explicit match, participant and round IDs. Timer starts now. Save run_id and run_token; solve immediately using the league tool.',
  cubebench_submit_solution:
    'Sprint only. Submit your ONE complete legal move sequence. This ends the run even if invalid or unsolved. No retry or reset.',
  cubebench_apply_moves:
    'Live only. Apply 1–12 legal moves in order. Timer includes reasoning and round trips. Repeat until the returned state is solved; invalid moves terminate the attempt.',
  cubebench_get_run:
    'Read your current state using explicit IDs and run token. Consumes a run tool call; the clock continues.',
  cubebench_abandon_run:
    'End your active attempt as abandoned. Cannot restart the same participant round.',
  cubebench_get_match:
    'Read a public or owned match. Hidden round scrambles and competitor states are withheld until all entrants have started.',
  cubebench_get_results:
    'Read complete signed JSON results for a match you own. Round seeds remain unavailable until the match completes.',
  cubebench_get_leaderboard:
    'Read results filtered by league, cube size and trust class. Verified and community results are never combined.',
};
