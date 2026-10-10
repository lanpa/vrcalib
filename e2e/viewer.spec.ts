import { expect, test, type Page } from '@playwright/test';

// A landscape Android phone. Not a real device profile: it just needs
// touch, a high DPR and a landscape viewport.
test.use({
  viewport: { width: 892, height: 412 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
});

const PPI = 387;
// Cardboard v1 defaults (src/profile/defaults.ts).
const INTER_LENS = 0.0639;
const TRAY_TO_LENS = 0.035;
const BORDER = 0.003;

async function canvasSize(page: Page): Promise<[number, number]> {
  return page.locator('#view').evaluate((c: HTMLCanvasElement) => [c.width, c.height] as [number, number]);
}

async function probe(page: Page, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    ([x, y]) => (window as unknown as { vrcalib: { probe(x: number, y: number): number[] } }).vrcalib.probe(x, y),
    [x, y] as const,
  );
}

test('asks for PPI before Start, and shows the implied screen size', async ({ page }) => {
  await page.goto('view.html');
  await expect(page.locator('#start')).toBeDisabled();
  await page.locator('#ppi').fill('387');
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#screen-info')).toContainText('at 387 PPI');
});

test('Start requests fullscreen with an options object, then hides the overlay', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: unknown[][] = [];
    (window as unknown as { fsCalls: unknown[][] }).fsCalls = calls;
    const original = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (...args: unknown[]) {
      calls.push(args);
      return original.apply(this, args as [FullscreenOptions?]);
    };
  });
  await page.goto(`view.html?ppi=${PPI}`);
  await page.locator('#start').tap();
  const calls = await page.evaluate(() => (window as unknown as { fsCalls: unknown[][] }).fsCalls);
  // The wwgc bug was requestFullscreen(false); Chrome rejects non-objects.
  expect(calls).toEqual([[{ navigationUI: 'hide' }]]);
  await expect(page.locator('#overlay')).toBeHidden();
  expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(true);

  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator('#overlay')).toBeVisible();
});

test('PPI from the URL is remembered', async ({ page }) => {
  await page.goto(`view.html?ppi=${PPI}`);
  await page.goto('view.html');
  await expect(page.locator('#ppi')).toHaveValue(String(PPI));
});

test('red centre dots sit at the computed lens centres, on the centre cross', async ({ page }) => {
  await page.goto(`view.html?ppi=${PPI}`);
  const [w, h] = await canvasSize(page);
  expect(w).toBeGreaterThan(h);

  const pxPerM = PPI / 0.0254;
  const lensY = Math.round((TRAY_TO_LENS - BORDER) * pxPerM);
  const leftX = Math.round(w / 2 - (INTER_LENS / 2) * pxPerM);
  const rightX = Math.round(w / 2 + (INTER_LENS / 2) * pxPerM);

  const isRed = ([r, g, b]: number[]) => r! > 200 && g! < 40 && b! < 40;
  expect(isRed(await probe(page, leftX, lensY))).toBe(true);
  expect(isRed(await probe(page, rightX, lensY))).toBe(true);
  // Away from the centre, the grid scene is drawn instead.
  expect(isRed(await probe(page, leftX + 40, lensY + 40))).toBe(false);

  // Each dot sits exactly on the bold centre cross (the grid is at infinity),
  // so just beside it, along both arms, is cross colour, in both eyes.
  const isCross = ([r, g, b]: number[]) => r! < 140 && g! > 170 && b! > 200;
  for (const x of [leftX, rightX]) {
    for (const [dx, dy] of [[10, 0], [-10, 0], [0, 10], [0, -10]] as const) {
      expect(isCross(await probe(page, x + dx, lensY + dy)), `cross at ${x + dx},${lensY + dy}`).toBe(true);
    }
  }

  await page.evaluate(() =>
    (window as unknown as { vrcalib: { setShowCenter(on: boolean): void } }).vrcalib.setShowCenter(false),
  );
  expect(isRed(await probe(page, leftX, lensY))).toBe(false);
});
