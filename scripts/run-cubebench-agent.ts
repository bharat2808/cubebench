import { Agent, MCPServerStreamableHttp, OpenAIProvider, Runner } from '@openai/agents';
import { TOOL_ORDER } from '../packages/shared-contracts/src/index.ts';

const DEFAULT_MCP_URL = 'https://rubiks-cube-bench.vermabharat642.workers.dev/mcp';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const MAX_TOOL_CALLS = 1000;

type Options = {
  apiKey: string;
  model: string;
  baseUrl: string;
  mcpUrl: string;
  size: number;
  league: 'sprint' | 'live';
  difficulty: 'easy' | 'medium' | 'hard' | 'extra_hard';
};

function usage(): never {
  console.error(`Usage: npm run agent:run -- --api-key <key> --model <model> [options]

Options:
  --base-url <url>    OpenAI-compatible API base URL (default: ${DEFAULT_BASE_URL})
  --mcp-url <url>     CubeBench MCP endpoint (default: ${DEFAULT_MCP_URL})
  --size <2-7>        Cube size (default: 3)
  --league <sprint|live> (default: live)
  --difficulty <easy|medium|hard|extra_hard> (default: medium)

The difficulty label is the only scramble setting passed to CubeBench; the
scramble length and sequence are internal server decisions and are never
visible to the MCP client.

Environment fallbacks:
  OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL, CUBEBENCH_MCP_URL
`);
  process.exit(2);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

const SENSITIVE_KEYS = new Set([
  'api_key',
  'authorization',
  'participant_token',
  'run_token',
  'token',
]);

function safeLog(value: unknown): string {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  const redact = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(redact);
    if (!current || typeof current !== 'object') return current;
    return Object.fromEntries(
      Object.entries(current).map(([key, nested]) => [
        key,
        SENSITIVE_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(nested),
      ]),
    );
  };
  return JSON.stringify(redact(parsed));
}

function parseOptions(): Options {
  const args = process.argv.slice(2);
  const apiKey = option(args, '--api-key') ?? process.env.OPENAI_API_KEY;
  const model = option(args, '--model') ?? process.env.OPENAI_MODEL;
  const baseUrl = option(args, '--base-url') ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;
  const mcpUrl = option(args, '--mcp-url') ?? process.env.CUBEBENCH_MCP_URL ?? DEFAULT_MCP_URL;
  const size = Number(option(args, '--size') ?? 3);
  const league = option(args, '--league') ?? 'live';
  const difficultyRaw = option(args, '--difficulty') ?? 'medium';
  const difficulty = ['easy', 'medium', 'hard', 'extra_hard'].includes(difficultyRaw)
    ? (difficultyRaw as 'easy' | 'medium' | 'hard' | 'extra_hard')
    : undefined;

  if (!apiKey || !model) usage();
  if (!Number.isInteger(size) || size < 2 || size > 7) {
    throw new Error('--size must be an integer from 2 through 7.');
  }
  if (league !== 'sprint' && league !== 'live') {
    throw new Error('--league must be sprint or live.');
  }
  if (!difficulty) {
    throw new Error('--difficulty must be easy, medium, hard or extra_hard.');
  }
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    throw new Error('--base-url must be an HTTP(S) URL.');
  }
  if (!mcpUrl.startsWith('http://') && !mcpUrl.startsWith('https://')) {
    throw new Error('--mcp-url must be an HTTP(S) URL.');
  }

  return { apiKey, model, baseUrl, mcpUrl, size, league, difficulty };
}

const options = parseOptions();
const providerId = new URL(options.baseUrl).hostname.includes('openrouter')
  ? 'openrouter'
  : new URL(options.baseUrl).hostname;
