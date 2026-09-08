import { test, expect } from '@playwright/test';
test('custom scramble solves and preserves undo redo', async ({ page }) => {
  await page.goto('/#human');
  await page.getByLabel('Scramble source').selectOption('custom');
  await page.getByLabel('Custom sequence').fill('R');
  await page.getByRole('button', { name: 'New scramble', exact: true }).click();
  await expect(page.getByTestId('scramble')).toHaveText('R');
  await page.getByRole('button', { name: "Turn R'", exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Solved');
  await page.getByRole('button', { name: 'Save completed solve', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('move-count')).toHaveText('0');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByTestId('move-count')).toHaveText('1');
});
test('seeded scramble is reproducible and keyboard moves work', async ({ page }) => {
  await page.goto('/#human');
  await page.getByLabel('Scramble source').selectOption('seed');
  await page.getByLabel('Seed', { exact: true }).fill('repeatable');
  await page.getByRole('button', { name: 'New scramble', exact: true }).click();
  const scramble = await page.getByTestId('scramble').textContent();
  await page.getByRole('button', { name: 'New scramble', exact: true }).click();
  await expect(page.getByTestId('scramble')).toHaveText(scramble!);
  await page.getByRole('heading', { name: 'Your next personal best.' }).click();
  await page.keyboard.press('r');
  await expect(page.getByTestId('move-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Reset to solved', exact: true }).click();
  await expect(page.getByTestId('move-count')).toHaveText('0');
});
test('mobile reduced motion has no horizontal overflow', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/#human');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByLabel('Cube size')).toBeVisible();
  await page.getByRole('button', { name: 'Toggle high contrast' }).click();
  await expect(page.getByRole('button', { name: 'Toggle high contrast' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
test('empty arena links to real match creation', async ({ page }) => {
  await page.route('**/api/matches', (r) => r.fulfill({ json: { matches: [] } }));
  await page.goto('/');
  await expect(page.getByText('The arena is yours.')).toBeVisible();
  await page.getByRole('link', { name: 'Create match', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Set the challenge.' })).toBeVisible();
});

test('creates a community match and keeps participant tokens out of storage and URL', async ({
  page,
}) => {
  await page.goto('/#create');
  await page.getByRole('button', { name: 'Create match', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your match is ready.' })).toBeVisible();
  const credentials = JSON.parse((await page.getByLabel('Participant credentials').textContent())!);
  expect(credentials.participants[0].tokens[0].participant_token.length).toBeGreaterThan(20);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    credentials.participants[0].tokens[0].participant_token,
  );
  expect(page.url()).not.toContain(credentials.participants[0].tokens[0].participant_token);
  await page.getByRole('link', { name: 'Open match' }).click();
  await expect(page.getByText('Waiting for the first reveal.')).toBeVisible();
});

test('orbit dragging does not turn the cube', async ({ page }) => {
  await page.goto('/#human');
  const box = await page.locator('canvas').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 100, box!.y + box!.height / 2 + 40, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(page.getByTestId('move-count')).toHaveText('0');
});
