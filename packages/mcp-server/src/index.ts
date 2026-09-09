import express, { type Request, type Response } from 'express';
import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildServer } from './catalog.ts';
import { security, type SecurityOptions } from './security.ts';
import type { BenchmarkService } from '../../benchmark-core/src/index.ts';
import type { Actor, Repository } from '../../persistence/src/index.ts';
import {
  VERSIONS,
  TOOL_ORDER,
  toolOutput,
  createMatchSchema,
  type ToolName,
} from '../../shared-contracts/src/index.ts';
import { applyMoves, createSolved, isSolved } from '../../cube-core/src/index.ts';
import { streamEvents } from '../../realtime/src/index.ts';
export function createApp(
  service: BenchmarkService,
  store: Repository,
  options: SecurityOptions = {},
) {
  const app = express();
  app.disable('x-powered-by');
  const gate = security(store, options);
  app.use(gate.guard);
  const handler = createMcpHandler((ctx) => {
    const actor = ctx.authInfo?.extra?.actor as Actor | undefined;
    return buildServer((name, args, clientIdentity) => {
      if (!actor) throw new Error('Authentication required');
      return service.execute(name, args, {
        ...actor,
        clientIdentity: clientIdentity ?? actor.clientIdentity,
      });
    });
  });
  const nodeHandler = toNodeHandler(handler);
  const streams = new Set<() => void>();
  app.get(
    ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'],
    (_req, res) =>
      res.json({
        resource: `${gate.publicUrl.replace(/\/$/, '')}/mcp`,
        ...(options.oauthIssuer ? { authorization_servers: [options.oauthIssuer] } : {}),
        bearer_methods_supported: ['header'],
        scopes_supported: ['cubebench:compete', 'cubebench:run-ranked'],
      }),
  );
  app.use(express.json({ limit: '128kb', strict: true }));
  app.all('/mcp', async (req, res) => {
    const actor = await gate.authenticate(req);
    if (!actor) {
      gate.unauthorized(res);
      return;
    }
    (req as Request & { auth: AuthInfo }).auth = {
      token: '[redacted]',
      clientId: actor.id,
      scopes: [actor.role],
      extra: { actor },
    };
    await nodeHandler(req, res, req.body);
  });
  app.post('/internal/tools/:name', async (req, res) => {
    const actor = await gate.authenticate(req);
    if (!actor) {
      gate.unauthorized(res);
      return;
    }
    const name = req.params.name as ToolName;
    if (!TOOL_ORDER.includes(name)) {
      res.status(404).json({ error: 'Unknown tool' });
      return;
    }
    res.json(
      toolOutput(name).parse(
        service.execute(name, req.body, {
          ...actor,
          clientIdentity: req.get('X-CubeBench-Client')?.slice(0, 160) ?? actor.clientIdentity,
        }),
      ),
    );
  });
  const actor = async (req: Request, res: Response) =>
    (await gate.authenticate(req)) ?? gate.browser(req, res);
  const cursor = (req: Request) =>
    z.coerce
      .number()
      .int()
      .min(0)
      .safeParse(req.get('Last-Event-ID') ?? req.query.after ?? 0);
  const publicActor: Actor = { id: 'public', role: 'community' };
  app.get('/api/config', (_req, res) =>
    res.json({
      versions: VERSIONS,
      public_key: service.publicKey,
      oauth_enabled: Boolean(options.oauthIssuer),
      sizes: [2, 3, 4, 5, 6, 7],
      mcp_url: `${gate.publicUrl.replace(/\/$/, '')}/mcp`,
    }),
  );
  app.get('/api/matches', (_req, res) => res.json({ matches: service.getPublicMatches() }));
  app.post('/api/matches', gate.csrf, (req, res) => {
    const input = createMatchSchema.parse(req.body);
    if (input.ranked) {
      res.status(403).json({ error: 'Browser matches must be unranked' });
      return;
    }
    res.json(service.execute('cubebench_create_match', input, gate.browser(req, res, true)!));
  });
  app.get('/api/matches/:id', async (req, res) =>
    res.json({ match: service.getMatch(String(req.params.id), await actor(req, res)) }),
  );
  app.get('/api/matches/:id/events', async (req, res) => {
    const parsed = cursor(req);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid cursor' });
      return;
    }
    const events = service.getEvents(String(req.params.id), parsed.data, await actor(req, res));
    res.json({ events, cursor: events.at(-1)?.id ?? parsed.data });
  });
  app.get('/api/matches/:id/stream', async (req, res) => {
    const parsed = cursor(req);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid cursor' });
      return;
    }
    const principal = await actor(req, res);
    const stop = streamEvents(
      req,
      res,
      (c) => service.getEvents(String(req.params.id), c, principal),
      parsed.data,
    );
    streams.add(stop);
    res.once('close', () => streams.delete(stop));
  });
  app.get('/api/matches/:id/export', async (req, res) => {
    const format = z.enum(['json', 'csv']).parse(req.query.format ?? 'json');
    const principal = await actor(req, res);
    if (!principal) {
      gate.unauthorized(res);
      return;
    }
    const data = service.exportResults(String(req.params.id), principal, format);
    res
      .type(format === 'json' ? 'application/json' : 'text/csv')
      .attachment(`cubebench-results.${format}`)
      .send(data);
  });
  app.get('/api/runs/:id', (req, res) => res.json(service.getPublicRun(String(req.params.id))));
  const filters = (req: Request) =>
    z
      .strictObject({
        league: z.enum(['sprint', 'live']),
        result_class: z.enum(['verified', 'community']),
        size: z.coerce.number().int().min(2).max(7),
      })
      .parse({
        league: req.query.league ?? 'sprint',
        result_class: req.query.result_class ?? 'community',
        size: req.query.size ?? 3,
      });
  app.get('/api/leaderboard', (req, res) =>
    res.json(service.execute('cubebench_get_leaderboard', filters(req), publicActor)),
  );
  app.get('/api/results', (req, res) => {
    const f = z
      .strictObject({
        league: z.enum(['sprint', 'live']).optional(),
        result_class: z.enum(['verified', 'community']).optional(),
        size: z.coerce.number().int().min(2).max(7).optional(),
      })
      .parse({
        league: req.query.league,
        result_class: req.query.result_class,
        size: req.query.size,
      });
    res.json({ results: service.getPublicResults(f.league, f.result_class, f.size) });
  });
  app.get('/api/human/solves', (req, res) => {
    const principal = gate.browser(req, res);
    res.json({
      solves: principal ? store.list('human_solves', { owner_id: principal.id }, 100) : [],
    });
  });
  app.post('/api/human/solves', gate.csrf, (req, res) => {
    const input = z
      .strictObject({
        size: z.number().int().min(2).max(7),
        seed: z.string().max(256).nullable(),
        scramble: z.string().min(1).max(60000),
        moves: z.string().max(60000),
        elapsed_ms: z.number().finite().min(0).max(86400000),
      })
      .parse(req.body);
    try {
      if (
        !isSolved(applyMoves(applyMoves(createSolved(input.size), input.scramble), input.moves))
      ) {
        res.status(400).json({ error: 'Submitted practice solve is not solved' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Invalid move sequence' });
      return;
    }
    const principal = gate.browser(req, res, true)!;
    const solve = { id: randomUUID(), ...input, created_at: new Date().toISOString() };
    store.insert('human_solves', solve.id, solve, { owner_id: principal.id, size: input.size });
    res.status(201).json({ solve });
  });
  app.get('/api/admin', async (req, res) => {
    const principal = await gate.authenticate(req);
    if (!principal) {
      gate.unauthorized(res);
      return;
    }
    if (principal.role !== 'admin') {
      res.status(403).json({ error: 'Administrator required' });
      return;
    }
    res.json({
      versions: VERSIONS,
      oauth_enabled: Boolean(options.oauthIssuer),
      runner_identities: store
        .list<Actor>('identities')
        .filter((x) => x.role === 'runner')
        .map((x) => ({ id: x.id, role: x.role })),
      trusted_runner_subjects: options.trustedRunners ?? [],
    });
  });
  app.use(['/api', '/internal'], (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    const e = error as { type?: string; category?: string; status?: number };
    res
      .status(
        e.type === 'entity.too.large'
          ? 413
          : e.type === 'entity.parse.failed'
            ? 400
            : e.category === 'unauthorized'
              ? 404
              : 500,
      )
      .json({
        error:
          e.type === 'entity.too.large'
            ? 'Request too large'
            : e.category === 'unauthorized'
              ? 'Not found or unauthorized'
              : 'Request failed',
      });
  });
  return {
    app,
    close: async () => {
      for (const stop of streams) stop();
      await handler.close();
    },
  };
}
