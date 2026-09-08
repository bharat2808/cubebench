import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { streamEvents } from '../packages/realtime/src/index.ts';
import { createSolved } from '../packages/cube-core/src/index.ts';
import type { CubeEvent } from '../packages/shared-contracts/src/index.ts';
afterEach(() => vi.useRealTimers());
it('pauses a larger snapshot replay on backpressure and resumes without skipping cursor events', () => {
  vi.useFakeTimers();
  const events: CubeEvent[] = Array.from({ length: 3 }, (_, i) => ({
    id: i + 1,
    match_id: 'fixture',
    round_id: null,
    run_id: null,
    type: 'cube_state_updated',
    at: new Date(0).toISOString(),
    elapsed_ms: 0,
    move: null,
    state: createSolved(7),
    run: null,
    previous_hash: '',
    hash: '',
  }));
  const read = vi.fn((cursor: number) => events.filter((event) => event.id > cursor));
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    flushHeaders: vi.fn(),
    write: vi.fn().mockReturnValueOnce(false).mockReturnValue(true),
    end: vi.fn(),
  });
  const stop = streamEvents(req as Request, res as unknown as Response, read, 0);
  expect(res.write).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(16000);
  expect(read).toHaveBeenCalledTimes(1);
  expect(res.write).toHaveBeenCalledTimes(1);
  res.emit('drain');
  vi.advanceTimersByTime(300);
  expect(read).toHaveBeenLastCalledWith(1);
  expect(res.write.mock.calls.map((call) => String(call[0]).match(/^id: (\d+)/)?.[1])).toEqual([
    '1',
    '2',
    '3',
  ]);
  stop();
  vi.advanceTimersByTime(16000);
  expect(res.write).toHaveBeenCalledTimes(3);
  expect(res.listenerCount('drain')).toBe(0);
});
