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
const managerSender = {
  id: extensionId,
  url: `chrome-extension://${extensionId}/manager.html`,
  tab: { id: 99 } as chrome.tabs.Tab,
};
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
let tabUpdatedListener: (
  tabId: number,
  changeInfo: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab,
) => void;
let store: JobStore;
let sendCommand: ReturnType<
  typeof vi.fn<
    (tabId: number, message: { command: Command; sessionId?: string }) => Promise<unknown>
  >
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
      onUpdated: {
        addListener: (listener: typeof tabUpdatedListener) => {
          tabUpdatedListener = listener;
        },
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('background coordinator', () => {
  it('accepts the manager tab and popup, rejecting other UI senders', async () => {
    await start();
    for (const sender of [uiSender, managerSender]) {
      expect(await send({ scope: 'tad-ui', type: 'list' }, sender)).toMatchObject({
        ok: true,
        jobs: [],
      });
    }
    for (const sender of [
      { ...managerSender, id: 'another-extension' },
      { ...managerSender, url: `chrome-extension://${extensionId}/other.html` },
      { ...managerSender, url: `${managerSender.url}?pretend=manager` },
      { ...managerSender, url: 'https://example.com/manager.html' },
      sourceSender(),
    ]) {
      expect(await send({ scope: 'tad-ui', type: 'list' }, sender)).toBeUndefined();
    }
  });

  it('opens the batch panel only in the selected connected tab and activates it on success', async () => {
    await start();
    await send({ scope: 'tad-ui', type: 'list' }, managerSender);
    await store.connect({ tabId: 1, sessionId: 'session-1', client: 'a', ready: true });
    await store.connect({ tabId: 2, sessionId: 'session-2', client: 'k', ready: true });
    sendCommand.mockClear();
    expect(
      await send({ scope: 'tad-ui', type: 'open_batch', tabId: 2 }, managerSender),
    ).toMatchObject({ ok: true });
    expect(sendCommand.mock.calls).toEqual([
      [2, { scope: 'tad-control', sessionId: 'session-2', command: { type: 'open_batch' } }],
    ]);
    expect(chrome.tabs.update).toHaveBeenCalledWith(2, { active: true });

    sendCommand.mockClear();
    vi.mocked(chrome.tabs.update).mockClear();
    expect(
      await send({ scope: 'tad-ui', type: 'open_batch', tabId: 3 }, managerSender),
    ).toMatchObject({ ok: false });
    expect(sendCommand).not.toHaveBeenCalled();
    sendCommand.mockResolvedValue({ ok: false });
    expect(await send({ scope: 'tad-ui', type: 'open_batch', tabId: 1 }, managerSender)).toEqual({
      ok: false,
    });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it('rejects malformed or oversized batch requests before sending page commands', async () => {
    await start();
    await send({ scope: 'tad-ui', type: 'list' }, managerSender);
    sendCommand.mockClear();
    for (const patch of [
      { ids: [] },
      { ids: Array.from({ length: 201 }, (_, index) => String(index)) },
      { ids: [''] },
      { ids: ['x'.repeat(129)] },
      { ids: [42] },
      { ids: 'one' },
      { ids: ['one'], action: 'delete' },
    ]) {
      expect(
        await send(
          { scope: 'tad-ui', type: 'batch_action', action: 'cancel', ...patch },
          managerSender,
        ),
      ).toMatchObject({ ok: false });
    }
    expect(sendCommand).not.toHaveBeenCalled();
    expect(
      await send(
        {
          scope: 'tad-ui',
          type: 'batch_action',
          action: 'cancel',
          ids: Array.from({ length: 200 }, (_, index) => String(index)),
        },
        managerSender,
      ),
    ).toEqual({ ok: true, accepted: 0, rejected: 200 });
  });

  it('deduplicates cancellation IDs, skips committing and terminal jobs, and reports rejections', async () => {
    await start();
    await send({ scope: 'tad-ui', type: 'list' }, managerSender);
    for (const [id, state] of [
      ['queued', 'queued'],
      ['committing', 'finalizing'],
      ['done', 'completed'],
      ['skipped', 'skipped'],
      ['failed', 'failed'],
    ] as const) {
      await store.enqueue({ ...record(id), state });
    }
    sendCommand.mockClear();
    const reply = await send(
      {
        scope: 'tad-ui',
        type: 'batch_action',
        action: 'cancel',
        ids: ['queued', 'queued', 'committing', 'done', 'skipped', 'failed', 'missing'],
      },
      managerSender,
    );
    expect(reply).toEqual({ ok: true, accepted: 1, rejected: 5 });
    expect(sendCommand.mock.calls).toEqual([
      [
        1,
        {
          scope: 'tad-control',
          sessionId: 'session-1',
          command: { type: 'cancel', jobId: 'queued' },
        },
      ],
    ]);
    expect((await store.get('committing'))?.state).toBe('finalizing');
    expect((await store.get('done'))?.state).toBe('completed');
    expect((await store.get('skipped'))?.state).toBe('skipped');
  });

  it('counts rejected active cancellations without releasing an unknown writer', async () => {
    await start();
    await send({ scope: 'tad-ui', type: 'list' }, managerSender);
    await store.enqueue({ ...record('active'), state: 'downloading' });
    await store.enqueue(record('queued'));
    sendCommand.mockImplementation(async (_tabId, message) => ({
      ok: message.command.type === 'cancel' && message.command.jobId === 'queued',
    }));
    expect(
      await send(
        { scope: 'tad-ui', type: 'batch_action', action: 'cancel', ids: ['active', 'queued'] },
        managerSender,
      ),
    ).toEqual({ ok: true, accepted: 1, rejected: 1 });
    expect((await store.get('active'))?.state).toBe('downloading');
    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand.mock.calls.map(([, message]) => message.command)).toEqual(
      expect.arrayContaining([
        { type: 'cancel', jobId: 'active' },
        { type: 'cancel', jobId: 'queued' },
      ]),
    );
  });

  it('bounds a full batch cancellation to one failed RPC per unavailable connection', async () => {
    await start();
    await send({ scope: 'tad-ui', type: 'list' }, managerSender);
    await store.connect({ tabId: 1, sessionId: 'session-1', client: 'a', ready: true });
    await store.connect({ tabId: 2, sessionId: 'session-2', client: 'a', ready: true });
    const unavailableIds = Array.from({ length: 199 }, (_, index) => `unavailable-${index}`);
    for (const [index, id] of unavailableIds.entries()) {
      await store.enqueue({ ...record(id), state: index === 0 ? 'downloading' : 'queued' });
    }
    await store.enqueue(record('healthy', 2));
    sendCommand.mockImplementation(async (tabId) => {
      if (tabId === 1) throw new Error('The receiving end does not exist');
      return { ok: true };
    });
    expect(
      await send(
        {
          scope: 'tad-ui',
          type: 'batch_action',
          action: 'cancel',
          ids: [...unavailableIds, 'healthy'],
        },
        managerSender,
      ),
    ).toEqual({ ok: true, accepted: 1, rejected: 199 });
    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand.mock.calls.filter(([tabId]) => tabId === 1)).toHaveLength(1);
    expect(sendCommand).toHaveBeenCalledWith(2, {
      scope: 'tad-control',
      sessionId: 'session-2',
      command: { type: 'cancel', jobId: 'healthy' },
    });
    expect((await store.get(unavailableIds[0]!))?.state).toBe('downloading');
    expect((await store.get(unavailableIds[1]!))?.state).toBe('queued');
    expect(await store.connections()).toHaveLength(2);
    expect(
      sendCommand.mock.calls.filter(([, message]) => message.command.type === 'start'),
    ).toEqual([]);
  });

  it('does not start another selected job when a finish message races with batch cancellation', async () => {
    await start();
    await send({ scope: 'tad-ui', type: 'list' }, managerSender);
    await store.connect({ tabId: 1, sessionId: 'session-1', client: 'a', ready: true });
    await store.enqueue({ ...record('active'), state: 'downloading' });
    await store.enqueue(record('queued'));
    const finish = (jobId: string) =>
      send({
        scope: 'tad-page',
        sessionId: 'session-1',
        payload: { type: 'finish', jobId, state: 'cancelled', error: 'cancelled', bytes: 0 },
      });
    sendCommand.mockImplementation(async (_tabId, message) => {
      if (message.command.type === 'cancel') {
        // The active writer may finish even while the queued cancellation is awaiting its reply.
        await finish('active');
        if (message.command.jobId === 'queued') await finish('queued');
      }
      return { ok: true };
    });
    expect(
      await send(
        {
          scope: 'tad-ui',
          type: 'batch_action',
          action: 'cancel',
          ids: ['active', 'queued'],
        },
        managerSender,
      ),
    ).toMatchObject({ ok: true });
    expect(
      sendCommand.mock.calls.filter(([, message]) => message.command.type === 'start'),
    ).toEqual([]);
    expect((await store.get('active'))?.state).toBe('cancelled');
    expect((await store.get('queued'))?.state).toBe('cancelled');
  });

  it('groups retryable records by tab and session and sums only accepted retries', async () => {
    await start();
    await send({ scope: 'tad-ui', type: 'list' }, managerSender);
    for (const [id, tabId, sessionId, state] of [
      ['one', 1, 'session-1', 'failed'],
      ['two', 1, 'session-1', 'cancelled'],
      ['old', 1, 'old-session', 'interrupted'],
      ['three', 2, 'session-2', 'failed'],
      ['done', 1, 'session-1', 'completed'],
      ['skipped', 1, 'session-1', 'skipped'],
      ['active', 1, 'session-1', 'downloading'],
    ] as const) {
      await store.enqueue({ ...record(id, tabId), sessionId, state });
    }
    sendCommand.mockImplementation(async (_tabId, message) =>
      message.sessionId === 'old-session' ? { ok: false } : { ok: true, accepted: 1 },
    );
    expect(
      await send(
        {
          scope: 'tad-ui',
          type: 'batch_action',
          action: 'retry',
          ids: ['one', 'two', 'old', 'three', 'done', 'skipped', 'active', 'missing', 'one'],
        },
        managerSender,
      ),
    ).toEqual({ ok: true, accepted: 2, rejected: 6 });
    expect(sendCommand.mock.calls).toEqual([
      [
        1,
        {
          scope: 'tad-control',
          sessionId: 'session-1',
          command: { type: 'retry_batch', jobIds: ['one', 'two'] },
        },
      ],
      [
        1,
        {
          scope: 'tad-control',
          sessionId: 'old-session',
          command: { type: 'retry_batch', jobIds: ['old'] },
        },
      ],
      [
        2,
        {
          scope: 'tad-control',
          sessionId: 'session-2',
          command: { type: 'retry_batch', jobIds: ['three'] },
        },
      ],
    ]);
    expect(vi.mocked(chrome.tabs.update).mock.calls).toEqual([
      [1, { active: true }],
      [2, { active: true }],
    ]);
  });

  it('does not accept more retry acknowledgements than the requested group contains', async () => {
    await start();
    await send({ scope: 'tad-ui', type: 'list' }, managerSender);
    await store.enqueue({ ...record('one'), state: 'failed' });
    sendCommand.mockResolvedValue({ ok: true, accepted: 200 });
    const reply = (await send(
      { scope: 'tad-ui', type: 'batch_action', action: 'retry', ids: ['one'] },
      managerSender,
    )) as { ok: boolean; accepted: number; rejected: number };
    expect(reply.ok).toBe(true);
    expect(reply.accepted).toBeLessThanOrEqual(1);
    expect(reply.rejected).toBeGreaterThanOrEqual(0);
    expect(reply.accepted + reply.rejected).toBe(1);
  });

  it.each([true, false])(
    'routes individual retry with batch metadata %s to its proper live-page command',
    async (batch) => {
      await start();
      await send({ scope: 'tad-ui', type: 'list' }, managerSender);
      await store.connect({ tabId: 1, sessionId: 'session-1', client: 'a', ready: true });
      await store.enqueue({
        ...record('one'),
        state: 'failed',
        ...(batch ? { batchId: 'batch-1', batchLabel: 'Batch 1' } : {}),
      });
      sendCommand.mockResolvedValue({ ok: true, accepted: 1 });
      expect(await send({ scope: 'tad-ui', type: 'retry', id: 'one' }, managerSender)).toEqual({
        ok: true,
      });
      expect(sendCommand.mock.calls).toEqual([
        [
          1,
          {
            scope: 'tad-control',
            sessionId: 'session-1',
            command: batch
              ? { type: 'retry_batch', jobIds: ['one'] }
              : { type: 'retry', jobId: 'one' },
          },
        ],
      ]);
      expect(chrome.tabs.update).toHaveBeenCalledWith(1, { active: true });
      expect(chrome.tabs.create).not.toHaveBeenCalled();
    },
  );

  it('opens the source of an individual batch retry when the original page session is gone after reload', async () => {
    await start();
    await send({ scope: 'tad-ui', type: 'list' }, managerSender);
    const job = record('one');
    const sourceUrl = 'https://web.telegram.org/a/#-42';
    await store.connect({ tabId: 1, sessionId: 'session-1', client: 'a', ready: true });
    await store.enqueue({
      ...job,
      state: 'failed',
      batchId: 'batch-1',
      batchLabel: 'Batch 1',
      media: { ...job.media, sourceUrl },
    });
    await store.connect({ tabId: 1, sessionId: 'replacement-session', client: 'a', ready: true });
    sendCommand.mockResolvedValue({ ok: false });
    expect(await send({ scope: 'tad-ui', type: 'retry', id: job.id }, managerSender)).toEqual({
      ok: true,
    });
    expect(sendCommand.mock.calls).toEqual([
      [
        1,
        {
          scope: 'tad-control',
          sessionId: 'session-1',
          command: { type: 'retry_batch', jobIds: ['one'] },
        },
      ],
    ]);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: sourceUrl });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect((await store.get(job.id))?.state).toBe('failed');
  });

  it('persists batch metadata and the actual collision-resolved destination through completion', async () => {
    await start();
    await send({
      scope: 'tad-page',
      sessionId: 'session-1',
      payload: { type: 'hello', client: 'a', ready: true },
    });
    const job = record('one');
    expect(
      await send({
        scope: 'tad-page',
        sessionId: 'session-1',
        payload: {
          type: 'enqueue',
          jobId: job.id,
          media: job.media,
          batchId: 'batch-1',
          batchLabel: 'Batch 1',
        },
      }),
    ).toMatchObject({ ok: true });
    expect(
      await send({
        scope: 'tad-page',
        sessionId: 'session-1',
        payload: {
          type: 'progress',
          jobId: job.id,
          state: 'downloading',
          bytes: 0,
          destinationName: 'audio (1).ogg',
        },
      }),
    ).toEqual({ ok: true });
    expect(
      await send({
        scope: 'tad-page',
        sessionId: 'session-1',
        payload: { type: 'progress', jobId: job.id, state: 'finalizing', bytes: 4 },
      }),
    ).toEqual({ ok: true });
    expect(
      await send({
        scope: 'tad-page',
        sessionId: 'session-1',
        payload: { type: 'finish', jobId: job.id, state: 'completed', bytes: 4 },
      }),
    ).toEqual({ ok: true });
    expect(await store.get(job.id)).toMatchObject({
      state: 'completed',
      bytes: 4,
      batchId: 'batch-1',
      batchLabel: 'Batch 1',
      destinationName: 'audio (1).ogg',
      media: { filename: 'audio.ogg' },
    });
  });

  it.each(['completed', 'skipped'] as const)(
    'recovers a batch %s snapshot without losing metadata or inventing success',
    async (state) => {
      await store.connect({ tabId: 1, sessionId: 'session-1', client: 'a', ready: true });
      await store.enqueue({ ...record('one'), batchId: 'batch-1', batchLabel: 'Batch 1' });
      await store.claimNext();
      sendCommand.mockResolvedValue({
        ok: true,
        jobs: [
          {
            id: 'one',
            state,
            bytes: state === 'completed' ? 4 : 0,
            total: 4,
            ...(state === 'completed' ? { destinationName: 'audio (1).ogg' } : {}),
          },
        ],
      });
      await start();
      await vi.waitFor(async () => expect((await store.get('one'))?.state).toBe(state));
      expect(await store.get('one')).toMatchObject({
        batchId: 'batch-1',
        batchLabel: 'Batch 1',
        state,
        bytes: state === 'completed' ? 4 : 0,
        ...(state === 'completed' ? { destinationName: 'audio (1).ogg' } : { error: undefined }),
      });
      expect(
        await send({
          scope: 'tad-page',
          sessionId: 'session-1',
          payload: { type: 'finish', jobId: 'one', state: 'completed', bytes: 4 },
        }),
      ).toEqual({ ok: false });
      expect((await store.get('one'))?.state).toBe(state);
    },
  );

  it('preserves the live session and writer when same-document navigation reports loading', async () => {
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
      jobs: [{ id: 'one', state: 'downloading', bytes: 0, total: 4 }],
    });

    const url = 'https://web.telegram.org/a/#-42';
    tabUpdatedListener(1, { status: 'loading', url }, { id: 1, url } as chrome.tabs.Tab);
    await send({ scope: 'tad-ui', type: 'list' }, uiSender);

    expect(await store.connections()).toEqual([
      { tabId: 1, sessionId: 'session-1', client: 'a', ready: true },
    ]);
    expect((await store.get('one'))?.state).toBe('downloading');
    expect(
      await send({
        scope: 'tad-page',
        sessionId: 'session-1',
        payload: { type: 'progress', jobId: 'one', bytes: 4, total: 4, state: 'finalizing' },
      }),
    ).toEqual({ ok: true });
  });

  it('keeps an unknown writer after loading until a replacement page establishes its session', async () => {
    await start();
    await send({
      scope: 'tad-page',
      sessionId: 'session-1',
      payload: { type: 'hello', client: 'a', ready: true },
    });
    await store.enqueue(record('one'));
    await store.claimNext();
    sendCommand.mockResolvedValue({ ok: false });

    tabUpdatedListener(1, { status: 'loading' }, { id: 1 } as chrome.tabs.Tab);
    await send({ scope: 'tad-ui', type: 'list' }, uiSender);
    expect((await store.get('one'))?.state).toBe('downloading');
    expect(await store.connections()).toHaveLength(1);

    expect(
      await send({
        scope: 'tad-page',
        sessionId: 'replacement-session',
        payload: { type: 'hello', client: 'a', ready: true },
      }),
    ).toMatchObject({ ok: true });
    expect((await store.get('one'))?.state).toBe('interrupted');
    expect(await store.connections()).toEqual([
      { tabId: 1, sessionId: 'replacement-session', client: 'a', ready: true },
    ]);

    const url = 'https://example.com/';
    tabUpdatedListener(1, { status: 'loading', url }, { id: 1, url } as chrome.tabs.Tab);
    await send({ scope: 'tad-ui', type: 'list' }, uiSender);
    expect(await store.connections()).toEqual([]);
  });

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
