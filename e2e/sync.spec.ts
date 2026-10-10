// Editor (laptop) ↔ viewer (phone) through the Firebase emulators.
// Each device gets its own browser context, so its own anonymous user.

import { expect, test, type Page } from '@playwright/test';

const field = (page: Page, name: string) => page.locator(`#profile-form [name="${name}"]`);

interface ViewerState {
  profile: string;
  showCenter: boolean;
}
const viewerState = (page: Page) =>
  page.evaluate(() => (window as unknown as { vrcalib: { state(): ViewerState } }).vrcalib.state());

async function openEditor(page: Page, path = './'): Promise<string> {
  await page.goto(path);
  await expect(page.locator('#link-status')).toHaveAttribute('data-state', 'waiting');
  const sid = new URL(page.url()).searchParams.get('s');
  expect(sid).toMatch(/^[A-Za-z0-9_-]{22}$/);
  return sid!;
}

test('the phone follows the editor live, and the editor sees the phone', async ({ page, browser }) => {
  const sid = await openEditor(page);
  const pairUrl = await page.locator('#pair-link').getAttribute('href');
  expect(pairUrl).toMatch(new RegExp(`/vrcalib/view\\.html\\?s=${sid}$`));

  const phoneContext = await browser.newContext();
  const phone = await phoneContext.newPage();
  await phone.goto(pairUrl!);
  await expect(phone.locator('#link-status')).toHaveAttribute('data-state', 'live');
  await expect(page.locator('#link-status')).toHaveText('Phone connected');

  // Edit on the laptop → the phone's profile changes.
  const before = await viewerState(phone);
  await field(page, 'k1').focus();
  await page.keyboard.press('ArrowUp');
  const after = await page.locator('#cfg-uri').textContent();
  expect(after).not.toBe(before.profile);
  await expect.poll(async () => (await viewerState(phone)).profile).toBe(after);

  await page.locator('#show-center').uncheck();
  await expect.poll(async () => (await viewerState(phone)).showCenter).toBe(false);

  // The phone leaves → the editor notices.
  await phoneContext.close();
  await expect(page.locator('#link-status')).toHaveAttribute('data-state', 'waiting');
});

test('reloading the editor resumes its session and profile', async ({ page }) => {
  const sid = await openEditor(page);
  await field(page, 'k1').fill('0.42');
  await field(page, 'model').fill('Resumed viewer');
  await page.waitForTimeout(300); // let the write reach the emulator
  await page.reload();
  await expect(page.locator('#link-status')).toHaveAttribute('data-state', 'waiting');
  expect(new URL(page.url()).searchParams.get('s')).toBe(sid);
  await expect(field(page, 'k1')).toHaveValue('0.420');
  await expect(field(page, 'model')).toHaveValue('Resumed viewer');
});

test("another browser can't take over a session: it gets its own", async ({ page, browser }) => {
  const sid = await openEditor(page);
  await page.waitForTimeout(300);
  const other = await (await browser.newContext()).newPage();
  const otherSid = await openEditor(other, `./?s=${sid}`);
  expect(otherSid).not.toBe(sid);
});

test('a viewer without a session shows Cardboard v1 and says so', async ({ page }) => {
  await page.goto('view.html');
  await expect(page.locator('#link-status')).toHaveAttribute('data-state', 'none');
});
