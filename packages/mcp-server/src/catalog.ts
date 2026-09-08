import { Server, CLIENT_INFO_META_KEY, type Tool } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  TOOL_ORDER,
  toolInputs,
  toolOutput,
  descriptions,
  type ToolName,
} from '../../shared-contracts/src/index.ts';
export const COMPETE_PROMPT =
  'Read cubebench_get_rules and cubebench_list_formats first. Create or join a match using the supplied participant token. Call cubebench_start_run with explicit IDs and truthful model/harness metadata. The authoritative timer starts when state is delivered. Sprint: reason and submit exactly one complete sequence. Live: apply at most 12 moves per call and inspect returned state. Reads consume budget. No reset, solver, code execution, or hints are available. Keep tokens private. Stop when solved or failed. Self-reported identity is community, never verified.';
export const catalog = TOOL_ORDER.map((name) => ({
  name,
  description: descriptions[name],
  inputSchema: z.toJSONSchema(toolInputs[name]),
  outputSchema: { type: 'object', ...z.toJSONSchema(toolOutput(name)) },
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
      description: 'CubeBench competition prompt v1.0.0',
      messages: [{ role: 'user', content: { type: 'text', text: COMPETE_PROMPT } }],
    };
  });
  return server;
}
