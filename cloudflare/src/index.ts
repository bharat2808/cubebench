/// <reference types="@cloudflare/workers-types" />
import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import { DurableObject } from 'cloudflare:workers';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { BenchmarkService } from '../../packages/benchmark-core/src/index.ts';
import { ResultSigner } from '../../packages/benchmark-core/src/signatures.ts';
import {
  authenticateToken,
  hashToken,
  issueAccessToken,
  type Actor,
} from '../../packages/persistence/src/index.ts';
import { buildServer } from '../../packages/mcp-server/src/catalog.ts';
import { VERSIONS, createMatchSchema } from '../../packages/shared-contracts/src/index.ts';
import { applyMoves, createSolved, isSolved } from '../../packages/cube-core/src/index.ts';
import { DurableObjectRepository } from './repository.ts';

export interface Env {
  ARENA: DurableObjectNamespace<CubeBenchArena>;
  ASSETS: Fetcher;
  PUBLIC_URL?: string;
  CUBEBENCH_SIGNING_KEY?: string;
}

const json = (value: unknown, init: ResponseInit = {}) =>
  Response.json(value, {
    ...init,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...(init.headers ?? {}),
    },
  });

const parseBody = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
};

const getCookie = (request: Request, name: string) =>
  request.headers
    .get('Cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);

export class CubeBenchArena extends DurableObject<Env> {
  private readonly store: DurableObjectRepository;
  private readonly service: BenchmarkService;
  private readonly publicUrl: string;
  private readonly mcp: ReturnType<typeof createMcpHandler>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const storedKey = sql
      .exec<{ value: string }>("SELECT value FROM metadata WHERE key='signing_key'")
      .toArray()[0]?.value;
    let signingKeyPem = env.CUBEBENCH_SIGNING_KEY ?? storedKey;
    if (!signingKeyPem) {
      const generated = new ResultSigner();
      signingKeyPem = generated.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
      sql.exec("INSERT INTO metadata(key,value) VALUES('signing_key',?)", signingKeyPem);
    }
    this.store = new DurableObjectRepository(ctx.storage);
    this.publicUrl = env.PUBLIC_URL ?? 'http://127.0.0.1:8787';
    this.service = new BenchmarkService(this.store, {
      publicUrl: this.publicUrl,
      signingKeyPem,
      clock: () => Date.now(),
    });
    this.mcp = createMcpHandler(
      (requestContext) => {
        const actor = (requestContext.authInfo?.extra?.actor as Actor | undefined) ?? {
          id: 'public',
          role: 'community' as const,
        };
        return buildServer((name, args, clientIdentity) => {
          return this.service.execute(name, args, {
            ...actor,
            clientIdentity: clientIdentity ?? actor.clientIdentity,
          });
        });
      },
      { responseMode: 'auto' },
    );
  }

  private authenticate(request: Request): Actor | null {
    const bearer = request.headers.get('Authorization');
    if (!bearer?.startsWith('Bearer ')) return null;
    const token = bearer.slice(7);
    return token.length <= 8192 ? authenticateToken(this.store, token) : null;
  }

  private browser(request: Request, headers: Headers, create = false): Actor | undefined {
    const existing = getCookie(request, 'cubebench_session');
    const actor = existing ? authenticateToken(this.store, existing) : null;
    if (actor) return actor;
    if (!create) return undefined;
    const credential = issueAccessToken(this.store, 'Anonymous browser', 'community', 24 * 30);
    headers.append(
      'Set-Cookie',
      `cubebench_session=${credential.token}; HttpOnly; SameSite=Strict; Max-Age=${30 * 86400}; Path=/`,
    );
    return credential.actor;
  }

  private csrf(request: Request): boolean {
    const origin = request.headers.get('Origin');
    return (
      Boolean(origin) &&
      request.headers.get('X-CubeBench') === '1' &&
      (origin === new URL(request.url).origin || origin === new URL(this.publicUrl).origin)
    );
  }

  private async api(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const headers = new Headers();
    const actor = this.authenticate(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (url.pathname === '/api/config' && request.method === 'GET')
      return json({
        versions: VERSIONS,
        public_key: this.service.publicKey,
        oauth_enabled: false,
        sizes: [2, 3, 4, 5, 6, 7],
        mcp_url: `${this.publicUrl.replace(/\/$/, '')}/mcp`,
      });
    if (url.pathname === '/api/matches' && request.method === 'GET')
      return json({ matches: this.service.getPublicMatches() });
    if (url.pathname === '/api/matches' && request.method === 'POST') {
      if (!this.csrf(request))
        return json({ error: 'Same-origin mutation header required' }, { status: 403 });
      const input = createMatchSchema.parse(await parseBody(request));
      if (input.ranked) return json({ error: 'Browser matches must be unranked' }, { status: 403 });
      return json(
        this.service.execute(
          'cubebench_create_match',
          input,
          this.browser(request, headers, true)!,
        ),
        { headers },
      );
    }
    const match = url.pathname.match(/^\/api\/matches\/([^/]+)$/);
    if (match && request.method === 'GET') {
      try {
        return json(
          { match: this.service.getMatch(match[1]!, actor ?? this.browser(request, headers)) },
          { headers },
        );
      } catch {
        return json({ error: 'Not found or unauthorized' }, { status: 404, headers });
      }
    }
    const events = url.pathname.match(/^\/api\/matches\/([^/]+)\/events$/);
    if (events && request.method === 'GET') {
      const cursor = Number(
        url.searchParams.get('after') ?? request.headers.get('Last-Event-ID') ?? 0,
      );
      if (!Number.isInteger(cursor) || cursor < 0)
        return json({ error: 'Invalid cursor' }, { status: 400 });
      return json(
        {
          events: this.service.getEvents(
            events[1]!,
            cursor,
            actor ?? this.browser(request, headers),
          ),
          cursor,
        },
        { headers },
      );
    }
    const stream = url.pathname.match(/^\/api\/matches\/([^/]+)\/stream$/);
    if (stream && request.method === 'GET') {
      const cursor = Number(
        url.searchParams.get('after') ?? request.headers.get('Last-Event-ID') ?? 0,
      );
      const payload = this.service
        .getEvents(stream[1]!, cursor, actor ?? this.browser(request, headers))
        .map((event) => `event: cube\ndata: ${JSON.stringify(event)}\n\n`)
        .join('');
      return new Response(payload || ': connected\n\n', {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' },
      });
    }
    const run = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (run && request.method === 'GET') return json(this.service.getPublicRun(run[1]!));
    if (url.pathname === '/api/results' && request.method === 'GET')
      return json({
        results: this.service.getPublicResults(
          url.searchParams.get('league') as 'sprint' | 'live' | undefined,
          url.searchParams.get('result_class') as 'verified' | 'community' | undefined,
          Number(url.searchParams.get('size')) || undefined,
        ),
      });
    if (url.pathname === '/api/leaderboard' && request.method === 'GET')
      return json(
        this.service.execute(
          'cubebench_get_leaderboard',
          {
            league: url.searchParams.get('league') ?? 'sprint',
            result_class: url.searchParams.get('result_class') ?? 'community',
            size: Number(url.searchParams.get('size') ?? 3),
            limit: Number(url.searchParams.get('limit') ?? 25),
          },
          { id: 'public', role: 'community' },
        ),
      );
    if (url.pathname === '/api/human/solves' && request.method === 'GET')
      return json(
        {
          solves: this.store.list(
            'human_solves',
            { owner_id: this.browser(request, headers)?.id },
            100,
          ),
        },
        { headers },
      );
    if (url.pathname === '/api/human/solves' && request.method === 'POST') {
      if (!this.csrf(request))
        return json({ error: 'Same-origin mutation header required' }, { status: 403 });
      const input = (await parseBody(request)) as {
        size: number;
        seed: string | null;
        scramble: string;
        moves: string;
        elapsed_ms: number;
      };
      try {
        if (
          !isSolved(applyMoves(applyMoves(createSolved(input.size), input.scramble), input.moves))
        )
          return json({ error: 'Submitted practice solve is not solved' }, { status: 400 });
      } catch {
        return json({ error: 'Invalid move sequence' }, { status: 400 });
      }
      const owner = this.browser(request, headers, true)!;
      const solve = { id: crypto.randomUUID(), ...input, created_at: new Date().toISOString() };
      this.store.insert('human_solves', solve.id, solve, { owner_id: owner.id, size: input.size });
      return json({ solve }, { status: 201, headers });
    }
    return json({ error: 'Not found' }, { status: 404 });
  }

  async fetch(request: Request): Promise<Response> {
    this.service.sweep();
    const url = new URL(request.url);
    if (url.pathname === '/mcp') {
      const actor = this.authenticate(request) ?? { id: 'public', role: 'community' as const };
      const authInfo: AuthInfo = {
        token: '[redacted]',
        clientId: actor.id,
        scopes: [actor.role],
        extra: { actor },
      };
      return this.mcp.fetch(request, { authInfo });
    }
    return this.api(request);
  }
}

const backendPath = (pathname: string) =>
  pathname === '/mcp' || pathname.startsWith('/api/') || pathname.startsWith('/.well-known/');

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (!backendPath(url.pathname)) return env.ASSETS.fetch(request);
    if (
      url.pathname === '/.well-known/oauth-protected-resource' ||
      url.pathname === '/.well-known/oauth-protected-resource/mcp'
    ) {
      const publicUrl = env.PUBLIC_URL ?? new URL(request.url).origin;
      return json({
        resource: `${publicUrl}/mcp`,
        bearer_methods_supported: ['header'],
        scopes_supported: ['cubebench:compete', 'cubebench:run-ranked'],
      });
    }
    return env.ARENA.getByName('temporary-arena').fetch(request);
  },
};
