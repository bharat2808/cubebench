import { createServer } from 'node:http';
import { resolve } from 'node:path';
import express from 'express';
import { SqliteRepository } from '../../persistence/src/index.ts';
import { BenchmarkService } from '../../benchmark-core/src/index.ts';
import { createApp } from './index.ts';
const list = (name: string) =>
  process.env[name]
    ?.split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const store = new SqliteRepository(process.env.CUBEBENCH_DB ?? '.data/cubebench.sqlite');
const service = new BenchmarkService(store, {
  signingKeyPath: process.env.CUBEBENCH_SIGNING_KEY ?? '.data/signing-key.pem',
});
service.recoverInterrupted();
const { app, close } = createApp(service, store, {
  publicUrl: process.env.CUBEBENCH_PUBLIC_URL,
  allowedHosts: list('CUBEBENCH_ALLOWED_HOSTS'),
  allowedOrigins: list('CUBEBENCH_ALLOWED_ORIGINS'),
  oauthIssuer: process.env.CUBEBENCH_OAUTH_ISSUER,
  oauthJwks: process.env.CUBEBENCH_OAUTH_JWKS,
  trustedRunners: list('CUBEBENCH_TRUSTED_RUNNERS'),
  production: process.env.NODE_ENV === 'production',
});
let vite: import('vite').ViteDevServer | undefined;
if (process.argv.includes('--dev')) {
  vite = await (
    await import('vite')
  ).createServer({
    configFile: resolve('packages/web/vite.config.ts'),
    server: { middlewareMode: true },
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(resolve('dist/web')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/web/index.html')));
}
const http = createServer(app);
http.listen(Number(process.env.PORT ?? 4310), process.env.HOST ?? '127.0.0.1', () =>
  process.stderr.write(
    `CubeBench listening on ${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 4310}\n`,
  ),
);
const sweep = setInterval(() => service.sweep(), 250);
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  clearInterval(sweep);
  await close();
  await vite?.close();
  http.close(() => {
    service.close();
    store.close();
  });
  http.closeIdleConnections();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
