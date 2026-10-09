import type { BrowserContext, Page } from '@playwright/test';
import { installFixture, type FixtureFile } from './web-k-fixture';

function runApiWorker(files: FixtureFile[]) {
  const messages = files.map((file) => ({
    id: Number(file.messageId),
    chatId: '-42',
    content: {
      audio: {
        id: file.messageId,
        fileName: `Fixture-${file.messageId}.mp3`,
        size: file.size,
        mimeType: 'audio/mpeg',
      },
    },
  }));
  self.addEventListener(
    'message',
    (
      event: MessageEvent<{
        payloads: Array<{
          type: string;
          messageId: string;
          name?: string;
          args?: Array<{ messageId?: number; url?: string; start?: number; end?: number }>;
        }>;
      }>,
    ) => {
      for (const request of event.data.payloads) {
        if (request.type === 'initApi') {
          self.postMessage({
            payloads: [
              { type: 'methodResponse', messageId: request.messageId, response: true },
              {
                type: 'updates',
                updates: [
                  {
                    '@type': 'updateAuthorizationState',
                    authorizationState: 'authorizationStateReady',
                  },
                  { '@type': 'updateCurrentUser', currentUser: { id: '12345' } },
                  { messages, chats: [{ id: '-42', title: 'Own test chat' }] },
                ],
              },
            ],
          });
        } else if (request.name === 'fetchMessage') {
          const message = messages.find((entry) => entry.id === request.args?.[0]?.messageId);
          self.postMessage({
            payloads: [
              { type: 'methodResponse', messageId: request.messageId, response: { message } },
            ],
          });
        } else if (request.name === 'downloadMedia') {
          const args = request.args?.[0];
          const id = args?.url?.replace(/^document/, '');
          const file = files.find((entry) => entry.messageId === id);
          if (!file) throw new Error('Unknown fixture audio');
          const start = args?.start ?? 0;
          const end = Math.min(args?.end ?? file.size - 1, file.size - 1);
          const buffer = Uint8Array.from(
            { length: end - start + 1 },
            (_, index) => ((start + index) * 17 + file.seed) % 251,
          ).buffer;
          self.postMessage({
            fixtureRead: { id, offset: start, limit: end - start + 1, finished: true },
          });
          self.postMessage(
            {
              payloads: [
                {
                  type: 'methodResponse',
                  messageId: request.messageId,
                  response: { arrayBuffer: buffer, fullSize: file.size, mimeType: 'audio/mpeg' },
                },
              ],
            },
            { transfer: [buffer] },
          );
        }
      }
    },
  );
}

export async function openAFixture(
  context: BrowserContext,
  files: FixtureFile[],
  options: { metaCsp?: boolean } = {},
): Promise<Page> {
  const script = `(${runApiWorker.toString()})(${JSON.stringify(files)});`;
  const pageScript = `(${installFixture.toString()})(${JSON.stringify(files)}, 'a');
    const worker = new Worker('/a/fixture-worker.js', { type: 'module' });
    worker.addEventListener('message', event => { if (event.data.fixtureRead) window.__telegramFixture.reads.push(event.data.fixtureRead); });
    worker.postMessage({ payloads: [{ type: 'initApi', messageId: 'fixture-init', args: [] }] });`;
  // Telegram A installs CSP using a meta element. At document_start it has not
  // been parsed yet; an eval capability probe can succeed and fail later.
  const csp = options.metaCsp
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'">`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Own Telegram A integration fixture</title>
    ${csp}
    <style>body{font:16px system-ui;margin:32px;background:#edf6fa}.Message{position:relative;width:420px;height:120px;padding:20px;background:white}</style>
    <script src="/a/fixture.js"></script></head><body><h1>Own test audio</h1><div id="MiddleColumn"><div data-list-key="-42_main_thread">
    ${files.map((file) => `<article class="Message" data-message-id="${file.messageId}"><div class="Audio">Fixture-${file.messageId}.mp3</div></article>`).join('')}
    </div></div><audio id="unrelated-player"></audio></body></html>`;
  await context.route('https://web.telegram.org/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/a/fixture-worker.js') {
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: script });
    } else if (new URL(route.request().url()).pathname === '/a/fixture.js') {
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: pageScript });
    } else if (route.request().isNavigationRequest())
      await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    else await route.abort();
  });
  const page = await context.newPage();
  await page.goto('https://web.telegram.org/a/');
  return page;
}
