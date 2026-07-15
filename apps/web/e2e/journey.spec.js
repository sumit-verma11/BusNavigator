import { test, expect } from '@playwright/test';

/**
 * These run against a REAL API with the fixture feed ingested (3 Delhi stops,
 * routes 764 and 500). They exist because the unit tests and the build were both
 * green while the app was visibly broken: a bad token config gave the map 0px of
 * height, and an "is there a canvas?" check happily passed on a zero-height canvas.
 *
 * So: assert DIMENSIONS and BEHAVIOUR, not the existence of DOM nodes.
 */

// Viewport/browser come from playwright.config.js (iPhone 14 Pro on Chromium).

async function planJourney(page) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'From' }).fill('nehru');
  await page.getByRole('listbox').getByRole('option').first().click();
  await page.getByRole('combobox', { name: 'To' }).fill('kalkaji');
  await page.getByRole('listbox').getByRole('option').first().click();
}

test('layout: interactive controls meet the 44px touch target', async ({ page }) => {
  await page.goto('/');

  // The regression that shipped: `h-11` resolved to 0px, so every input and button
  // silently lost its touch target while still "looking fine" on a desktop screen.
  const input = page.getByRole('combobox', { name: 'From' });
  const box = await input.boundingBox();
  expect(box.height, 'text input must be at least 44px tall').toBeGreaterThanOrEqual(44);
});

test('the region picker is populated from the API', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('select[name="region"]')).toContainText('Delhi');
});

test('a stop can be chosen with the keyboard alone', async ({ page }) => {
  await page.goto('/');
  const from = page.getByRole('combobox', { name: 'From' });
  await from.fill('nehru');
  await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();

  await from.press('ArrowDown');
  await from.press('Enter');

  await expect(page.getByText('Nehru Place')).toBeVisible();
});

test('a direct route is found, with departure times', async ({ page }) => {
  await planJourney(page);

  const card = page.locator('[aria-pressed]').first();
  await expect(card).toContainText('764');
  await expect(card).toContainText(/\d{2}:\d{2}|No more buses today/);
});

test('the map has real height and the page can scroll to it', async ({ page }) => {
  await planJourney(page);
  await page.locator('[aria-pressed]').first().click();

  // THE regression test. A zero-height map is what made the page unscrollable.
  const map = page.locator('canvas').first();
  await expect(map).toBeVisible();
  const box = await map.boundingBox();
  expect(box.height, 'the map must actually occupy vertical space').toBeGreaterThan(200);

  const scroll = await page.evaluate(() => ({
    max: document.body.scrollHeight - window.innerHeight,
  }));
  expect(scroll.max, 'with a map open the page must be taller than the screen').toBeGreaterThan(
    100,
  );

  await page.evaluate(() => window.scrollTo(0, 99999));
  const y = await page.evaluate(() => window.scrollY);
  expect(y, 'the page must actually scroll').toBeGreaterThan(100);
});

test('a region without realtime shows the stale banner, not an error', async ({ page }) => {
  await planJourney(page);
  await page.locator('[aria-pressed]').first().click();

  await expect(page.getByRole('status')).toContainText(/Live tracking is not available/i);
});

test('no direct bus in the reverse direction says so honestly', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'From' }).fill('kalkaji');
  await page.getByRole('listbox').getByRole('option').first().click();
  await page.getByRole('combobox', { name: 'To' }).fill('nehru');
  await page.getByRole('listbox').getByRole('option').first().click();

  // Route 764 runs Nehru -> Kalkaji only; the reverse has no direct bus in the
  // fixture. The copy must explain that, not imply the journey is impossible.
  await expect(page.getByText('No direct bus')).toBeVisible();
});
