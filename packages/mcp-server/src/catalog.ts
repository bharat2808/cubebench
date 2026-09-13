import { Server, CLIENT_INFO_META_KEY, type Tool } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { portableSchema } from './schema-portability.ts';
import {
  TOOL_ORDER,
  toolInputs,
  toolOutput,
  descriptions,
  VERSIONS,
  type ToolName,
} from '../../shared-contracts/src/index.ts';
export const COMPETE_PROMPT =
  'Read cubebench_get_rules and cubebench_list_formats first. Create or join a match using the supplied participant token. After cubebench_create_match, treat the preview as a required preflight: if spectator_url is non-null, show the complete URL to the user before starting any run, and open it in a visual browser when one is available. Do not call cubebench_start_run until the user has been shown that preview URL; private matches return null and may proceed without it. Call cubebench_start_run with explicit IDs and truthful model/harness metadata: use model_id for a stable provider/model slug, display_name for the human label, model_snapshot for an immutable release or revision, and harness/client fields for the runner. The authoritative timer starts when the scrambled facelet state is delivered; the generating scramble remains hidden until the round ends. Sprint: reason and submit exactly one complete sequence. Live: apply legal moves up to the remaining move budget and inspect returned state; if a community run may need more time, call cubebench_extend_timeout before the timeout expires, up to a one-hour total timeout. Reads and extensions consume budget. No reset, solver, code execution, or hints are available. Keep tokens private. Stop when solved or failed. Self-reported identity is community, never verified.';
export const catalog = TOOL_ORDER.map((name) => ({
  name,
  description: descriptions[name],
  inputSchema: portableSchema(z.toJSONSchema(toolInputs[name])),
  outputSchema: portableSchema({ type: 'object', ...z.toJSONSchema(toolOutput(name)) }),
  annotations: {
    readOnlyHint: [
      'cubebench_get_rules',
      'cubebench_list_formats',
      'cubebench_get_match',
      'cubebench_get_results',
      'cubebench_get_leaderboard',
    ].includes(name),
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
})) as Tool[];
export function buildServer(
  execute: (name: ToolName, args: unknown, clientIdentity?: string) => unknown | Promise<unknown>,
) {
  const server = new Server(
    { name: 'cubebench', version: '1.0.0' },
    { capabilities: { tools: {}, prompts: {} } },
  );
  server.setRequestHandler('tools/list', () => ({ tools: catalog }));
  server.setRequestHandler('tools/call', async (request, ctx) => {
    const name = request.params.name;
    if (!TOOL_ORDER.includes(name as ToolName)) throw new Error('Unknown tool');
    // Domain validation owns malformed attributable run calls so they consume budget.
    const claimed =
      (ctx.mcpReq.envelope as Record<string, unknown> | undefined)?.[CLIENT_INFO_META_KEY] ??
      server.getClientVersion();
    const client = z
      .object({ name: z.string().max(80), version: z.string().max(64) })
      .safeParse(claimed);
    const identity = client.success ? `${client.data.name}/${client.data.version}` : undefined;
    const result = toolOutput(name as ToolName).parse(
      await execute(name as ToolName, request.params.arguments ?? {}, identity),
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: !result.ok,
    };
  });
  server.setRequestHandler('prompts/list', () => ({
    prompts: [
      {
        name: 'cubebench_compete',
        description: 'Versioned fair competition instructions',
        arguments: [],
      },
    ],
  }));
  server.setRequestHandler('prompts/get', (request) => {
    if (request.params.name !== 'cubebench_compete') throw new Error('Unknown prompt');
    return {
      description: `CubeBench competition prompt v${VERSIONS.prompt}`,
      messages: [{ role: 'user', content: { type: 'text', text: COMPETE_PROMPT } }],
    };
  });
  return server;
}
