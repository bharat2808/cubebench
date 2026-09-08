import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildServer } from './catalog.ts';
const base = new URL(process.env.CUBEBENCH_URL ?? 'http://127.0.0.1:4310');
if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Invalid service URL');
if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  throw new Error('Remote service requires HTTPS');
const token = process.env.CUBEBENCH_TOKEN;
if (!token) {
  process.stderr.write(
    'CUBEBENCH_TOKEN is required. Start the CubeBench service and provision a local credential first.\n',
  );
  process.exitCode = 1;
} else {
  await serveStdio(() =>
    buildServer(async (name, args, clientIdentity) => {
      const response = await fetch(new URL(`/internal/tools/${name}`, base), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(clientIdentity ? { 'X-CubeBench-Client': clientIdentity } : {}),
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`CubeBench service rejected request (${response.status})`);
      return response.json();
    }),
  );
}
