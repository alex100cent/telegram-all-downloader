import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { clickDownload, openFixture, type FixtureFile } from './web-k-fixture';

async function failWriter(page: Page, stage: 'write' | 'close') {
  await page.evaluate((stage) => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async ({ suggestedName }: { suggestedName: string }) => {
        window.__telegramFixture.picked.push(suggestedName);
        const directory = await navigator.storage.getDirectory();
        const handle = await directory.getFileHandle(suggestedName, { create: true });
        return {
          async createWritable() {
            const writable = await handle.createWritable();
            let writes = 0;
            return {
              async write(data: FileSystemWriteChunkType) {
                if (stage === 'write' && ++writes === 2)
                  throw new DOMException('Simulated full disk', 'QuotaExceededError');
                await writable.write(data);
              },
              async close() {
                if (stage === 'write') return writable.close();
                await writable.abort();
                throw new DOMException('Simulated commit failure', 'InvalidStateError');
              },
              abort: (reason?: unknown) => writable.abort(reason),
            };
          },
        };
      },
    });
  }, stage);
}

for (const stage of ['write', 'close'] as const) {
  test(`a ${stage} failure aborts the file, reports disk_error and keeps diagnostics private`, async ({
    context,
    popup,
  }) => {
    const file: FixtureFile = { messageId: '601', size: 2 * 512 * 1024 + 91, seed: 13 };
    const page = await openFixture(context, [file]);
    await expect(popup.getByText('Connected', { exact: true })).toBeVisible();
    await failWriter(page, stage);
    await clickDownload(page, file.messageId);
    const card = popup.locator('.job-card').filter({ hasText: 'Fixture-601.bin' });
    await expect(card.locator('.job-status')).toContainText('Not saved');
    await expect(card.locator('.job-error')).toContainText('The file could not be written.');
    await expect(card.locator('.error-code')).toHaveText('Code: disk_error');
    await expect(page.locator('[data-tad-notice] p')).toContainText('Code: disk_error');
    await card.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    const report = await card.locator('.diagnostics-panel pre').textContent();
    expect(report).toContain('Telegram: Web K');
    expect(report).toContain('Attachment: document, application/octet-stream, 1 MiB');
    expect(report).toContain('Result: failed, disk_error');
    expect(report).not.toContain('Fixture-601');
    expect(report).not.toContain('web.telegram.org');
    expect((await page.evaluate(() => window.__telegramFixture.hash('Fixture-601.bin'))).size).toBe(
      0,
    );
    expect(
      await page.evaluate(() => window.__telegramFixture.reads.map((read) => read.offset)),
    ).toEqual(stage === 'write' ? [0, 512 * 1024] : [0, 512 * 1024, 2 * 512 * 1024]);
    await expect(card.locator('.job-status.success')).toHaveCount(0);
  });
}

for (const action of ['close', 'reload'] as const) {
  test(`a source tab ${action} during transfer becomes an interruption, not a saved file`, async ({
    context,
    popup,
  }) => {
    const file: FixtureFile = { messageId: '701', size: 2 * 512 * 1024 + 7, seed: 71 };
    const page = await openFixture(context, [file]);
    await expect(popup.getByText('Connected', { exact: true })).toBeVisible();
    await page.evaluate(() => window.__telegramFixture.hold('701', 512 * 1024));
    await clickDownload(page, file.messageId);
    await expect.poll(() => page.evaluate(() => window.__telegramFixture.reads.length)).toBe(2);
    const card = popup.locator('.job-card').filter({ hasText: 'Fixture-701.bin' });
    await expect(card).toContainText('Downloading');
    let inspector = page;
    if (action === 'close') {
      await page.close();
      inspector = await context.newPage();
      await inspector.goto('https://web.telegram.org/k/');
    } else await page.reload();
    await expect(card.locator('.job-status')).toContainText('Interrupted');
    await expect(card.locator('.job-error')).toContainText(
      'The Telegram tab that was saving this file was closed, reloaded or left Telegram.',
    );
    await expect(card.locator('.error-code')).toHaveText('Code: interrupted');
    expect(
      (await inspector.evaluate(() => window.__telegramFixture.hash('Fixture-701.bin'))).size,
    ).toBe(0);
    await expect(popup.locator('.job-status.success')).toHaveCount(0);
  });
}

test('the popup and manifest identify the same installed build', async ({ popup }) => {
  const manifest = await popup.evaluate(() => chrome.runtime.getManifest());
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  const build = await popup.locator('.about-build dd code').textContent();
  expect(build).toMatch(/^[0-9a-f]{7}(-modified\.[0-9a-f]{8})?$|^unversioned$/);
  expect(manifest.version_name).toBe(`${manifest.version} (${build})`);
  await expect(popup.locator('.about-build dd').first()).toHaveText(manifest.version);
});
