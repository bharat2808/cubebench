import { test, expect } from '@playwright/test';
import { applyMoves, createSolved } from '../../packages/cube-core/src/index';
const state = applyMoves(createSolved(3), 'R');
for (const league of ['sprint', 'live']) {
  test(`${league} restores event history, reconnects and keeps visual pause separate`, async ({
    page,
  }) => {
    const run = {
      run_id: 'run-a',
      match_id: 'match-a',
      size: 3,
      league,
      metadata: { display_name: 'Test runner' },
      state,
      scramble: 'R',
      move_count: 0,
      elapsed_ms: 100,
      status: 'active',
      tool_call_count: 1,
      verification: 'community',
    };
    const match = {
      match_id: 'match-a',
      league,
      size: 3,
      entrant_count: 1,
      trial_count: 1,
      status: 'active',
      runs: [run],
    };
    const started = {
      id: 1,
      run_id: 'run-a',
      match_id: 'match-a',
      type: 'run_started',
      state,
      move: null,
      elapsed_ms: 0,
    };
    await page.route('**/api/matches/match-a', (r) => r.fulfill({ json: { match } }));
    await page.route('**/api/matches/match-a/events?after=0', (r) =>
      r.fulfill({ json: { events: [started], cursor: 1 } }),
    );
    await page.addInitScript(() => {
      class Stream extends EventTarget {
        static CLOSED = 2;
        static OPEN = 1;
        static CONNECTING = 0;
        onopen: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(public url: string) {
          super();
          (window as unknown as { stream: Stream }).stream = this;
          setTimeout(() => this.onopen?.(), 50);
        }
        close() {}
      }
      Object.defineProperty(window, 'EventSource', { value: Stream });
    });
    await page.goto('/#match/match-a');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await expect(page.getByText('run started', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { stream: { url: string } }).stream.url),
    ).toContain('after=1');
    await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
    await page.evaluate((cubeState) => {
      const stream = (
        window as unknown as { stream: EventTarget & { onerror: () => void; onopen: () => void } }
      ).stream;
      stream.onerror();
      stream.dispatchEvent(
        new MessageEvent('cube', {
          data: JSON.stringify({
            id: 2,
            run_id: 'run-a',
            type: 'move_accepted',
            move: "R'",
            state: cubeState,
            elapsed_ms: 100,
          }),
        }),
      );
    }, createSolved(3));
    await expect(page.getByText('Reconnecting', { exact: true })).toBeVisible();
    await expect(page.getByText("move accepted R'", { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume playback', exact: true })).toBeVisible();
    await page.evaluate(() =>
      (window as unknown as { stream: { onopen: () => void } }).stream.onopen(),
    );
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await page.getByLabel('Event playback').fill('1');
    await expect(page.getByText("move accepted R'", { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Jump to live', exact: true }).click();
    await expect(page.getByText("move accepted R'", { exact: true })).toBeVisible();
  });
}
test('verified and community leaderboards request separate result classes', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/leaderboard?**', (r) => {
    requests.push(r.request().url());
    return r.fulfill({ json: { rows: [] } });
  });
  await page.goto('/#leaderboard/verified');
  await expect(page.getByText('An open field.')).toBeVisible();
  await expect.poll(() => requests.some((r) => r.includes('result_class=verified'))).toBe(true);
  await page.getByRole('link', { name: 'Community board' }).click();
  await expect.poll(() => requests.some((r) => r.includes('result_class=community'))).toBe(true);
  await page.getByLabel('League', { exact: true }).selectOption('live');
  await expect
    .poll(() =>
      requests.some((r) => r.includes('league=live') && r.includes('result_class=community')),
    )
    .toBe(true);
});
