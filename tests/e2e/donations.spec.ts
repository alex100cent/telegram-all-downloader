import type { Page } from '@playwright/test';
import type { DonationState } from '../../src/domain/donations';
import type { JobRecord, Settings } from '../../src/domain/jobs';
import { test, expect } from './fixtures';
import { clickDownload, expectedHash, openFixture, type FixtureFile } from './web-k-fixture';

const DONATION_URL = 'https://app.lava.top/294798508';

async function snapshot(page: Page): Promise<{
  jobs: JobRecord[];
  settings: Settings;
  donation: DonationState;
}> {
  return page.evaluate(() => chrome.runtime.sendMessage({ scope: 'tad-ui', type: 'list' }));
}

async function seedDonation(page: Page, state: DonationState): Promise<void> {
  await page.evaluate(
    (state) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('telegram-all-downloader');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('donation', 'readwrite');
          transaction.objectStore('donation').put(state, 'state');
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => {
            db.close();
            reject(transaction.error);
          };
        };
      }),
    state,
  );
}

test('the twentieth committed file offers optional coffee without blocking the batch or opening a tab', async ({
  context,
  extensionId,
  popup,
}, testInfo) => {
  test.setTimeout(90_000);
  const files: FixtureFile[] = Array.from({ length: 20 }, (_, index) => ({
    messageId: String(901 + index),
    size: 2_017 + index,
    seed: index + 51,
  }));
  const page = await openFixture(context, files);
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  await expect(manager.locator('.manager-panel')).toBeVisible();
  await expect(popup.getByText('Connected', { exact: true })).toBeVisible();
  const initialPages = context.pages().length;
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle('coffee-batch', { create: true });
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: () => {
        window.__telegramFixture.directoryPicks.push('coffee-batch');
        return Promise.resolve(directory);
      },
    });
    window.__telegramFixture.hold('920', 0);
  });
  await page.getByRole('button', { name: 'Download several', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Download several', exact: true });
  await expect(panel.getByRole('checkbox')).toHaveCount(20);
  await panel.getByRole('button', { name: 'Select all shown', exact: true }).click();
  await panel.getByRole('button', { name: 'Choose folder and download', exact: true }).click();
  await expect.poll(async () => (await snapshot(popup)).donation.completedDownloads).toBe(19);
  await expect(popup.locator('.donation-reminder')).toHaveCount(0);
  await expect(manager.locator('.donation-reminder')).toHaveCount(0);
  await expect(page.locator('[data-tad-donation]')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.__telegramFixture.release('920'));
  await expect
    .poll(async () => (await snapshot(popup)).donation)
    .toEqual({
      completedDownloads: 20,
      dismissedMilestone: 0,
    });
  await expect
    .poll(
      async () => (await snapshot(popup)).jobs.filter((job) => job.state === 'completed').length,
    )
    .toBe(20);
  const hashes = await page.evaluate(async (files) => {
    return Promise.all(
      files.map((file) =>
        window.__telegramFixture.hash(`Fixture-${file.messageId}.bin`, 'coffee-batch'),
      ),
    );
  }, files);
  expect(hashes).toEqual(files.map((file) => ({ size: file.size, hash: expectedHash(file) })));
  expect(await page.evaluate(() => window.__telegramFixture.directoryPicks)).toEqual([
    'coffee-batch',
  ]);
  await expect(popup.locator('.donation-reminder')).toContainText('optional');
  await expect(manager.locator('.donation-reminder')).toBeVisible();
  const toast = page.locator('[data-tad-donation]');
  await expect(toast).toContainText('optional');
  await expect(toast.getByRole('link', { name: 'Buy a coffee', exact: true })).toHaveAttribute(
    'href',
    DONATION_URL,
  );
  expect(context.pages()).toHaveLength(initialPages);
  await popup.setViewportSize({ width: 420, height: 900 });
  await popup.screenshot({
    path: testInfo.outputPath('coffee-popup-en-light.png'),
    fullPage: true,
  });
  await manager.screenshot({
    path: testInfo.outputPath('coffee-manager-en-light.png'),
    fullPage: true,
  });
  await page.screenshot({ path: testInfo.outputPath('coffee-toast-en-light.png') });
  await toast.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(popup.locator('.donation-reminder')).toHaveCount(0);
  await expect(manager.locator('.donation-reminder')).toHaveCount(0);
  await expect(toast).toHaveCount(0);
  await expect.poll(async () => (await snapshot(popup)).donation.dismissedMilestone).toBe(20);
  await popup.reload();
  await expect(popup.locator('.donation-reminder')).toHaveCount(0);
  await page
    .locator('.bubble[data-mid="901"]')
    .getByRole('button', { name: 'Saved · Save again: Fixture-901.bin', exact: true })
    .click();
  await page
    .locator('[data-tad-notice]')
    .getByRole('button', { name: 'Save again', exact: true })
    .click();
  await expect.poll(async () => (await snapshot(popup)).donation.completedDownloads).toBe(21);
  expect(await page.evaluate(() => window.__telegramFixture.hash('Fixture-901.bin'))).toEqual({
    size: files[0]!.size,
    hash: expectedHash(files[0]!),
  });
  await expect(popup.locator('.donation-reminder')).toHaveCount(0);
  await expect(toast).toHaveCount(0);
  expect(context.pages()).toHaveLength(initialPages);
});

