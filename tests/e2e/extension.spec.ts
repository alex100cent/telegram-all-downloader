import { test, expect } from './fixtures';
import { clickDownload, expectedHash, openFixture, type FixtureFile } from './web-k-fixture';
import { openAFixture } from './web-a-fixture';

test('Web A connects and saves with a meta CSP that forbids JavaScript eval', async ({
  context,
  popup,
}) => {
  const file: FixtureFile = { messageId: '502', size: 8_117, seed: 53 };
  const page = await openAFixture(context, [file], { metaCsp: true });
  await expect(popup.getByText('Connected', { exact: true })).toBeVisible();
  await page
    .locator('.Message[data-message-id="502"]')
    .getByRole('button', { name: 'Save file: Fixture-502.mp3', exact: true })
    .click();
  await expect(popup.locator('.job-card .job-status')).toContainText('Saved');
  expect(await page.evaluate(() => window.__telegramFixture.hash('Fixture-502.mp3'))).toEqual({
    size: file.size,
    hash: expectedHash(file),
  });
});

test('Web A uses the real Worker bridge to save unplayed audio with an exact final tail', async ({
  context,
  popup,
}) => {
  const file: FixtureFile = { messageId: '501', size: 512 * 1024 + 811, seed: 51 };
  const page = await openAFixture(context, [file]);
  await expect(popup.getByText('Connected', { exact: true })).toBeVisible();
  await page
    .locator('.Message[data-message-id="501"]')
    .getByRole('button', { name: 'Save file: Fixture-501.mp3', exact: true })
    .click();
  await expect(popup.locator('.job-card .job-status')).toContainText('Saved');
  expect(await page.evaluate(() => window.__telegramFixture.hash('Fixture-501.mp3'))).toEqual({
    size: file.size,
    hash: expectedHash(file),
  });
  expect(
    await page.evaluate(() => window.__telegramFixture.reads.map((read) => read.offset)),
  ).toEqual([0, 512 * 1024]);
  expect(await page.evaluate(() => window.__telegramFixture.playCalls)).toBe(0);
});

test('built MAIN → ISOLATED → background → popup flow commits exact bytes through native OPFS', async ({
  context,
  popup,
}) => {
  const file: FixtureFile = { messageId: '101', size: 512 * 1024 + 333, seed: 23 };
  const page = await openFixture(context, [file]);
  await expect(popup.getByText('Connected', { exact: true })).toBeVisible();
  await clickDownload(page, file.messageId);
  const card = popup.locator('.job-card').filter({ hasText: 'Fixture-101.bin' });
  await expect(card.locator('.job-status')).toContainText('Saved');
  expect(await page.evaluate(() => window.__telegramFixture.hash('Fixture-101.bin'))).toEqual({
    size: file.size,
    hash: expectedHash(file),
  });
  expect(
    await page.evaluate(() =>
      window.__telegramFixture.reads.map(({ offset, limit }) => ({ offset, limit })),
    ),
  ).toEqual([
    { offset: 0, limit: 512 * 1024 },
    { offset: 512 * 1024, limit: 4096 },
  ]);
  expect(await page.evaluate(() => window.__telegramFixture.playCalls)).toBe(0);
  await page.close();
  await popup.reload();
  await expect(popup.locator('.job-card .job-status')).toContainText('Saved');
});

