import type { Request, Response } from 'express';
import type { CubeEvent } from '../../shared-contracts/src/index.ts';
export function streamEvents(
  req: Request,
  res: Response,
  read: (cursor: number) => CubeEvent[],
  initial: number,
) {
  let cursor = initial,
    closed = false,
    blocked = false;
  // Read before committing headers so authorization errors remain normal HTTP errors.
  const first = read(cursor);
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const send = (events: CubeEvent[]) => {
    for (const event of events) {
      const ready = res.write(`id: ${event.id}\nevent: cube\ndata: ${JSON.stringify(event)}\n\n`);
      cursor = event.id;
      if (!ready) {
        blocked = true;
        break;
      }
    }
  };
  send(first);
  const poll = setInterval(() => {
    if (closed || blocked) return;
    try {
      send(read(cursor));
    } catch {
      res.end();
    }
  }, 300);
  const heartbeat = setInterval(() => {
    if (!closed && !blocked) blocked = !res.write(': heartbeat\n\n');
  }, 15000);
  const drain = () => {
    blocked = false;
  };
  res.on('drain', drain);
  const close = () => {
    closed = true;
    clearInterval(poll);
    clearInterval(heartbeat);
    res.off('drain', drain);
  };
  res.on('close', close);
  req.on('aborted', close);
  return () => {
    close();
    res.end();
  };
}
