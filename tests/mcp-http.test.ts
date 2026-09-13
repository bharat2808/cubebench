import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyHttpTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import type { SecurityOptions } from '../packages/mcp-server/src/security.ts';
import { z } from 'zod';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { parseMoves, invertMoves, serializeMoves } from '../packages/cube-core/src/index.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { createApp } from '../packages/mcp-server/src/index.ts';
import { SqliteRepository, issueAccessToken } from '../packages/persistence/src/index.ts';
import { BenchmarkService, type Run } from '../packages/benchmark-core/src/index.ts';
import {
  TOOL_ORDER,
  toolSuccessOutputs,
  type ToolName,
} from '../packages/shared-contracts/src/index.ts';
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup(options: SecurityOptions = {}) {
  const store = new SqliteRepository(':memory:');
  const service = new BenchmarkService(store, { publicUrl: options.publicUrl });
  cleanup.push(
    () => store.close(),
    () => service.close(),
  );
  const { app, close } = createApp(service, store, options);
  const http: Server = createServer(app);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw Error('No port');
  const url = `http://127.0.0.1:${address.port}`;
  cleanup.push(close, () => new Promise<void>((resolve) => http.close(() => resolve())));
  return { store, url };
}
describe('authenticated MCP HTTP', () => {
  it('rejects unauthenticated and hostile hosts/origins', async () => {
    const { url } = await setup();
    expect(
      (
        await fetch(url + '/mcp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(401);
    expect(
      await new Promise<number | undefined>((resolve) => {
        httpRequest(url + '/api/config', { headers: { Host: 'evil.example' } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        }).end();
      }),
    ).toBe(403);
    expect(
      (await fetch(url + '/api/config', { headers: { origin: 'https://evil.example' } })).status,
    ).toBe(403);
  });
  for (const mode of ['legacy', 'auto'] as const)
    it(`discovers ordered strict tools and prompt with ${mode} client`, async () => {
      const { url, store } = await setup();
      const { token } = issueAccessToken(store, 'fixture');
      const client = new Client(
        { name: 'fixture', version: '1' },
        { versionNegotiation: { mode } },
      );
      await client.connect(
        new StreamableHTTPClientTransport(new URL(url + '/mcp'), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      cleanup.push(() => client.close());
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toEqual(TOOL_ORDER);
      expect(
        tools.tools.every((t) => t.inputSchema.additionalProperties === false && t.outputSchema),
      ).toBe(true);
      const prompt = await client.getPrompt({ name: 'cubebench_compete' });
      expect(prompt.messages).toHaveLength(1);
      expect(prompt.description).toBe('CubeBench competition prompt v2.2.0');
      const promptText = prompt.messages[0]?.content;
      expect(promptText?.type).toBe('text');
      if (promptText?.type !== 'text') throw new Error('Expected text competition prompt');
      expect(promptText.text).toContain('spectator_url');
      expect(promptText.text).toContain(
        'show the complete URL to the user before starting any run',
      );
      expect(promptText.text).toContain(
        'Do not call cubebench_start_run until the user has been shown that preview URL',
      );
      expect(promptText.text.indexOf('spectator_url')).toBeLessThan(
        promptText.text.indexOf('cubebench_start_run'),
      );
      const rules = await client.callTool({ name: 'cubebench_get_rules', arguments: {} });
      const parsedRules = toolSuccessOutputs.cubebench_get_rules.parse(rules.structuredContent);
      expect(parsedRules.versions.schema).toBe('2.1.0');
      expect(parsedRules.versions.prompt).toBe('2.2.0');
    });

  it('requires an explicit difficulty for MCP match creation', async () => {
    const { url, store } = await setup();
    const { token } = issueAccessToken(store, 'difficulty fixture');
    const client = new Client({ name: 'difficulty-fixture', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url + '/mcp'), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    cleanup.push(() => client.close());

    const omitted = await client.callTool({
      name: 'cubebench_create_match',
      arguments: { league: 'live', size: 3 },
    });
    expect(omitted.isError).toBe(true);
    expect(omitted.structuredContent).toMatchObject({
      ok: false,
      error: { category: 'malformed_tool_arguments' },
    });

    const explicit = await client.callTool({
      name: 'cubebench_create_match',
      arguments: { league: 'live', size: 3, difficulty: 'extra_hard' },
    });
    expect(explicit.isError).not.toBe(true);
    expect(
      toolSuccessOutputs.cubebench_create_match.parse(explicit.structuredContent).difficulty,
    ).toBe('extra_hard');
  });

  it('returns a canonical spectator URL while the created match is still waiting', async () => {
    const publicUrl = 'https://cubebench.example.test';
    const { url, store } = await setup({ publicUrl });
    const { token } = issueAccessToken(store, 'preview fixture');
    const client = new Client({ name: 'preview-fixture', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url + '/mcp'), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    cleanup.push(() => client.close());

    const response = await client.callTool({
      name: 'cubebench_create_match',
      arguments: { league: 'live', size: 3, difficulty: 'medium' },
    });
    const match = toolSuccessOutputs.cubebench_create_match.parse(response.structuredContent);

    expect(match.spectator_url).toBe(`${publicUrl}/#match/${match.match_id}`);
    const waiting = await (await fetch(url + `/api/matches/${match.match_id}`)).json();
    expect(waiting.match.status).toBe('waiting');
    expect(waiting.match.runs).toEqual([]);

    const privateResponse = await client.callTool({
      name: 'cubebench_create_match',
      arguments: { league: 'live', size: 3, difficulty: 'medium', visibility: 'private' },
    });
    const privateMatch = toolSuccessOutputs.cubebench_create_match.parse(
      privateResponse.structuredContent,
    );
    expect(privateMatch.spectator_url).toBeNull();
  });

  it.each([
    'ftp://cubebench.example.test',
    'https://user:secret@cubebench.example.test',
    'https://cubebench.example.test/path',
    'https://cubebench.example.test?source=bad',
    'https://cubebench.example.test/#old',
  ])('rejects an unsafe public URL configuration: %s', async (publicUrl) => {
    await expect(setup({ publicUrl })).rejects.toThrow('public URL');
  });
  it('blocks browser mutations without same origin header and oversize bodies', async () => {
    const { url } = await setup();
    expect(
      (
        await fetch(url + '/api/matches', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ league: 'sprint', size: 3 }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(url + '/api/matches', {
          method: 'POST',
          headers: { 'content-type': 'application/json', Origin: url, 'X-CubeBench': '1' },
          body: JSON.stringify({ pad: 'a'.repeat(140000) }),
        })
      ).status,
    ).toBe(413);
  });
});

async function compete(client: Client, store: SqliteRepository, league: 'sprint' | 'live') {
  const call = async <N extends ToolName>(name: N, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    return toolSuccessOutputs[name].parse(result.structuredContent) as z.output<
      (typeof toolSuccessOutputs)[N]
    >;
  };
  const match = await call('cubebench_create_match', { league, size: 3, difficulty: 'medium' });
  if (!('participants' in match)) throw Error('No participants');
  const p = match.participants[0]!;
  const t = p.tokens[0]!;
  const started = await call('cubebench_start_run', {
    match_id: match.match_id,
    participant_id: p.participant_id,
    round_id: t.round_id,
    participant_token: t.participant_token,
    metadata: { display_name: 'Transport fixture' },
  });
  if (!('run_token' in started)) throw Error('No run token');
  const args = {
    match_id: match.match_id,
    participant_id: p.participant_id,
    run_id: started.run.run_id,
    run_token: started.run_token,
  };
  expect(started.run.scramble).toBeNull();
  const moves = invertMoves(parseMoves(store.get<Run>('runs', started.run.run_id)!.scramble, 3));
  if (league === 'sprint') {
    const result = await call('cubebench_submit_solution', {
      ...args,
      sequence: serializeMoves(moves),
    });
    expect('result' in result && result.result?.success).toBe(true);
  } else {
    const result = await call('cubebench_apply_moves', {
      ...args,
      sequence: serializeMoves(moves),
    });
    expect('result' in result && result.result?.success).toBe(true);
  }
  const results = await call('cubebench_get_results', { match_id: match.match_id });
  expect('results' in results && results.results.length).toBe(1);
  return match.match_id;
}
describe('end-to-end competition transports', () => {
  for (const mode of ['legacy', 'auto'] as const)
    for (const league of ['sprint', 'live'] as const)
      it(`completes ${league} using ${mode} HTTP`, async () => {
        const { url, store } = await setup();
        const { token } = issueAccessToken(store, 'fixture');
        const client = new Client(
          { name: 'fixture', version: '1' },
          { versionNegotiation: { mode } },
        );
        await client.connect(
          new StreamableHTTPClientTransport(new URL(url + '/mcp'), {
            requestInit: { headers: { Authorization: `Bearer ${token}` } },
          }),
        );
        cleanup.push(() => client.close());
        const id = await compete(client, store, league);
        const events = await (await fetch(url + `/api/matches/${id}/events`)).json();
        expect(events.events.some((e: { type: string }) => e.type === 'cube_solved')).toBe(true);
        const aggregate = await (await fetch(url + `/api/results?league=${league}`)).json();
        expect(aggregate.results).toHaveLength(1);
      });
  for (const mode of ['legacy', 'auto'] as const)
    it(`completes both leagues through ${mode} stdio sharing HTTP authority`, async () => {
      const { url, store } = await setup();
      const { token } = issueAccessToken(store, 'stdio fixture');
      const client = new Client(
        { name: 'stdio-fixture', version: '1' },
        { versionNegotiation: { mode } },
      );
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: ['--import', 'tsx', 'packages/mcp-server/src/stdio.ts'],
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter((v): v is [string, string] => v[1] !== undefined),
            ),
            CUBEBENCH_URL: url,
            CUBEBENCH_TOKEN: token,
          },
          stderr: 'pipe',
        }),
      );
      cleanup.push(() => client.close());
      await client.listTools();
      await compete(client, store, 'sprint');
      await compete(client, store, 'live');
      expect(store.list('results')).toHaveLength(2);
    }, 20000);
  it('isolates private browser matches and human solve history', async () => {
    const { url } = await setup();
    const response = await fetch(url + '/api/matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: url, 'X-CubeBench': '1' },
      body: JSON.stringify({ league: 'sprint', size: 3, visibility: 'private' }),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    const match = await response.json();
    expect((await fetch(url + `/api/matches/${match.match_id}`)).status).toBe(404);
    expect(
      (await fetch(url + `/api/matches/${match.match_id}`, { headers: { Cookie: cookie } })).status,
    ).toBe(200);
    const solve = await fetch(url + '/api/human/solves', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Origin: url,
        'X-CubeBench': '1',
        Cookie: cookie,
      },
      body: JSON.stringify({ size: 3, seed: null, scramble: 'R', moves: "R'", elapsed_ms: 10 }),
    });
    expect(solve.status).toBe(201);
    expect((await (await fetch(url + '/api/human/solves')).json()).solves).toHaveLength(0);
    expect(
      (await (await fetch(url + '/api/human/solves', { headers: { Cookie: cookie } })).json())
        .solves,
    ).toHaveLength(1);
  });
});

describe('OAuth and durable browser transport', () => {
  it('validates JWT signature, audience, issuer and expiry and only elevates allowlisted subjects', async () => {
    const key = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(key.publicKey)), kid: 'fixture' };
    const jwks = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>((resolve) => jwks.close(() => resolve())));
    const a = jwks.address();
    if (!a || typeof a === 'string') throw Error();
    const issuer = `http://127.0.0.1:${a.port}`;
    const { url, store } = await setup({
      oauthIssuer: issuer,
      oauthJwks: issuer + '/jwks',
      publicUrl: 'https://bench.example',
      trustedRunners: ['trusted'],
    });
    const sign = (
      sub: string,
      aud = 'https://bench.example/mcp',
      exp: number | string = '5m',
      scope = 'cubebench:compete cubebench:run-ranked',
    ) =>
      new SignJWT({ scope })
        .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
        .setIssuer(issuer)
        .setSubject(sub)
        .setAudience(aud)
        .setExpirationTime(exp)
        .sign(key.privateKey);
    for (const token of [
      await sign('trusted', 'wrong'),
      await sign('trusted', undefined, 1),
      await sign('trusted', undefined, '5m', ''),
      await new SignJWT({ scope: 'cubebench:compete' })
        .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
        .setIssuer('https://wrong.example')
        .setSubject('trusted')
        .setAudience('https://bench.example/mcp')
        .setExpirationTime('5m')
        .sign(key.privateKey),
      'bad-token',
    ])
      expect(
        (
          await fetch(url + '/internal/tools/cubebench_get_rules', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: '{}',
          })
        ).status,
      ).toBe(401);
    for (const sub of ['trusted', 'other']) {
      const response = await fetch(url + '/internal/tools/cubebench_create_match', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await sign(sub)}`, 'content-type': 'application/json' },
        body: JSON.stringify({ league: 'sprint', size: 3, difficulty: 'medium', ranked: true }),
      });
      expect((await response.json()).ok).toBe(sub === 'trusted');
    }
    const weak = await fetch(url + '/internal/tools/cubebench_create_match', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await sign('trusted', undefined, '5m', 'cubebench:compete')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ league: 'sprint', size: 3, difficulty: 'medium', ranked: true }),
    });
    expect((await weak.json()).ok).toBe(false);
    expect(
      store
        .list('identities')
        .some((identity: unknown) => (identity as { id: string }).id.startsWith('oauth:')),
    ).toBe(true);
    const metadata = await (await fetch(url + '/.well-known/oauth-protected-resource/mcp')).json();
    expect(metadata.resource).toBe('https://bench.example/mcp');
    expect(metadata.authorization_servers).toEqual([issuer]);
  });
  it('applies configured request quota', async () => {
    const { url } = await setup({ rateLimit: 2 });
    expect((await fetch(url + '/api/config')).status).toBe(200);
    expect((await fetch(url + '/api/config')).status).toBe(200);
    expect((await fetch(url + '/api/config')).status).toBe(429);
  });
  it('replays committed SSE and honors Last-Event-ID', async () => {
    const { url, store } = await setup();
    const { token } = issueAccessToken(store, 'fixture');
    const client = new Client({ name: 'fixture', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url + '/mcp'), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    cleanup.push(() => client.close());
    const id = await compete(client, store, 'sprint');
    const replay = await (await fetch(url + `/api/matches/${id}/events`)).json();
    const controller = new AbortController();
    const response = await fetch(url + `/api/matches/${id}/stream`, {
      headers: { 'Last-Event-ID': String(replay.events[0].id) },
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: cube');
    expect(text).not.toContain(`id: ${replay.events[0].id}\n`);
    expect(text).toContain(`id: ${replay.events[1].id}\n`);
    await reader.cancel();
    controller.abort();
  });
});

it('supports the official v1 SDK initialize client over Streamable HTTP', async () => {
  const { url, store } = await setup();
  const { token } = issueAccessToken(store, 'v1 fixture');
  const client = new LegacyClient({ name: 'legacy-v1', version: '1' });
  await client.connect(
    new LegacyHttpTransport(new URL(url + '/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  cleanup.push(() => client.close());
  expect((await client.listTools()).tools.map((t) => t.name)).toEqual(TOOL_ORDER);
  expect((await client.getPrompt({ name: 'cubebench_compete' })).messages).toHaveLength(1);
  const rules = await client.callTool({ name: 'cubebench_get_rules', arguments: {} });
  expect(toolSuccessOutputs.cubebench_get_rules.parse(rules.structuredContent).ok).toBe(true);
});

it('requires TLS for production and sets production security headers', async () => {
  await expect(setup({ production: true })).rejects.toThrow('HTTPS');
  const { url } = await setup({ production: true, publicUrl: 'https://bench.example' });
  const response = await fetch(url + '/api/config');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('strict-transport-security')).toContain('max-age');
  expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
});

it('rejects absent and URL-shaped Host authorities and accepts explicit loopback ports', async () => {
  const { url } = await setup();
  for (const host of [
    'evil@127.0.0.1',
    '127.0.0.1/path',
    '127.0.0.1?query',
    '127.0.0.1#fragment',
    '0x7f000001',
    '127.0.0.1:99999',
    '',
  ]) {
    const status = await new Promise<number | undefined>((resolve) => {
      httpRequest(
        url + '/api/config',
        { setHost: false, headers: host ? { Host: host } : {} },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      ).end();
    });
    expect([400, 403]).toContain(status);
  }
  const status = await new Promise<number | undefined>((resolve) => {
    httpRequest(url + '/api/config', { headers: { Host: 'localhost:80' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).end();
  });
  expect(status).toBe(200);
  const ipv6 = await new Promise<number | undefined>((resolve) => {
    httpRequest(url + '/api/config', { headers: { Host: '[::1]:4310' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).end();
  });
  expect(ipv6).toBe(200);
});