test('queues separate user selections and keeps writing after the popup closes', async ({
  context,
  popup,
  extensionId,
}) => {
  const first: FixtureFile = { messageId: '201', size: 512 * 1024 + 99, seed: 5 };
  const second: FixtureFile = { messageId: '202', size: 9_007, seed: 97 };
  const page = await openFixture(context, [first, second]);
  await expect(popup.getByText('Connected', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__telegramFixture.hold('201', 0));
  await clickDownload(page, '201');
  await expect.poll(async () => page.evaluate(() => window.__telegramFixture.reads.length)).toBe(1);
  await clickDownload(page, '202');
  await expect(popup.locator('.job-card').filter({ hasText: 'Fixture-202.bin' })).toContainText(
    'Queued',
  );
  expect(await page.evaluate(() => window.__telegramFixture.reads.map((read) => read.id))).toEqual([
    '201',
  ]);
  await popup.close();
  await page.evaluate(() => window.__telegramFixture.release('201'));
  await expect(page.locator('.bubble[data-mid="202"]').getByRole('button')).toHaveAttribute(
    'aria-label',
    'Saved · Save again: Fixture-202.bin',
  );
  expect(await page.evaluate(() => window.__telegramFixture.hash('Fixture-201.bin'))).toEqual({
    size: first.size,
    hash: expectedHash(first),
  });
  expect(await page.evaluate(() => window.__telegramFixture.hash('Fixture-202.bin'))).toEqual({
    size: second.size,
    hash: expectedHash(second),
  });
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(reopened.locator('.job-status.success')).toHaveCount(2);
});

test('popup cancellation aborts the native writer and does not report a partial file as saved', async ({
  context,
  popup,
}) => {
  const file: FixtureFile = { messageId: '301', size: 2 * 512 * 1024 + 91, seed: 39 };
  const page = await openFixture(context, [file]);
  await expect(popup.getByText('Connected', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__telegramFixture.hold('301', 512 * 1024));
  await clickDownload(page, '301');
  await expect.poll(async () => page.evaluate(() => window.__telegramFixture.reads.length)).toBe(2);
  await popup.getByRole('button', { name: 'Cancel: Fixture-301.bin', exact: true }).click();
  const card = popup.locator('.job-card').filter({ hasText: 'Fixture-301.bin' });
  await expect(card.locator('.job-status')).toContainText('Cancelled');
  await page.evaluate(() => window.__telegramFixture.release('301'));
  expect((await page.evaluate(() => window.__telegramFixture.hash('Fixture-301.bin'))).size).toBe(
    0,
  );
  expect(await page.evaluate(() => window.__telegramFixture.reads.length)).toBe(2);
  await expect(card.locator('.job-status.success')).toHaveCount(0);
});

test('a stopped MV3 worker reconciles a running page writer without restarting the file', async ({
  context,
  extensionId,
}) => {
  const file: FixtureFile = { messageId: '401', size: 2 * 512 * 1024 + 37, seed: 41 };
  const page = await openFixture(context, [file]);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByText('Connected', { exact: true })).toBeVisible();
  await page.evaluate(() => window.__telegramFixture.hold('401', 512 * 1024));
  await clickDownload(page, '401');
  await expect.poll(async () => page.evaluate(() => window.__telegramFixture.reads.length)).toBe(2);
  await popup.close();

  const cdp = await context.newCDPSession(page);
  const versions = new Map<
    string,
    { versionId: string; scriptURL: string; runningStatus: string }
  >();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: updated }) => {
    for (const version of updated) versions.set(version.versionId, version);
  });
  await cdp.send('ServiceWorker.enable');
  await expect
    .poll(() =>
      [...versions.values()].some((version) =>
        version.scriptURL.startsWith(`chrome-extension://${extensionId}/`),
      ),
    )
    .toBe(true);
  const version = [...versions.values()].find((entry) =>
    entry.scriptURL.startsWith(`chrome-extension://${extensionId}/`),
  )!;
  await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  await expect.poll(() => versions.get(version.versionId)?.runningStatus).toBe('stopped');

  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(reopened.locator('.job-card').filter({ hasText: 'Fixture-401.bin' })).toContainText(
    'Downloading',
  );
  await page.evaluate(() => window.__telegramFixture.release('401'));
  await expect(reopened.locator('.job-status.success')).toHaveCount(1);
  expect(await page.evaluate(() => window.__telegramFixture.hash('Fixture-401.bin'))).toEqual({
    size: file.size,
    hash: expectedHash(file),
  });
  expect(
    await page.evaluate(() => window.__telegramFixture.reads.map((read) => read.offset)),
  ).toEqual([0, 512 * 1024, 2 * 512 * 1024]);
  await cdp.detach();
});