test('English is the default, Russian and dark mode reach Telegram, and coffee opt-out survives reloads', async ({
  context,
  extensionId,
  popup,
}, testInfo) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'ru-RU' });
    Object.defineProperty(navigator, 'languages', { configurable: true, value: ['ru-RU', 'ru'] });
  });
  await popup.reload();
  await expect(popup.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  expect(await popup.evaluate(() => navigator.language)).toBe('ru-RU');
  expect((await snapshot(popup)).settings.language).toBe('en');
  const file: FixtureFile = { messageId: '941', size: 4_013, seed: 91 };
  const page = await openFixture(context, [file]);
  await expect(popup.getByText('Connected', { exact: true })).toBeVisible();
  await seedDonation(popup, { completedDownloads: 39, dismissedMilestone: 20 });
  await clickDownload(page, file.messageId);
  await expect.poll(async () => (await snapshot(popup)).donation.completedDownloads).toBe(40);
  expect(await page.evaluate(() => window.__telegramFixture.hash('Fixture-941.bin'))).toEqual({
    size: file.size,
    hash: expectedHash(file),
  });
  await expect(popup.locator('.donation-reminder')).toBeVisible();
  await expect(page.locator('[data-tad-donation]')).toBeVisible();
  await popup.getByRole('button', { name: 'Settings', exact: true }).click();
  await popup.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ru');
  await popup.locator('#theme').selectOption('dark');
  await expect(popup.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Скачать несколько', exact: true })).toBeVisible();
  const toast = page.locator('[data-tad-donation]');
  await expect(toast.getByRole('link', { name: 'Угостить кофе', exact: true })).toHaveAttribute(
    'href',
    DONATION_URL,
  );
  await popup.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  await expect(manager.locator('.donation-reminder')).toBeVisible();
  await popup.setViewportSize({ width: 420, height: 900 });
  await popup.screenshot({ path: testInfo.outputPath('coffee-popup-ru-dark.png'), fullPage: true });
  await manager.screenshot({
    path: testInfo.outputPath('coffee-manager-ru-dark.png'),
    fullPage: true,
  });
  await page.screenshot({ path: testInfo.outputPath('coffee-toast-ru-dark.png') });
  await toast.getByRole('button', { name: 'Больше не показывать', exact: true }).click();
  await expect(popup.locator('.donation-reminder')).toHaveCount(0);
  await expect(manager.locator('.donation-reminder')).toHaveCount(0);
  await expect(toast).toHaveCount(0);
  await popup.reload();
  await page.reload();
  await popup.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(
    popup.getByRole('checkbox', { name: 'Напоминать о поддержке', exact: true }),
  ).not.toBeChecked();
  await expect(popup.getByRole('combobox', { name: 'Язык', exact: true })).toHaveValue('ru');
  await expect(page.getByRole('button', { name: 'Скачать несколько', exact: true })).toBeVisible();
  await expect(page.locator('[data-tad-donation]')).toHaveCount(0);
  expect((await snapshot(popup)).settings.donationReminders).toBe(false);
  await expect(popup.locator('.donation-card')).toHaveAttribute('href', DONATION_URL);
  await context.route(`${DONATION_URL}**`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Donation link fixture</title>' }),
  );
  const opened = context.waitForEvent('page');
  await popup.locator('.donation-card').click();
  const donationPage = await opened;
  await expect(donationPage).toHaveURL(DONATION_URL);
  await expect(donationPage).toHaveTitle('Donation link fixture');
});
