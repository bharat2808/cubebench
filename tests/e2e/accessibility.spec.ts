import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('human controls have accessible names and contrast in both display modes', async ({
  page,
}) => {
  await page.goto('/#human');
  const normal = await new AxeBuilder({ page }).analyze();
  expect(normal.violations).toEqual([]);
  await page.getByRole('button', { name: 'Toggle high contrast' }).click();
  const high = await new AxeBuilder({ page }).analyze();
  expect(high.violations).toEqual([]);
});
