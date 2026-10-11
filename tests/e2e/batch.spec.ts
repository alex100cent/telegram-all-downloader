import type { BrowserContext, Locator, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { JobRecord } from '../../src/domain/jobs';
import { test, expect } from './fixtures';
import { openAFixture } from './web-a-fixture';
import { expectedHash, openFixture, type FixtureFile } from './web-k-fixture';

const CHUNK = 512 * 1024;
const name = (file: FixtureFile) => file.filename ?? `Fixture-${file.messageId}.bin`;

async function openManager(context: BrowserContext, extensionId: string): Promise<Page> {
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  await expect(manager.locator('.manager-panel')).toBeVisible();
  return manager;
}

async function jobs(manager: Page): Promise<JobRecord[]> {
  const reply = (await manager.evaluate(async () =>
    chrome.runtime.sendMessage({ scope: 'tad-ui', type: 'list' }),
  )) as { ok: boolean; jobs: JobRecord[] };
  expect(reply.ok).toBe(true);
  return reply.jobs;
}

async function states(manager: Page, expected: Record<string, string>): Promise<void> {
  await expect
    .poll(async () =>
      Object.fromEntries(
        (await jobs(manager)).map((job) => [job.media.identity.messageId, job.state]),
      ),
    )
    .toEqual(expected);
}

async function folderPicker(
  page: Page,
  folder: string,
  existing: Array<{ filename: string; content: string }> = [],
): Promise<void> {
  await page.evaluate(
    async ({ folder, existing }) => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(folder, { create: true });
      for (const file of existing) {
        const handle = await directory.getFileHandle(file.filename, { create: true });
        const writer = await handle.createWritable();
        await writer.write(file.content);
        await writer.close();
      }
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: () => {
          window.__telegramFixture.directoryPicks.push(folder);
          window.__telegramFixture.directoryPickerActivations.push(
            navigator.userActivation.isActive,
          );
          return Promise.resolve(directory);
        },
      });
    },
    { folder, existing },
  );
}

async function batchPanel(page: Page, files: FixtureFile[]): Promise<Locator> {
  for (const file of files) {
    await expect(
      page.locator(`.bubble[data-mid="${file.messageId}"]`).getByRole('button', {
        name: `Save file: ${name(file)}`,
        exact: true,
      }),
    ).toBeEnabled();
  }
  await page.getByRole('button', { name: 'Download several', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Download several', exact: true });
  await expect(dialog.getByRole('checkbox')).toHaveCount(files.length);
  await dialog.getByRole('button', { name: 'Select all shown', exact: true }).click();
  return dialog;
}

async function hash(page: Page, folder: string, filename: string) {
  return page.evaluate(({ folder, filename }) => window.__telegramFixture.hash(filename, folder), {
    folder,
    filename,
  });
}

function contentHash(content: string) {
  return {
    size: Buffer.byteLength(content),
    hash: createHash('sha256').update(content).digest('hex'),
  };
}

test('batch uses one folder picker and saves two exact files sequentially after the panel closes', async ({
  context,
  extensionId,
}, testInfo) => {
  const files: FixtureFile[] = [
    { messageId: '801', size: CHUNK + 317, seed: 81 },
    { messageId: '802', size: 9_117, seed: 82 },
  ];
  const page = await openFixture(context, files);
  const manager = await openManager(context, extensionId);
  await folderPicker(page, 'batch-sequential');
  await page.evaluate((offset) => window.__telegramFixture.hold('801', offset), CHUNK);
  const panel = await batchPanel(page, files);
  await panel.getByRole('button', { name: 'Choose folder and download', exact: true }).click();
  await states(manager, { '801': 'downloading', '802': 'queued' });
  await expect
    .poll(() =>
      page.evaluate(() => window.__telegramFixture.reads.map(({ id, offset }) => ({ id, offset }))),
    )
    .toEqual([
      { id: '801', offset: 0 },
      { id: '801', offset: CHUNK },
    ]);
  await expect(manager.locator('.manager-jobs .job-card')).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('batch-panel.png'), fullPage: true });
  await manager.screenshot({ path: testInfo.outputPath('manager-en-light.png'), fullPage: true });
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.evaluate(() => window.__telegramFixture.release('801'));
  await states(manager, { '801': 'completed', '802': 'completed' });
  for (const file of files)
    expect(await hash(page, 'batch-sequential', name(file))).toEqual({
      size: file.size,
      hash: expectedHash(file),
    });
  expect(await page.evaluate(() => window.__telegramFixture.directoryPicks)).toEqual([
    'batch-sequential',
  ]);
  expect(await page.evaluate(() => window.__telegramFixture.directoryPickerActivations)).toEqual([
    true,
  ]);
  expect(await page.evaluate(() => window.__telegramFixture.picked)).toEqual([]);
  const saved = await jobs(manager);
  expect(new Set(saved.map((job) => job.batchId)).size).toBe(1);
  expect(saved.every((job) => Boolean(job.batchId))).toBe(true);
  expect(await page.evaluate(() => window.__telegramFixture.playCalls)).toBe(0);
  await manager.evaluate(() =>
    chrome.runtime.sendMessage({
      scope: 'tad-ui',
      type: 'settings',
      settings: { language: 'ru', theme: 'dark', keepHistory: true },
    }),
  );
  await expect(manager.locator('.job-status.success').first()).toContainText('Сохранено');
  await manager.screenshot({ path: testInfo.outputPath('manager-ru-dark.png'), fullPage: true });
});

