import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobStore, openDatabase } from '../src/storage/database';
import type { JobRecord } from '../src/domain/jobs';
import type { Command } from '../src/bridge/protocol';

const testDatabase = vi.hoisted(() => ({ name: 'background-test' }));
vi.mock('../src/storage/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/storage/database')>();
  return { ...actual, openDatabase: () => actual.openDatabase(testDatabase.name) };
});

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response?: unknown) => void,
) => boolean | void;
const extensionId = 'test-extension';
const sourceSender = (tabId = 1, session = 'a'): chrome.runtime.MessageSender => ({
  id: extensionId,
  tab: { id: tabId } as chrome.tabs.Tab,
  frameId: 0,
  url: `https://web.telegram.org/${session}/`,
});
const uiSender = { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` };
const record = (jobId: string, tabId = 1): JobRecord => ({
  id: jobId,
  key: jobId,
  media: {
    identity: { client: 'a', accountId: '11', peerId: '22', messageId: jobId, mediaId: jobId },
    kind: 'audio',
    filename: 'audio.ogg',
    mimeType: 'audio/ogg',
    byteSize: 4,
  },
  state: 'queued',
  bytes: 0,
  total: 4,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  tabId,
  sessionId: `session-${tabId}`,
  attempt: 1,
});

let messageListener: Listener;
let store: JobStore;
let sendCommand: ReturnType<
  typeof vi.fn<(tabId: number, message: { command: Command }) => Promise<unknown>>
>;

function send(
  message: unknown,
  sender: chrome.runtime.MessageSender = sourceSender(),
): Promise<unknown> {
  return new Promise((resolve) => {
    const result = messageListener(message, sender, resolve);
    if (result !== true) resolve(undefined);
  });
}

async function start(): Promise<void> {
  const entrypoint = await import('../entrypoints/background');
  (entrypoint.default as unknown as () => void)();
}

beforeEach(() => {
  testDatabase.name = `background-${crypto.randomUUID()}`;
  store = new JobStore(openDatabase());
  sendCommand = vi.fn(async () => ({ ok: true, jobs: [] }));
  vi.stubGlobal('defineBackground', (callback: unknown) => callback);
  vi.stubGlobal('chrome', {
    runtime: {
      id: extensionId,
      getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
      onMessage: {
        addListener: (listener: Listener) => {
          messageListener = listener;
        },
      },
      onStartup: { addListener: vi.fn() },
    },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
    tabs: {
      sendMessage: sendCommand,
      get: vi.fn(async (id: number) => ({ id, url: 'https://web.telegram.org/a/' })),
      update: vi.fn(async () => undefined),
      create: vi.fn(async () => undefined),
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('background coordinator', () => {
  it('reconciles a completed writer when the service worker wakes without browser onStartup', async () => {
    await store.connect({ tabId: 1, sessionId: 'session-1', client: 'a', ready: true });
    await store.enqueue(record('one'));
    await store.claimNext();
    sendCommand.mockResolvedValue({
      ok: true,
      jobs: [{ id: 'one', state: 'completed', bytes: 4, total: 4 }],
    });
    await start();
    await vi.waitFor(async () => expect((await store.get('one'))?.state).toBe('completed'), {
      timeout: 500,
    });
  });

  it('acknowledges live writer progress while another tab probe is unresponsive', async () => {
    await start();
    await send({
      scope: 'tad-page',
      sessionId: 'session-1',
      payload: { type: 'hello', client: 'a', ready: true },
    });
    await send(
      {
        scope: 'tad-page',
        sessionId: 'session-2',
        payload: { type: 'hello', client: 'a', ready: true },
      },
      sourceSender(2),
    );
    await store.enqueue(record('one'));
    await store.claimNext();
    let release: ((value: unknown) => void) | undefined;
    sendCommand.mockImplementation((tabId) =>
      tabId === 2
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve({ ok: true, jobs: [{ id: 'one', state: 'downloading', bytes: 0 }] }),
    );
    const list = send({ scope: 'tad-ui', type: 'list' }, uiSender);
    await vi.waitFor(() => expect(release).toBeDefined());
    const progress = send({
      scope: 'tad-page',
      sessionId: 'session-1',
      payload: {
        type: 'progress',
        jobId: 'one',
        bytes: 4,
        total: 4,
        state: 'finalizing',
      },
    });
    let result: unknown;
    void progress.then((value) => {
      result = value;
    });
    try {
      await vi.waitFor(() => expect(result).toEqual({ ok: true }), { timeout: 300 });
      expect((await store.get('one'))?.state).toBe('finalizing');
    } finally {
      release?.({ ok: true, jobs: [] });
      await list;
      await progress;
    }
  });

  it('rejects a page message from another extension even on the same Telegram URL', async () => {
    await start();
    const reply = await send(
      {
        scope: 'tad-page',
        sessionId: 'session-1',
        payload: { type: 'hello', client: 'a', ready: true },
      },
      {
        ...sourceSender(),
        id: 'another-extension',
      },
    );
    expect(reply).toBeUndefined();
    expect(await store.connections()).toEqual([]);
  });

  it('rejects subframes, incorrect client routes, and stale session progress', async () => {
    await start();
    const hello = {
      scope: 'tad-page',
      sessionId: 'session-1',
      payload: { type: 'hello', client: 'a', ready: true },
    };
    expect(await send(hello, { ...sourceSender(), frameId: 1 })).toBeUndefined();
    expect(await send(hello, sourceSender(1, 'k'))).toBeUndefined();
    expect(await send(hello)).toMatchObject({ ok: true });
    await store.enqueue(record('one'));
    await store.claimNext();
    expect(
      await send({
        scope: 'tad-page',
        sessionId: 'old-session',
        payload: {
          type: 'progress',
          jobId: 'one',
          bytes: 4,
          total: 4,
          state: 'finalizing',
        },
      }),
    ).toMatchObject({ ok: false });
    expect((await store.get('one'))?.bytes).toBe(0);
  });

  it('keeps the writer reservation when a live Telegram tab does not answer before timeout', async () => {
    await start();
    await send({
      scope: 'tad-page',
      sessionId: 'session-1',
      payload: { type: 'hello', client: 'a', ready: true },
    });
    await store.enqueue(record('one'));
    await store.claimNext();
    await store.enqueue(record('two'));
    sendCommand.mockImplementation(() => new Promise(() => undefined));
    const reply = await send({ scope: 'tad-ui', type: 'list' }, uiSender);
    expect(reply).toMatchObject({ ok: true });
    expect((await store.get('one'))?.state).toBe('downloading');
    expect((await store.get('two'))?.state).toBe('queued');
    expect(sendCommand.mock.calls.some(([, message]) => message.command.type === 'start')).toBe(
      false,
    );
  });

  it('recovers a terminal page snapshot if the start acknowledgement was lost', async () => {
    await start();
    await send({
      scope: 'tad-page',
      sessionId: 'session-1',
      payload: { type: 'hello', client: 'a', ready: true },
    });
    await store.enqueue(record('one'));
    let firstProbe = true;
    sendCommand.mockImplementation(async (_tabId, message) => {
      if (message.command.type === 'start') return { ok: false };
      const state = firstProbe ? 'queued' : 'completed';
      firstProbe = false;
      return {
        ok: true,
        jobs: [{ id: 'one', state, bytes: state === 'completed' ? 4 : 0, total: 4 }],
      };
    });
    await send({ scope: 'tad-ui', type: 'list' }, uiSender);
    expect((await store.get('one'))?.state).toBe('completed');
  });

  it('rejects malformed completion snapshots and refuses cancellation during file commit', async () => {
    await start();
    await send({
      scope: 'tad-page',
      sessionId: 'session-1',
      payload: { type: 'hello', client: 'a', ready: true },
    });
    await store.enqueue(record('one'));
    await store.claimNext();
    sendCommand.mockResolvedValue({
      ok: true,
      jobs: [{ id: 'one', state: 'completed', bytes: 3, total: 4 }],
    });
    await send({ scope: 'tad-ui', type: 'list' }, uiSender);
    expect((await store.get('one'))?.state).toBe('downloading');
    await store.update('one', 'session-1', { state: 'finalizing', bytes: 4 });
    sendCommand.mockClear();
    expect(await send({ scope: 'tad-ui', type: 'cancel', id: 'one' }, uiSender)).toEqual({
      ok: false,
      error: 'finalizing',
    });
    expect(sendCommand).not.toHaveBeenCalled();
  });
});
