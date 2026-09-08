import { test, expect } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { resolve } from 'node:path';
import { z } from 'zod';
import { SqliteRepository, issueAccessToken } from '../../packages/persistence/src/index';
import { invertMoves, parseMoves, serializeMoves } from '../../packages/cube-core/src/index';
import { toolSuccessOutputs, type ToolName } from '../../packages/shared-contracts/src/index';

for (const league of ['sprint', 'live'] as const) {
  test(`real ${league} MCP solve reaches browser SSE and survives reload`, async ({
    page,
    baseURL,
  }) => {
    // Fixture setup provisions only a community identity. The HTTP service owns every run mutation.
    const repository = new SqliteRepository(resolve('.data/e2e/cubebench.sqlite'));
    const client = new Client({ name: 'cubebench-browser-acceptance', version: '1.0.0' });
    try {
      const { token } = issueAccessToken(repository, `Browser acceptance ${league}`, 'community');
      await client.connect(
        new StreamableHTTPClientTransport(new URL('/mcp', baseURL), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      const call = async <N extends ToolName>(name: N, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args });
        return toolSuccessOutputs[name].parse(result.structuredContent) as z.output<
          (typeof toolSuccessOutputs)[N]
        >;
      };
      const match = await call('cubebench_create_match', {
        league,
        size: 3,
        entrant_count: 1,
        trial_count: 1,
        ranked: false,
        visibility: 'public',
      });
      const participant = match.participants[0]!;
      const credential = participant.tokens[0]!;
      const started = await call('cubebench_start_run', {
        match_id: match.match_id,
        participant_id: participant.participant_id,
        round_id: credential.round_id,
        participant_token: credential.participant_token,
        metadata: { display_name: `Actual ${league} runner` },
      });
      await page.goto('/#match/' + match.match_id);
      await expect(page.getByText('Connected', { exact: true })).toBeVisible();
      await expect(page.getByText('run started', { exact: true })).toBeVisible();
      const row = page.locator(`a[href="#run/${started.run.run_id}"]`);
      await expect(row).toContainText('0 moves');
      await expect(row).toContainText('active');

      // A known inverse is a deterministic test fixture, never a production solver or tool.
      const inverse = invertMoves(parseMoves(started.run.scramble, started.run.size));
      const runArgs = {
        match_id: match.match_id,
        participant_id: participant.participant_id,
        run_id: started.run.run_id,
        run_token: started.run_token,
      };
      if (league === 'sprint') {
        const submitted = await call('cubebench_submit_solution', {
          ...runArgs,
          sequence: serializeMoves(inverse),
        });
        expect(submitted.result?.success).toBe(true);
      } else {
        for (let index = 0; index < inverse.length; index += 12) {
          const batch = await call('cubebench_apply_moves', {
            ...runArgs,
            sequence: serializeMoves(inverse.slice(index, index + 12)),
          });
          if (index + 12 >= inverse.length) expect(batch.result?.success).toBe(true);
        }
      }
      await expect(row).toContainText(`${inverse.length} moves`);
      await expect(row).toContainText('solved');
      await expect(row).toContainText('#1 in round');
      await expect(row).toContainText(/\d+ calls/);
      await expect(page.getByText('cube solved', { exact: true })).toBeVisible();
      await expect(page.getByText('match completed', { exact: true })).toBeVisible();
      expect(Number(await page.getByLabel('Event playback').getAttribute('max'))).toBeGreaterThan(
        inverse.length,
      );

      // Reload starts a fresh browser subscription and restores the committed event history.
      await page.reload();
      await expect(page.getByText('Connected', { exact: true })).toBeVisible();
      await expect(row).toContainText(`${inverse.length} moves`);
      await expect(row).toContainText('solved');
      await expect(row).toContainText('#1 in round');
      await expect(row).toContainText(/\d+ calls/);
      await expect(page.getByText('cube solved', { exact: true })).toBeVisible();
      await expect(page.getByText('match completed', { exact: true })).toBeVisible();
      const results = await call('cubebench_get_results', { match_id: match.match_id });
      expect(results.results).toHaveLength(1);
      expect(results.results[0]?.success).toBe(true);
      expect(results.results[0]?.verification).toBe('community');
    } finally {
      try {
        await client.close();
      } finally {
        repository.close();
      }
    }
  });
}