test('Web A batches two exact attachments through its Worker bridge and one folder choice under CSP', async ({
  context,
  extensionId,
}) => {
  const files: FixtureFile[] = [
    { messageId: '881', size: CHUNK + 181, seed: 81 },
    { messageId: '882', size: 2 * CHUNK + 283, seed: 82 },
  ];
  const page = await openAFixture(context, files, { metaCsp: true });
  const manager = await openManager(context, extensionId);
  await folderPicker(page, 'batch-web-a');
  for (const file of files)
    await expect(
      page.locator(`.Message[data-message-id="${file.messageId}"]`).getByRole('button', {
        name: `Save file: Fixture-${file.messageId}.mp3`,
        exact: true,
      }),
    ).toBeEnabled();
  await page.getByRole('button', { name: 'Download several', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Download several', exact: true });
  await expect(panel.getByRole('checkbox')).toHaveCount(2);
  await panel.getByRole('button', { name: 'Select all shown', exact: true }).click();
  await panel.getByRole('button', { name: 'Choose folder and download', exact: true }).click();
  await states(manager, { '881': 'completed', '882': 'completed' });
  for (const file of files)
    expect(await hash(page, 'batch-web-a', `Fixture-${file.messageId}.mp3`)).toEqual({
      size: file.size,
      hash: expectedHash(file),
    });
  const saved = await jobs(manager);
  expect(saved.every((job) => job.media.identity.client === 'a')).toBe(true);
  expect(new Set(saved.map((job) => job.batchId)).size).toBe(1);
  expect(saved.every((job) => Boolean(job.batchId))).toBe(true);
  expect(await page.evaluate(() => window.__telegramFixture.directoryPicks)).toEqual([
    'batch-web-a',
  ]);
  expect(await page.evaluate(() => window.__telegramFixture.directoryPickerActivations)).toEqual([
    true,
  ]);
  expect(await page.evaluate(() => window.__telegramFixture.picked)).toEqual([]);
  expect(await page.evaluate(() => window.__telegramFixture.playCalls)).toBe(0);
});

test('keep both preserves an existing file and separates equal names in one batch', async ({
  context,
  extensionId,
}) => {
  const files: FixtureFile[] = [
    { messageId: '811', size: 7_019, seed: 11, filename: 'shared.bin' },
    { messageId: '812', size: 8_021, seed: 12, filename: 'shared.bin' },
  ];
  const page = await openFixture(context, files);
  const manager = await openManager(context, extensionId);
  const previous = 'Existing user file must survive';
  await folderPicker(page, 'batch-collisions', [{ filename: 'shared.bin', content: previous }]);
  const panel = await batchPanel(page, files);
  await panel
    .getByRole('combobox', { name: 'Existing files', exact: true })
    .selectOption({ label: 'Keep both' });
  await panel.getByRole('button', { name: 'Choose folder and download', exact: true }).click();
  await states(manager, { '811': 'completed', '812': 'completed' });
  expect(await hash(page, 'batch-collisions', 'shared.bin')).toEqual(contentHash(previous));
  for (const [index, file] of files.entries())
    expect(await hash(page, 'batch-collisions', `shared (${index + 1}).bin`)).toEqual({
      size: file.size,
      hash: expectedHash(file),
    });
  expect((await jobs(manager)).map((job) => job.destinationName).sort()).toEqual([
    'shared (1).bin',
    'shared (2).bin',
  ]);
});

test('skip existing records a skipped job without downloading or modifying that file', async ({
  context,
  extensionId,
}) => {
  const files: FixtureFile[] = [
    { messageId: '821', size: 8_031, seed: 21 },
    { messageId: '822', size: 9_033, seed: 22 },
  ];
  const page = await openFixture(context, files);
  const manager = await openManager(context, extensionId);
  const previous = 'Keep existing contents';
  await folderPicker(page, 'batch-skip', [{ filename: name(files[0]!), content: previous }]);
  const panel = await batchPanel(page, files);
  await panel
    .getByRole('combobox', { name: 'Existing files', exact: true })
    .selectOption({ label: 'Skip existing' });
  await panel.getByRole('button', { name: 'Choose folder and download', exact: true }).click();
  await states(manager, { '821': 'skipped', '822': 'completed' });
  expect(await hash(page, 'batch-skip', name(files[0]!))).toEqual(contentHash(previous));
  expect(await hash(page, 'batch-skip', name(files[1]!))).toEqual({
    size: files[1]!.size,
    hash: expectedHash(files[1]!),
  });
  expect(await page.evaluate(() => window.__telegramFixture.reads.map((read) => read.id))).toEqual([
    '822',
  ]);
  await expect(manager.locator('.job-status.success')).toHaveCount(1);
  await manager.locator('#manager-state').selectOption('skipped');
  await expect(manager.locator('.manager-jobs .job-card')).toHaveCount(1);
  await expect(manager.locator('.manager-jobs .job-card h3')).toHaveText('Fixture-821.bin');
});

test('message ID names and overwrite target the selected destination names', async ({
  context,
  extensionId,
}) => {
  const files: FixtureFile[] = [
    { messageId: '831', size: CHUNK + 29, seed: 31 },
    { messageId: '832', size: 7_039, seed: 32 },
  ];
  const page = await openFixture(context, files);
  const manager = await openManager(context, extensionId);
  await folderPicker(page, 'batch-overwrite', [
    { filename: '831_Fixture-831.bin', content: 'Replace this only after commit' },
  ]);
  const panel = await batchPanel(page, files);
  await panel
    .getByRole('combobox', { name: 'File names', exact: true })
    .selectOption({ label: 'Message ID + name' });
  await panel
    .getByRole('combobox', { name: 'Existing files', exact: true })
    .selectOption({ label: 'Overwrite' });
  await panel.getByRole('button', { name: 'Choose folder and download', exact: true }).click();
  await states(manager, { '831': 'completed', '832': 'completed' });
  for (const file of files)
    expect(await hash(page, 'batch-overwrite', `${file.messageId}_${name(file)}`)).toEqual({
      size: file.size,
      hash: expectedHash(file),
    });
  expect(await page.evaluate(() => window.__telegramFixture.files('batch-overwrite'))).toEqual([
    '831_Fixture-831.bin',
    '832_Fixture-832.bin',
  ]);
  await manager.locator('#manager-search').fill('831_Fixture');
  await expect(manager.locator('.manager-jobs .job-card')).toHaveCount(1);
  await expect(manager.locator('.manager-jobs .job-card h3')).toHaveText('831_Fixture-831.bin');
});

test('manager cancels the selected active and queued files without saving a partial batch', async ({
  context,
  extensionId,
}) => {
  const files: FixtureFile[] = [
    { messageId: '841', size: 2 * CHUNK + 41, seed: 41 },
    { messageId: '842', size: 8_043, seed: 42 },
  ];
  const page = await openFixture(context, files);
  const manager = await openManager(context, extensionId);
  await folderPicker(page, 'batch-cancel');
  await page.evaluate((offset) => window.__telegramFixture.hold('841', offset), CHUNK);
  const panel = await batchPanel(page, files);
  await panel.getByRole('button', { name: 'Choose folder and download', exact: true }).click();
  await states(manager, { '841': 'downloading', '842': 'queued' });
  await expect.poll(() => page.evaluate(() => window.__telegramFixture.reads.length)).toBe(2);
  for (const file of files)
    await manager.getByRole('checkbox', { name: `Select: ${name(file)}`, exact: true }).check();
  await manager.getByRole('button', { name: 'Cancel selected', exact: true }).click();
  await states(manager, { '841': 'cancelled', '842': 'cancelled' });
  await page.evaluate(() => window.__telegramFixture.release('841'));
  expect((await hash(page, 'batch-cancel', name(files[0]!))).size).toBe(0);
  expect(await page.evaluate(() => window.__telegramFixture.reads.map((read) => read.id))).toEqual([
    '841',
    '841',
  ]);
  await expect(manager.locator('.job-status.success')).toHaveCount(0);
});

test('a failed batch member aborts its partial file while the remaining file completes', async ({
  context,
  extensionId,
}) => {
  const files: FixtureFile[] = [
    { messageId: '851', size: CHUNK + 51, seed: 51 },
    { messageId: '852', size: 8_053, seed: 52 },
  ];
  const page = await openFixture(context, files);
  const manager = await openManager(context, extensionId);
  await folderPicker(page, 'batch-partial-failure');
  await page.evaluate((offset) => window.__telegramFixture.fail('851', offset), CHUNK);
  const panel = await batchPanel(page, files);
  await panel.getByRole('button', { name: 'Choose folder and download', exact: true }).click();
  await states(manager, { '851': 'failed', '852': 'completed' });
  expect((await hash(page, 'batch-partial-failure', name(files[0]!))).size).toBe(0);
  expect(await hash(page, 'batch-partial-failure', name(files[1]!))).toEqual({
    size: files[1]!.size,
    hash: expectedHash(files[1]!),
  });
  await expect(manager.locator('.job-status.success')).toHaveCount(1);
});

test('manager retries only the failed batch member and requires a new folder choice', async ({
  context,
  extensionId,
}) => {
  const files: FixtureFile[] = [
    { messageId: '861', size: CHUNK + 61, seed: 61 },
    { messageId: '862', size: 8_063, seed: 62 },
  ];
  const page = await openFixture(context, files);
  const manager = await openManager(context, extensionId);
  await folderPicker(page, 'batch-before-retry');
  await page.evaluate(() => window.__telegramFixture.fail('861', 0));
  const panel = await batchPanel(page, files);
  await panel.getByRole('button', { name: 'Choose folder and download', exact: true }).click();
  await states(manager, { '861': 'failed', '862': 'completed' });
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.__telegramFixture.allow('861'));
  await manager.getByRole('checkbox', { name: 'Select: Fixture-861.bin', exact: true }).check();
  await manager.getByRole('button', { name: 'Retry selected in Telegram', exact: true }).click();
  const retry = page.getByRole('dialog', { name: 'Download several', exact: true });
  await expect(retry.getByRole('checkbox', { name: 'Fixture-861.bin', exact: true })).toBeChecked();
  await expect(retry.getByRole('checkbox', { name: 'Fixture-862.bin', exact: true })).toHaveCount(
    0,
  );
  expect(await page.evaluate(() => window.__telegramFixture.directoryPicks)).toEqual([
    'batch-before-retry',
  ]);
  await folderPicker(page, 'batch-after-retry');
  await retry.getByRole('button', { name: 'Choose folder and download', exact: true }).click();
  await expect
    .poll(async () => (await jobs(manager)).filter((job) => job.state === 'completed').length)
    .toBe(2);
  const history = await jobs(manager);
  expect(history.filter((job) => job.media.identity.messageId === '862')).toHaveLength(1);
  expect(
    history
      .filter((job) => job.media.identity.messageId === '861')
      .map((job) => job.state)
      .sort(),
  ).toEqual(['completed', 'failed']);
  expect(await hash(page, 'batch-after-retry', 'Fixture-861.bin')).toEqual({
    size: files[0]!.size,
    hash: expectedHash(files[0]!),
  });
  expect(await page.evaluate(() => window.__telegramFixture.files('batch-after-retry'))).toEqual([
    'Fixture-861.bin',
  ]);
  expect(await page.evaluate(() => window.__telegramFixture.directoryPicks)).toEqual([
    'batch-before-retry',
    'batch-after-retry',
  ]);
});

test('reloading the source interrupts the pending batch and never commits the partial file', async ({
  context,
  extensionId,
}) => {
  const files: FixtureFile[] = [
    { messageId: '871', size: 2 * CHUNK + 71, seed: 71 },
    { messageId: '872', size: 8_073, seed: 72 },
  ];
  const page = await openFixture(context, files);
  const manager = await openManager(context, extensionId);
  await folderPicker(page, 'batch-reload');
  await page.evaluate((offset) => window.__telegramFixture.hold('871', offset), CHUNK);
  const panel = await batchPanel(page, files);
  await panel.getByRole('button', { name: 'Choose folder and download', exact: true }).click();
  await states(manager, { '871': 'downloading', '872': 'queued' });
  await expect.poll(() => page.evaluate(() => window.__telegramFixture.reads.length)).toBe(2);
  await page.reload();
  await expect
    .poll(async () =>
      (await jobs(manager))
        .map((job) => job.state)
        .every((state) => ['cancelled', 'interrupted'].includes(state)),
    )
    .toBe(true);
  expect(await jobs(manager)).toHaveLength(2);
  expect((await hash(page, 'batch-reload', 'Fixture-871.bin')).size).toBe(0);
  await expect(manager.locator('.job-status.success')).toHaveCount(0);
});
