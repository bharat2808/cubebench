import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import {
  authenticateToken,
  issueAccessToken,
  type Actor,
  type Repository,
} from '../../persistence/src/index.ts';
export type SecurityOptions = {
  publicUrl?: string;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  oauthIssuer?: string;
  oauthJwks?: string;
  trustedRunners?: string[];
  production?: boolean;
  rateLimit?: number;
  concurrencyLimit?: number;
};
export function security(store: Repository, options: SecurityOptions) {
  const publicUrl = options.publicUrl ?? 'http://127.0.0.1:4310';
  if (options.production && new URL(publicUrl).protocol !== 'https:')
    throw new Error('Production requires HTTPS public URL');
  if (Boolean(options.oauthIssuer) !== Boolean(options.oauthJwks))
    throw new Error('OAuth requires issuer and JWKS');
  if (options.oauthIssuer && !options.publicUrl)
    throw new Error('OAuth requires an explicit public URL');
  if (
    options.production &&
    [options.oauthIssuer, options.oauthJwks].some(
      (url) => url && new URL(url).protocol !== 'https:',
    )
  )
    throw new Error('Production OAuth endpoints require HTTPS');
  const jwks = options.oauthJwks ? createRemoteJWKSet(new URL(options.oauthJwks)) : undefined;
  const buckets = new Map<string, { start: number; count: number; active: number }>();
  const guard = (req: Request, res: Response, next: NextFunction) => {
    let host: URL;
    try {
      const authority = req.headers.host;
      if (!authority || !/^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+)(?::[0-9]{1,5})?$/.test(authority))
        throw new Error('Invalid authority');
      host = new URL(`http://${authority}`);
      const rawHostname = authority.startsWith('[')
        ? authority.slice(0, authority.indexOf(']') + 1)
        : authority.split(':')[0];
      if (rawHostname?.toLowerCase() !== host.hostname.toLowerCase())
        throw new Error('Noncanonical host');
    } catch {
      res.status(403).json({ error: 'Invalid Host' });
      return;
    }
    if (!(options.allowedHosts ?? ['localhost', '127.0.0.1', '[::1]']).includes(host.hostname)) {
      res.status(403).json({ error: 'Host forbidden' });
      return;
    }
    const origin = req.get('origin');
    const ownOrigin = `${req.secure ? 'https' : 'http'}://${req.headers.host}`;
    if (origin && !(options.allowedOrigins ?? [ownOrigin, publicUrl]).includes(origin)) {
      res.status(403).json({ error: 'Origin forbidden' });
      return;
    }
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    if (req.path.startsWith('/api') || req.path.startsWith('/internal') || req.path === '/mcp')
      res.set('Cache-Control', 'no-store');
    if (options.production)
      res.set({
        'Strict-Transport-Security': 'max-age=31536000',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      });
    const key = req.socket.remoteAddress ?? 'unknown',
      now = Date.now();
    if (buckets.size > 10000)
      for (const [key, value] of buckets)
        if (value.active === 0 && now - value.start > 60000) buckets.delete(key);
    const bucket = buckets.get(key) ?? { start: now, count: 0, active: 0 };
    if (now - bucket.start > 60000) {
      bucket.start = now;
      bucket.count = 0;
    }
    buckets.set(key, bucket);
    if (
      ++bucket.count > (options.rateLimit ?? 600) ||
      bucket.active >= (options.concurrencyLimit ?? 32)
    ) {
      res.set('Retry-After', '60').status(429).json({ error: 'Request limit exceeded' });
      return;
    }
    bucket.active++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        bucket.active--;
      }
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
  const authenticate = async (req: Request): Promise<Actor | null> => {
    const bearer = req.get('authorization');
    if (!bearer?.startsWith('Bearer ')) return null;
    const token = bearer.slice(7);
    if (token.length > 8192) return null;
    const local = authenticateToken(store, token);
    if (local) return local;
    if (!jwks) return null;
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: options.oauthIssuer,
        audience: `${publicUrl.replace(/\/$/, '')}/mcp`,
        requiredClaims: ['exp', 'sub'],
      });
      if (!payload.sub) return null;
      const scopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : [];
      if (!scopes.includes('cubebench:compete')) return null;
      const principal: Actor = {
        id: `oauth:${payload.iss}:${payload.sub}`,
        role:
          options.trustedRunners?.includes(payload.sub) && scopes.includes('cubebench:run-ranked')
            ? 'runner'
            : 'community',
        clientIdentity: typeof payload.client_id === 'string' ? payload.client_id : payload.sub,
      };
      const existing = store.get<Actor>('identities', principal.id);
      if (!existing || existing.role !== principal.role)
        store.put('identities', principal.id, {
          ...principal,
          name: payload.sub,
          issuer: payload.iss,
          created_at: new Date().toISOString(),
        });
      return principal;
    } catch {
      return null;
    }
  };
  const unauthorized = (res: Response) =>
    res
      .set(
        'WWW-Authenticate',
        `Bearer resource_metadata="${publicUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource/mcp", scope="cubebench:compete"`,
      )
      .status(401)
      .json({ error: 'Bearer authentication required' });
  const browser = (req: Request, res: Response, create = false): Actor | undefined => {
    const token = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('cubebench_session='))
      ?.slice(18);
    const actor = token ? authenticateToken(store, token) : null;
    if (actor) return actor;
    if (!create) return undefined;
    const credential = issueAccessToken(store, 'Anonymous browser', 'community', 24 * 30);
    res.cookie('cubebench_session', credential.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: options.production ?? false,
      maxAge: 30 * 86400000,
      path: '/',
    });
    return credential.actor;
  };
  const csrf = (req: Request, res: Response, next: NextFunction) => {
    const expected = new URL(publicUrl).origin;
    const own = `${req.secure ? 'https' : 'http'}://${req.headers.host}`;
    if (
      req.get('X-CubeBench') !== '1' ||
      (req.get('origin') !== own && req.get('origin') !== expected)
    ) {
      res.status(403).json({ error: 'Same-origin mutation header required' });
      return;
    }
    next();
  };
  return { guard, authenticate, unauthorized, browser, csrf, publicUrl };
}
