import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const test = base.extend<{ extensionId: string; popup: Page }>({
  context: async ({ browserName }, use, testInfo) => {
    if (browserName !== 'chromium') throw new Error('Extension E2E requires Chromium.');
    const extensionPath = resolve('.output/chrome-mv3');
    const manifest: { content_scripts: { world?: string }[] } = JSON.parse(
      await readFile(join(extensionPath, 'manifest.json'), 'utf8'),
    );
    if (!manifest.content_scripts.some((script) => script.world === 'MAIN')) {
      throw new Error('Build the extension with npm run build before running E2E tests.');
    }
    const profile = await mkdtemp(join(tmpdir(), 'tad-e2e-'));
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: true,
        locale: 'en-US',
        viewport: { width: 1100, height: 850 },
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      await use(context);
    } finally {
      if (context) {
        await context.tracing.stop(
          testInfo.status !== testInfo.expectedStatus
            ? { path: testInfo.outputPath('trace.zip') }
            : undefined,
        );
        await context.close();
      }
      await rm(profile, { recursive: true, force: true });
    }
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(worker.url()).host);
  },
  popup: async ({ context, extensionId }, use) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await use(popup);
    await popup.close();
  },
});

export { expect } from '@playwright/test';
