import { test, expect } from '@playwright/test';

/**
 * Step 7 (hardening) — the failure paths, driven for real.
 *
 * The whole promise of a boundary is "the app survives the broken part". That claim
 * is worthless until something has actually been broken and the app observed to
 * survive it, so nothing here mocks a fallback: WebGL is genuinely removed and a
 * component genuinely throws.
 */

/** The mid-range Android / GPU-blocklisted browser, reproduced: no WebGL context, at all. */
async function disableWebGL(page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (typeof type === 'string' && type.includes('webgl')) return null;
      return original.call(this, type, ...rest);
    };
  });
}

async function planJourney(page) {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'From' }).fill('nehru');
  await page.getByRole('listbox').getByRole('option').first().click();
  await page.getByRole('combobox', { name: 'To' }).fill('kalkaji');
  await page.getByRole('listbox').getByRole('option').first().click();
}

test('no WebGL: the map degrades, and the journey it sits under still works', async ({ page }) => {
  await disableWebGL(page);
  await planJourney(page);
  await page.locator('[aria-pressed]').first().click();

  // The map itself is gone...
  await expect(page.getByText(/couldn.t load/i)).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);

  // ...and THIS is the assertion that matters: without the boundary, MapLibre's throw
  // unmounts the whole tree and every one of these disappears with it.
  // (A *selected* stop is a chip with a Change button, not a combobox any more.)
  await expect(page.locator('[aria-pressed]').first()).toContainText('764');
  await expect(page.getByText('Nehru Place').first()).toBeVisible();
  await expect(page.getByText('Kalkaji Mandir').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'BusNavigator' })).toBeVisible();
});

test('no WebGL: departure times — the actual reason someone opened the app — survive', async ({
  page,
}) => {
  await disableWebGL(page);
  await planJourney(page);
  await page.locator('[aria-pressed]').first().click();

  // A person standing at a stop needs the time of the next bus, not a picture of it.
  await expect(page.locator('[aria-pressed]').first()).toContainText(
    /\d{2}:\d{2}|No more buses today/,
  );
});

test('a component that throws is contained, and the boundary can be re-armed', async ({ page }) => {
  await page.goto('/design-system');

  await page.getByRole('button', { name: 'Break it' }).click();

  // Scoped by text: this page also renders a *static* ErrorState demo, which is
  // itself role="alert". We want the one the boundary produced, not that one.
  const fallback = page.getByRole('alert').filter({ hasText: 'Something broke on this screen' });
  await expect(fallback).toBeVisible();

  // The page around it is untouched — that is what "scoped tightly" means.
  await expect(page.getByRole('heading', { name: 'Design system' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find my bus' })).toBeVisible();

  // An error state without a way out is a dead end: retry must genuinely recover.
  await fallback.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Break it' })).toBeVisible();
  await expect(fallback).toHaveCount(0);
});

test('an unknown URL gets a way onward, not an error', async ({ page }) => {
  const res = await page.goto('/no-such-page');

  expect(res.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'No such stop' })).toBeVisible();
  await page.getByRole('link', { name: 'Plan a journey' }).click();
  await expect(page.getByRole('combobox', { name: 'From' })).toBeVisible();
});