const provider = new OpenAIProvider({
  apiKey: options.apiKey,
  baseURL: options.baseUrl,
  // OpenAI-compatible providers commonly expose Chat Completions rather than Responses.
  useResponses: false,
});
const mcp = new MCPServerStreamableHttp({
  name: 'cubebench',
  url: options.mcpUrl,
  useStructuredContent: true,
  // The model receives only the CubeBench MCP catalog; no shell, web, code, or custom tools.
  toolFilter: { allowedToolNames: [...TOOL_ORDER] },
});

const model = await provider.getModel(options.model);
const runner = new Runner({ tracingDisabled: true });
const agent = new Agent({
  name: 'CubeBench text-only solver',
  model,
  instructions: `You are a text-only Rubik's Cube solver being benchmarked.

Identity for this run: provider=${JSON.stringify(providerId)}, model_id=${JSON.stringify(options.model)}.
You are not Claude, Opus, GPT, or any other model unless that exact model ID says so. Do not
guess or substitute a model identity. Use exactly these values in cubebench_start_run metadata:
model_id=${JSON.stringify(options.model)}, claimed_provider=${JSON.stringify(providerId)},
claimed_model=${JSON.stringify(options.model)}.

Use only the connected CubeBench MCP tools. You have no shell, browser, code execution, search,
reset, hint, or custom tools. Do not solve the cube outside the MCP protocol or invent tool results.

Create one public community ${options.league} match for a ${options.size}x${options.size} cube at
difficulty ${options.difficulty}, with one entrant and exactly ${MAX_TOOL_CALLS} tool calls in its
limits. Before starting the run, show the complete spectator_url returned by match creation to the
user and open it in a visual browser if one is available. Do not call cubebench_start_run until
that preview step is handled. Then start the run with truthful
metadata: display_name, model_id, claimed_provider, claimed_model, model_snapshot, harness_name,
and harness_version. Then solve the cube using only the state and rules returned by MCP.

Do not stop merely because a move failed, the state is difficult, or you are uncertain. Continue
calling the appropriate MCP tool until the cube is solved, the server reports that the run ended,
you genuinely give up, or the server exhausts the ${MAX_TOOL_CALLS}-call budget. If the run's
remaining timeout is insufficient, call cubebench_extend_timeout before it expires; this community
match may extend its total timeout up to one hour. Never claim a solution without submitting it
through MCP. When the run ends, briefly report the server result.`,
  mcpServers: [mcp],
});

const prompt = `Begin the ${options.league} CubeBench evaluation now. Use the MCP prompt and rules,
create the match, start the run, and keep working until the server ends the attempt or you give up.`;

try {
  await mcp.connect();
  console.error(`Connecting to CubeBench MCP: ${options.mcpUrl}`);
  console.error(`Running model ${options.model} with a ${MAX_TOOL_CALLS}-call CubeBench budget.`);
  const result = await runner.run(agent, prompt, { maxTurns: MAX_TOOL_CALLS, stream: true });
  for await (const event of result) {
    if (event.type !== 'run_item_stream_event') continue;
    const item = event.item as unknown as {
      rawItem?: { name?: string; arguments?: string };
      output?: unknown;
    };
    if (event.name === 'tool_called') {
      console.error(
        `[tool call] ${item.rawItem?.name ?? 'unknown'} ${safeLog(item.rawItem?.arguments ?? {})}`,
      );
    } else if (event.name === 'tool_output') {
      console.error(`[tool result] ${safeLog(item.output)}`);
    } else if (event.name === 'message_output_created') {
      const message = item.rawItem as unknown as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = message.content
        ?.filter((part) => part.type === 'output_text' && part.text)
        .map((part) => part.text)
        .join(' ');
      if (text) console.error(`[model] ${text}`);
    } else if (event.name === 'reasoning_item_created') {
      // The SDK may expose private reasoning events; do not print hidden chain-of-thought.
      console.error('[model] reasoning update received');
    }
  }
  console.log(result.finalOutput ?? '[agent ended without final output]');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Agent run ended: ${message}`);
  process.exitCode = 1;
} finally {
  await mcp.close().catch(() => {});
  await provider.close().catch(() => {});
}
