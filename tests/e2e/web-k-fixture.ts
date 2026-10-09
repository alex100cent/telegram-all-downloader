import type { BrowserContext, Page } from '@playwright/test';
import { createHash } from 'node:crypto';

export interface FixtureFile {
  messageId: string;
  size: number;
  seed: number;
}
export interface FixtureRead {
  id: string;
  offset: number;
  limit: number;
  finished: boolean;
}
interface FixtureState {
  reads: FixtureRead[];
  picked: string[];
  playCalls: number;
  hold(id: string, offset: number): void;
  release(id: string): void;
  hash(filename: string): Promise<{ size: number; hash: string }>;
}

declare global {
  interface Window {
    __telegramFixture: FixtureState;
  }
}

export function installFixture(files: FixtureFile[], client: 'a' | 'k' = 'k') {
  const held = new Map<string, number>();
  const waiting = new Map<string, Array<() => void>>();
  const state: FixtureState = {
    reads: [],
    picked: [],
    playCalls: 0,
    hold(id, offset) {
      held.set(id, offset);
    },
    release(id) {
      held.delete(id);
      for (const resume of waiting.get(id) ?? []) resume();
      waiting.delete(id);
    },
    async hash(filename) {
      const directory = await navigator.storage.getDirectory();
      const handle = await directory.getFileHandle(filename);
      const file = await handle.getFile();
      const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      return {
        size: file.size,
        hash: [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
      };
    },
  };
  window.__telegramFixture = state;
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value: async ({ suggestedName }: { suggestedName: string }) => {
      state.picked.push(suggestedName);
      const directory = await navigator.storage.getDirectory();
      return directory.getFileHandle(suggestedName, { create: true });
    },
  });
  HTMLMediaElement.prototype.play = async () => {
    state.playCalls++;
  };
  if (client === 'a') return;
  const messages = new Map(
    files.map((file) => [
      file.messageId,
      {
        _: 'message',
        id: Number(file.messageId),
        mid: Number(file.messageId),
        peerId: -77,
        pFlags: { noforwards: true },
        media: {
          document: {
            _: 'document',
            id: file.messageId,
            access_hash: 'synthetic-media-access',
            file_reference: new Uint8Array([1, 2]),
            dc_id: 2,
            size: file.size,
            mime_type: 'application/octet-stream',
            file_name: `Fixture-${file.messageId}.bin`,
            attributes: [
              { _: 'documentAttributeFilename', file_name: `Fixture-${file.messageId}.bin` },
            ],
          },
        },
      },
    ]),
  );
  const managers = {
    appUsersManager: {
      async getSelf() {
        return { id: 12345 };
      },
    },
    appMessagesManager: {
      async getMessageByPeer(_peer: number, mid: number) {
        return messages.get(String(mid));
      },
    },
    apiFileManager: {
      async requestFilePart({
        location,
        offset,
        limit,
      }: {
        location: { id: string };
        offset: number;
        limit: number;
      }) {
        const file = files.find((entry) => entry.messageId === String(location.id));
        if (!file) throw new Error('Unknown fixture file');
        const read: FixtureRead = { id: file.messageId, offset, limit, finished: false };
        state.reads.push(read);
        const after = held.get(file.messageId);
        if (after !== undefined && offset >= after) {
          await new Promise<void>((resume) => {
            const list = waiting.get(file.messageId) ?? [];
            list.push(resume);
            waiting.set(file.messageId, list);
          });
        }
        const size = Math.min(limit, Math.max(0, file.size - offset));
        const bytes = Uint8Array.from(
          { length: size },
          (_, index) => ((offset + index) * 17 + file.seed) % 251,
        );
        read.finished = true;
        return { _: 'upload.file', bytes };
      },
    },
  };
  Object.assign(window, {
    rootScope: { myId: 12345, managers },
    createProxiedManagersForAccount: () => managers,
    apiManagerProxy: {
      getMessageByPeer: (_peer: number, mid: number) => messages.get(String(mid)),
    },
  });
}

export async function openFixture(context: BrowserContext, files: FixtureFile[]): Promise<Page> {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Own Telegram K integration fixture</title>
    <style>body{font:16px system-ui;margin:32px;background:#edf6fa}.bubble{position:relative;width:420px;height:120px;margin:16px;padding:20px;border:1px solid #46859d;border-radius:16px;background:white}</style>
    <script>(${installFixture.toString()})(${JSON.stringify(files)});</script></head><body><h1>Own test messages</h1><main class="bubbles">
    ${files.map((file) => `<article class="bubble" data-peer-id="-77" data-mid="${file.messageId}"><p>Fixture-${file.messageId}.bin</p></article>`).join('')}
    </main><audio id="unrelated-player"></audio></body></html>`;
  await context.route('https://web.telegram.org/**', async (route) => {
    if (route.request().isNavigationRequest())
      await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    else await route.abort();
  });
  const page = await context.newPage();
  await page.goto('https://web.telegram.org/k/');
  return page;
}

export function expectedHash(file: FixtureFile): string {
  const bytes = Uint8Array.from(
    { length: file.size },
    (_, index) => (index * 17 + file.seed) % 251,
  );
  return createHash('sha256').update(bytes).digest('hex');
}

export async function clickDownload(page: Page, messageId: string): Promise<void> {
  await page
    .locator(`.bubble[data-mid="${messageId}"]`)
    .getByRole('button', { name: `Save file: Fixture-${messageId}.bin`, exact: true })
    .click();
}
