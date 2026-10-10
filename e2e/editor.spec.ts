import { expect, test, type Page } from '@playwright/test';

const V1_URI =
  'http://google.com/cardboard/cfg?p=CgZHb29nbGUSDENhcmRib2FyZCB2MR0J-SA9JQHegj0qEAAAIEIAACBCAAAgQgAAIEJYADUpXA89Ogjp8as-hbENP1AAYAA';

const field = (page: Page, name: string) => page.locator(`#profile-form [name="${name}"]`);
const uri = (page: Page) => page.locator('#cfg-uri');

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('starts from Cardboard v1', async ({ page }) => {
  await expect(uri(page)).toHaveText(V1_URI);
  await expect(field(page, 'screenToLens')).toHaveValue('39.3');
  await expect(field(page, 'k1')).toHaveValue('0.336');
  await expect(field(page, 'fovL')).toHaveValue('40');
  await expect(page.locator('#warnings li')).toHaveCount(0);
});

test('Tab visits fields in the calibration order', async ({ page }) => {
  await field(page, 'vendor').focus();
  const order = ['vendor'];
  for (let i = 0; i < 13; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => (document.activeElement as HTMLInputElement).name));
  }
  expect(order).toEqual([
    'vendor', 'model', 'screenToLens', 'interLens', 'verticalAlignment', 'trayToLens',
    'k1', 'k2', 'fovL', 'fovR', 'fovB', 'fovT', 'hasMagnet', 'primaryButton',
  ]);
});

test('arrow keys step values; Shift steps ×10', async ({ page }) => {
  await field(page, 'k1').focus();
  await page.keyboard.press('ArrowUp');
  await expect(field(page, 'k1')).toHaveValue('0.346');
  await expect(uri(page)).not.toHaveText(V1_URI);
  await page.keyboard.press('ArrowDown');
  await expect(field(page, 'k1')).toHaveValue('0.336');

  await field(page, 'screenToLens').focus();
  await page.keyboard.press('Shift+ArrowUp');
  await expect(field(page, 'screenToLens')).toHaveValue('44.3');

  await field(page, 'fovT').focus();
  await page.keyboard.press('ArrowDown');
  await expect(field(page, 'fovT')).toHaveValue('39');
});

test('typing a value updates the export; invalid text is flagged', async ({ page }) => {
  await field(page, 'interLens').fill('60');
  await expect(uri(page)).not.toHaveText(V1_URI);
  await field(page, 'interLens').fill('6x');
  await expect(field(page, 'interLens')).toHaveAttribute('aria-invalid', 'true');
  await field(page, 'k1').focus();
  await expect(field(page, 'interLens')).toHaveValue('60.0');
});

test('CENTER pins tray-to-lens at 35 mm and restores it after', async ({ page }) => {
  await field(page, 'trayToLens').fill('30');
  await field(page, 'verticalAlignment').selectOption('1');
  await expect(field(page, 'trayToLens')).toBeDisabled();
  await expect(field(page, 'trayToLens')).toHaveValue('35.0');
  await field(page, 'verticalAlignment').selectOption('0');
  await expect(field(page, 'trayToLens')).toHaveValue('30.0');
});

test('MAGNET button implies has_magnet', async ({ page }) => {
  await field(page, 'primaryButton').selectOption('1');
  await expect(field(page, 'hasMagnet')).toBeChecked();
  await expect(field(page, 'hasMagnet')).toBeDisabled();
});

test('k1 = k2 = 0 warns', async ({ page }) => {
  await field(page, 'k1').fill('0');
  await field(page, 'k2').fill('0');
  await expect(page.locator('#warnings')).toContainText('k1 and k2 are both 0');
});

test('import loads a profile, rejects junk, and reset restores v1', async ({ page }) => {
  await field(page, 'k1').fill('0.5');
  await page.locator('#import-input').fill('https://www.google.com/cardboard/cfg?p=abc');
  await page.locator('#import-button').click();
  await expect(page.locator('#import-status')).toContainText('Could not load');

  await page.locator('#import-input').fill(V1_URI);
  await page.locator('#import-input').press('Enter');
  await expect(page.locator('#import-status')).toContainText('Loaded Google Cardboard v1');
  await expect(uri(page)).toHaveText(V1_URI);

  await field(page, 'k1').fill('0.5');
  await page.locator('#reset-button').click();
  await expect(uri(page)).toHaveText(V1_URI);
});

test('QR is drawn', async ({ page }) => {
  const dark = await page.locator('#qr').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 128) n++;
    return n;
  });
  expect(dark).toBeGreaterThan(1000);
});
