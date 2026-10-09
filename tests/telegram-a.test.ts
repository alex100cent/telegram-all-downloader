import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebAAdapter } from '../src/adapters/telegram-a';
import {
  extractMessageMedia,
  messageAddress,
  messageSourceUrl,
  isChannel,
  type JsonObject,
} from '../src/adapters/telegram-a/model';
import { accountSlot, WebAProtocol } from '../src/adapters/telegram-a/protocol';
import type { MediaAdapter } from '../src/domain/media';

class FakeWorker extends EventTarget {
  sent: JsonObject[] = [];
  handler?: (payload: JsonObject) => void;
  postMessage(message: { payloads: JsonObject[] }): void {
    for (const payload of message.payloads) {
      this.sent.push(payload);
      this.handler?.(payload);
    }
  }
  terminate(): void {
    /* Browser test double. */
  }
  emit(payloads: JsonObject[]): void {
    this.dispatchEvent(new MessageEvent('message', { data: { payloads } }));
  }
  reply(payload: JsonObject, response: unknown): void {
    this.emit([{ type: 'methodResponse', messageId: payload.messageId, response }]);
  }
}

class FakeChannel extends EventTarget {
  static peers: FakeChannel[] = [];
  constructor(readonly name: string) {
    super();
    FakeChannel.peers.push(this);
  }
  postMessage(data: unknown): void {
    for (const peer of FakeChannel.peers) {
      if (peer === this || peer.name !== this.name) continue;
      const original = data as JsonObject;
      const response = original.response as JsonObject | undefined;
      const cloned =
        response?.dataBlob instanceof Blob
          ? { ...original, response: { ...response, dataBlob: response.dataBlob.slice() } }
          : data;
      peer.dispatchEvent(new MessageEvent('message', { data: cloned }));
    }
  }
  close(): void {
    FakeChannel.peers = FakeChannel.peers.filter((peer) => peer !== this);
  }
}

const message = (messageId: number, mediaId: string, type = 'audio', extra: JsonObject = {}) => ({
  id: messageId,
  chatId: '-10042',
  content: {
    [type]: {
      id: mediaId,
      mediaType: type,
      size: 8,
      fileName: 'same-name.mp3',
      mimeType: 'audio/mpeg',
      ...extra,
    },
  },
});

function boot(): FakeWorker {
  const worker = new window.Worker('/worker-test.js') as unknown as FakeWorker;
  const secretArgs = Object.defineProperty({}, 'session', {
    get() {
      throw new Error('Secret data was read');
    },
  });
  worker.postMessage({
    payloads: [{ type: 'initApi', messageId: 'telegram-init', args: secretArgs }],
  });
  worker.emit([
    { type: 'methodResponse', messageId: 'telegram-init', response: true },
    { type: 'updates', updates: [{ '@type': 'updateCurrentUser', currentUser: { id: '101' } }] },
  ]);
  return worker;
}

let adapter: MediaAdapter | undefined;
let protocol: WebAProtocol | undefined;

beforeEach(() => {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('BroadcastChannel', undefined);
  FakeChannel.peers = [];
  document.body.innerHTML =
    '<div id="MiddleColumn"><div data-list-key="-10042_-1_thread"></div></div>';
});

afterEach(() => {
  adapter?.dispose();
  adapter = undefined;
  protocol?.dispose();
  protocol = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Web A identity and media metadata', () => {
  it.each(['photo', 'video', 'sticker'])(
    'resolves an uncached %s from current hashed media markup by exact message ID',
    async (type) => {
      adapter = createWebAAdapter();
      const worker = boot();
      worker.emit([
        { type: 'methodResponse', messageId: 'chats', response: { chats: [{ id: '-10042' }] } },
      ]);
      document.querySelector('[data-list-key]')!.innerHTML =
        '<div class="Message" data-message-id="11"><div class="message-content media"><div class="media-inner n7fx0dq4 s8sR0xJD interactive"><canvas class="thumbnail"></canvas><img class="full-media" src="blob:unrelated-preview" /><span class="protector"></span></div></div></div>';
      worker.handler = (payload) => {
        expect(payload.name).toBe('fetchMessage');
        expect(payload.args).toEqual([
          { chat: { id: '-10042', accessHash: undefined }, messageId: 11 },
        ]);
        worker.reply(payload, { message: message(11, '701', type) });
      };

      const candidates = adapter.discover();
      expect(candidates).toHaveLength(1);
      const source = await candidates[0]!.resolve();
      expect(source.info.identity).toMatchObject({
        peerId: '-10042',
        messageId: '11',
        mediaId: '701',
      });
      expect(source.info.kind).toBe(type);
      expect(worker.sent.filter((payload) => payload.name === 'downloadMedia')).toHaveLength(0);
    },
  );

  it('ignores media markup belonging to link previews and quoted messages', () => {
    adapter = createWebAAdapter();
    boot();
    document.querySelector('[data-list-key]')!.innerHTML =
      '<div class="Message" data-message-id="11"><div class="WebPage"><div class="media-inner"><img src="blob:preview" /></div></div></div>' +
      '<div class="Message" data-message-id="12"><div class="EmbeddedMessage"><div class="media-inner"><img src="blob:quoted" /></div></div></div>';
    expect(adapter.discover()).toHaveLength(0);
  });

  it.each(['edited', 'deleted'])(
    'does not overwrite a message %s during its first metadata request',
    async (change) => {
      adapter = createWebAAdapter();
      const worker = boot();
      worker.emit([
        { type: 'methodResponse', messageId: 'chats', response: { chats: [{ id: '-10042' }] } },
      ]);
      document.querySelector('[data-list-key]')!.innerHTML =
        '<div class="Message" data-message-id="11"><div class="media-inner n7fx0dq4"></div></div>';
      const original = message(11, '701');
      const edited = message(11, '702');
      let requests = 0;
      worker.handler = (payload) => {
        if (++requests === 1) {
          const update =
            change === 'deleted'
              ? { '@type': 'deleteMessages', chatId: '-10042', ids: [11] }
              : {
                  '@type': 'updateMessage',
                  chatId: '-10042',
                  id: 11,
                  isFull: true,
                  message: edited,
                };
          worker.emit([{ type: 'updates', updates: [update] }]);
          worker.reply(payload, { message: original });
        } else worker.reply(payload, { message: change === 'deleted' ? undefined : edited });
      };
      const source = adapter.discover()[0]!.resolve();
      if (change === 'deleted')
        await expect(source).rejects.toMatchObject({ code: 'source_unavailable' });
      else expect((await source).info.identity.mediaId).toBe('702');
      expect(requests).toBe(2);
      expect(adapter.discover()[0]!.key).not.toContain(':701:');
    },
  );

  it('revalidates a prepared photo after a complete snapshot omits cached metadata', async () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const master = new FakeChannel('tt-global_1');
    adapter = createWebAAdapter();
    const worker = boot();
    const photo = message(11, '701', 'photo');
    worker.emit([
      {
        type: 'methodResponse',
        messageId: 'history',
        response: { messages: [photo], chats: [{ id: '-10042' }] },
      },
    ]);
    document.querySelector('[data-list-key]')!.innerHTML =
      '<div class="Message" data-message-id="11"><div class="media-inner n7fx0dq4"><img class="full-media" src="blob:preview" /></div></div>';
    worker.handler = (payload) => worker.reply(payload, { message: photo });
    const prepared = await adapter.discover()[0]!.resolve();
    master.postMessage({
      type: 'globalUpdate',
      global: { currentUserId: '101', messages: { byChatId: {} } },
    });
    const candidates = adapter.discover();
    expect(candidates).toHaveLength(1);
    await expect(prepared.validate?.()).resolves.toBeUndefined();
    expect(worker.sent.filter((payload) => payload.name === 'fetchMessage')).toHaveLength(2);
    await expect(prepared.validate?.()).resolves.toBeUndefined();
    expect(worker.sent.filter((payload) => payload.name === 'fetchMessage')).toHaveLength(2);
  });

  it('uses a chat route discovered after preparation and retains it if a later snapshot loses its access hash', async () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const master = new FakeChannel('tt-global_1');
    adapter = createWebAAdapter();
    const worker = boot();
    const peerId = '-1000000000042';
    const original = { ...message(11, '701'), chatId: peerId };
    worker.emit([
      { type: 'methodResponse', messageId: 'history', response: { messages: [original] } },
    ]);
    const container = document.querySelector<HTMLElement>('[data-list-key]')!;
    container.dataset.listKey = `${peerId}_-1_thread`;
    container.innerHTML = '<div class="Message" data-message-id="11"></div>';
    const prepared = await adapter.discover()[0]!.resolve();
    expect(worker.sent.filter((payload) => payload.name === 'fetchMessage')).toHaveLength(0);

    worker.emit([
      {
        type: 'methodResponse',
        messageId: 'chats',
        response: { chats: [{ id: peerId, accessHash: '123' }] },
      },
    ]);
    master.postMessage({
      type: 'globalDiffUpdate',
      diff: { messages: { byChatId: { __deleteAllChildren: true } } },
    });
    worker.handler = (payload) => {
      expect(payload.name).toBe('fetchMessage');
      expect(payload.args).toEqual([{ chat: { id: peerId, accessHash: '123' }, messageId: 11 }]);
      worker.reply(payload, { message: original });
    };
    await expect(prepared.validate?.()).resolves.toBeUndefined();
    master.postMessage({
      type: 'globalUpdate',
      global: {
        currentUserId: '101',
        chats: { byId: { [peerId]: { id: peerId } } },
        messages: { byChatId: {} },
      },
    });
    await expect(prepared.validate?.()).resolves.toBeUndefined();
    expect(worker.sent.filter((payload) => payload.name === 'fetchMessage')).toHaveLength(2);
  });

  it.each(['deleted', 'media-id', 'size', 'filename', 'ttl', 'peer'])(
    'rejects a %s change when refreshing an evicted prepared source',
    async (change) => {
      vi.stubGlobal('BroadcastChannel', FakeChannel);
      const master = new FakeChannel('tt-global_1');
      adapter = createWebAAdapter();
      const worker = boot();
      const original = message(11, '701');
      worker.emit([
        {
          type: 'methodResponse',
          messageId: 'history',
          response: { messages: [original], chats: [{ id: '-10042' }] },
        },
      ]);
      document.querySelector('[data-list-key]')!.innerHTML =
        '<div class="Message" data-message-id="11"></div>';
      worker.handler = (payload) => worker.reply(payload, { message: original });
      const prepared = await adapter.discover()[0]!.resolve();
      master.postMessage({
        type: 'globalDiffUpdate',
        diff: { messages: { byChatId: { __deleteAllChildren: true } } },
      });
      const changed =
        change === 'deleted'
          ? undefined
          : change === 'media-id'
            ? message(11, '702')
            : change === 'size'
              ? message(11, '701', 'audio', { size: 9 })
              : change === 'filename'
                ? message(11, '701', 'audio', { fileName: 'changed.mp3' })
                : change === 'ttl'
                  ? { ...original, content: { ...original.content, ttlSeconds: 2147483647 } }
                  : { ...original, chatId: '-10043' };
      worker.handler = (payload) => worker.reply(payload, { message: changed });
      await expect(prepared.validate?.()).rejects.toMatchObject({ code: 'source_unavailable' });
    },
  );

  it('does not overwrite an edit received while prepared-source refresh is in flight', async () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const master = new FakeChannel('tt-global_1');
    adapter = createWebAAdapter();
    const worker = boot();
    const original = message(11, '701');
    const edited = message(11, '702');
    worker.emit([
      {
        type: 'methodResponse',
        messageId: 'history',
        response: { messages: [original], chats: [{ id: '-10042' }] },
      },
    ]);
    document.querySelector('[data-list-key]')!.innerHTML =
      '<div class="Message" data-message-id="11"></div>';
    worker.handler = (payload) => worker.reply(payload, { message: original });
    const prepared = await adapter.discover()[0]!.resolve();
    master.postMessage({
      type: 'globalDiffUpdate',
      diff: { messages: { byChatId: { __deleteAllChildren: true } } },
    });
    let requests = 0;
    worker.handler = (payload) => {
      if (++requests === 1) {
        worker.emit([
          {
            type: 'updates',
            updates: [
              { '@type': 'updateMessage', chatId: '-10042', id: 11, isFull: true, message: edited },
            ],
          },
        ]);
        worker.reply(payload, { message: original });
      } else worker.reply(payload, { message: edited });
    };
    await expect(prepared.validate?.()).rejects.toMatchObject({ code: 'source_unavailable' });
    expect(requests).toBe(2);
    expect(adapter.discover()[0]!.key).toContain(':702:');
  });

  it.each(['deleted', 'ttl'])(
    'observes a %s update during refresh even when metadata is already absent',
    async (change) => {
      vi.stubGlobal('BroadcastChannel', FakeChannel);
      const master = new FakeChannel('tt-global_1');
      adapter = createWebAAdapter();
      const worker = boot();
      const original = message(11, '701');
      worker.emit([
        {
          type: 'methodResponse',
          messageId: 'history',
          response: { messages: [original], chats: [{ id: '-10042' }] },
        },
      ]);
      document.querySelector('[data-list-key]')!.innerHTML =
        '<div class="Message" data-message-id="11"></div>';
      worker.handler = (payload) => worker.reply(payload, { message: original });
      const prepared = await adapter.discover()[0]!.resolve();
      master.postMessage({
        type: 'globalDiffUpdate',
        diff: { messages: { byChatId: { __deleteAllChildren: true } } },
      });
      const changed =
        change === 'deleted'
          ? undefined
          : { ...original, content: { ...original.content, ttlSeconds: 2147483647 } };
      let requests = 0;
      worker.handler = (payload) => {
        if (++requests === 1) {
          const update =
            change === 'deleted'
              ? { '@type': 'deleteMessages', chatId: '-10042', ids: [11] }
              : {
                  '@type': 'updateMessage',
                  chatId: '-10042',
                  id: 11,
                  isFull: true,
                  message: changed,
                };
          worker.emit([{ type: 'updates', updates: [update] }]);
          worker.reply(payload, { message: original });
        } else worker.reply(payload, { message: changed });
      };
      await expect(prepared.validate?.()).rejects.toMatchObject({ code: 'source_unavailable' });
      expect(requests).toBe(2);
    },
  );

  it('keeps exact IDs independent of equal audio filenames and ignores text/previews', () => {
    const first = extractMessageMedia(message(11, '701'))!;
    const second = extractMessageMedia(message(12, '702'))!;
    expect(first.filename).toBe(second.filename);
    expect(first.url).toBe('document701');
    expect(second.url).toBe('document702');
    expect(
      extractMessageMedia({
        id: 1,
        chatId: '2',
        content: { text: { text: 'private text' }, webPage: { photo: {} } },
      }),
    ).toBeUndefined();
  });

  it.each([
    ['photo', {}, 'photo', 'jpg'],
    ['voice', {}, 'voice', 'ogg'],
    ['video', { isRound: true }, 'round-video', 'bin'],
    ['video', { isGif: true, mimeType: 'video/mp4' }, 'animation', 'mp4'],
    ['sticker', { isLottie: true }, 'sticker', 'tgs'],
    ['sticker', { isVideo: true }, 'sticker', 'webm'],
    ['sticker', {}, 'sticker', 'webp'],
  ])('preserves the real %s format', (type, extra, kind, extension) => {
    const media = extractMessageMedia({
      id: 1,
      chatId: '2',
      content: { [type]: { id: '3', ...extra } },
    })!;
    expect(media.kind).toBe(kind);
    expect(media.filename).toMatch(new RegExp(`\\.${extension}$`));
  });

  it('uses each album item ID, rejects paid preview indexes and ignores route guesses', () => {
    const container = document.querySelector('[data-list-key]')!;
    container.innerHTML =
      '<div class="Message" data-message-id="11"><div id="album-media-message-12"></div><div id="album-media-message-11-1"></div></div>';
    expect(messageAddress(document.getElementById('album-media-message-12')!)).toEqual({
      peerId: '-10042',
      messageId: '12',
    });
    expect(messageAddress(document.getElementById('album-media-message-11-1')!)).toBeUndefined();
    expect(messageAddress(document.createElement('div'))).toBeUndefined();
    expect(accountSlot('https://web.telegram.org/a/?account=3')).toBe(3);
  });

  it('excludes view-once voice and video and builds exact channel message links', () => {
    for (const type of ['voice', 'video']) {
      const original = message(11, '701', type);
      expect(
        extractMessageMedia({
          ...original,
          content: { ...original.content, ttlSeconds: 2147483647 },
        }),
      ).toBeUndefined();
    }
    expect(isChannel('-1000000000042')).toBe(true);
    expect(isChannel('-10042')).toBe(false);
    const url = new URL(messageSourceUrl('-1000000000042', '11'));
    const params = new URLSearchParams(url.hash.split('?')[1]);
    expect(params.get('tgaddr')).toBe('tg://privatepost?channel=42&post=11');
    expect(messageSourceUrl('42', '11')).toBe('https://web.telegram.org/a/#42');
  });
});

describe('Web A worker transport', () => {
  const observer = () => ({ data: vi.fn(), outgoing: vi.fn(), reset: vi.fn(), blob: vi.fn() });

  it('filters our responses from mixed batches while preserving Telegram responses', async () => {
    protocol = new WebAProtocol(observer(), 1);
    const worker = boot();
    const appListener = vi.fn();
    worker.addEventListener('message', appListener);
    const request = protocol.request('downloadMedia', [{ url: 'document701', mediaFormat: 1 }]);
    const sent = worker.sent.at(-1)!;
    worker.emit([
      { type: 'methodResponse', messageId: sent.messageId, response: { fullSize: 8 } },
      { type: 'methodResponse', messageId: 'telegram-request', response: 'kept' },
    ]);
    await expect(request).resolves.toEqual({ fullSize: 8 });
    expect(appListener.mock.calls[0]?.[0].data.payloads).toEqual([
      { type: 'methodResponse', messageId: 'telegram-request', response: 'kept' },
    ]);
  });

  it('cancels the native request and absorbs late completion without touching app playback', async () => {
    protocol = new WebAProtocol(observer(), 1);
    const worker = boot();
    const controller = new AbortController();
    const request = protocol.request('downloadMedia', [{ url: 'document701' }], controller.signal);
    const sent = worker.sent.at(-1)!;
    const rejection = expect(request).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    await rejection;
    expect(worker.sent.at(-1)).toEqual({ type: 'cancelProgress', messageId: sent.messageId });
    const appListener = vi.fn();
    worker.addEventListener('message', appListener);
    worker.reply(sent, new ArrayBuffer(8));
    expect(appListener).not.toHaveBeenCalled();
  });

  it('times out and rejects pending calls if the API worker terminates', async () => {
    vi.useFakeTimers();
    protocol = new WebAProtocol(observer(), 1);
    const worker = boot();
    const request = protocol.request('downloadMedia', []);
    const rejection = expect(request).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
    const second = protocol.request('downloadMedia', []);
    const secondRejection = expect(second).rejects.toMatchObject({ code: 'account_changed' });
    worker.terminate();
    await secondRejection;
  });

  it('routes a slave-tab request only through its account channel without requesting global state', async () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const matching = new FakeChannel('tt-global_3');
    const otherAccount = new FakeChannel('tt-global_1');
    const otherListener = vi.fn();
    otherAccount.addEventListener('message', otherListener);
    const requests: JsonObject[] = [];
    matching.addEventListener('message', (event) => {
      const data = (event as MessageEvent).data as JsonObject;
      requests.push(data);
      matching.postMessage({
        type: 'messageResponse',
        messageId: data.messageId,
        token: data.token,
        response: { fullSize: 8 },
      });
    });
    protocol = new WebAProtocol(observer(), 3);
    await expect(protocol.request('downloadMedia', [{ url: 'document701' }])).resolves.toEqual({
      fullSize: 8,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.type).toBe('callApi');
    expect(otherListener).not.toHaveBeenCalled();
  });

  it('correlates the actual Blob received by the app channel despite separate structured clones', () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const master = new FakeChannel('tt-global_1');
    const listeners = observer();
    protocol = new WebAProtocol(listeners, 1);
    const appChannel = new window.BroadcastChannel('tt-global_1');
    let appBlob: Blob | undefined;
    appChannel.addEventListener('message', (event) => {
      appBlob = event.data.response.dataBlob;
    });
    appChannel.postMessage({
      type: 'callApi',
      name: 'downloadMedia',
      args: [{ url: 'photo900' }],
      messageId: 'app-photo',
      token: 22,
    });
    const source = new Blob(['photo'], { type: 'image/jpeg' });
    master.postMessage({
      type: 'messageResponse',
      messageId: 'app-photo',
      token: 22,
      response: { dataBlob: source },
    });
    expect(appBlob).not.toBe(source);
    expect(
      listeners.blob.mock.calls.some(([blob, url]) => blob === appBlob && url === 'photo900'),
    ).toBe(true);
  });
});

describe('Web A adapter', () => {
  it('downloads the selected unplayed audio, validates ranges, and blocks account switches', async () => {
    adapter = createWebAAdapter();
    const worker = boot();
    worker.emit([
      {
        type: 'methodResponse',
        messageId: 'history',
        response: { messages: [message(11, '701'), message(12, '702')] },
      },
    ]);
    document.querySelector('[data-list-key]')!.innerHTML =
      '<div class="Message" data-message-id="11"><div class="Audio"></div></div><div class="Message" data-message-id="12"><div class="Audio"></div></div>';
    const audio = document.createElement('audio');
    const play = vi.spyOn(audio, 'play');
    document.body.append(audio);
    const source = await adapter.discover()[1]!.resolve();
    worker.handler = (payload) => {
      if (payload.name === 'downloadMedia') {
        const args = (payload.args as JsonObject[])[0]!;
        expect(args.url).toBe('document702');
        worker.reply(payload, {
          arrayBuffer: new Uint8Array([5, 6, 7, 8]).buffer,
          fullSize: 8,
          mimeType: 'audio/mpeg',
        });
      }
    };
    const result = await source.read(4, 4, new AbortController().signal);
    expect([...result.bytes]).toEqual([5, 6, 7, 8]);
    expect(result.done).toBe(true);
    expect(play).not.toHaveBeenCalled();
    worker.emit([
      { type: 'updates', updates: [{ '@type': 'updateCurrentUser', currentUser: { id: '202' } }] },
    ]);
    await expect(source.read(0, 4, new AbortController().signal)).rejects.toMatchObject({
      code: 'account_changed',
    });
  });

  it('rejects a partial chunk and changed file size instead of claiming completion', async () => {
    adapter = createWebAAdapter();
    const worker = boot();
    worker.emit([
      {
        type: 'methodResponse',
        messageId: 'history',
        response: { messages: [message(11, '701')] },
      },
    ]);
    document.querySelector('[data-list-key]')!.innerHTML =
      '<div class="Message" data-message-id="11"></div>';
    const source = await adapter.discover()[0]!.resolve();
    worker.handler = (payload) =>
      worker.reply(payload, { arrayBuffer: new Uint8Array(2).buffer, fullSize: 8 });
    await expect(source.read(0, 4, new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    worker.handler = (payload) =>
      worker.reply(payload, { arrayBuffer: new Uint8Array(4).buffer, fullSize: 9 });
    await expect(source.read(0, 4, new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('reads the full photo once and never uses the loaded preview URL', async () => {
    adapter = createWebAAdapter();
    const worker = boot();
    worker.emit([
      {
        type: 'methodResponse',
        messageId: 'history',
        response: { messages: [message(11, '900', 'photo')] },
      },
    ]);
    document.querySelector('[data-list-key]')!.innerHTML =
      '<div class="Message" data-message-id="11"><img src="blob:preview" /></div>';
    const source = await adapter.discover()[0]!.resolve();
    worker.handler = (payload) => {
      expect((payload.args as JsonObject[])[0]!.url).toBe('photo900');
      worker.reply(payload, {
        arrayBuffer: new Uint8Array([1, 2, 3, 4, 5, 6]).buffer,
        mimeType: 'image/jpeg',
      });
    };
    expect([...(await source.read(0, 4, new AbortController().signal)).bytes]).toEqual([
      1, 2, 3, 4,
    ]);
    expect([...(await source.read(4, 4, new AbortController().signal)).bytes]).toEqual([5, 6]);
    expect(worker.sent.filter((payload) => payload.name === 'downloadMedia')).toHaveLength(1);
  });

  it('rejects transformed animated sticker JSON and preserves original gzip bytes', async () => {
    adapter = createWebAAdapter();
    const worker = boot();
    const sticker = {
      id: 11,
      chatId: '-10042',
      content: { sticker: { id: '900', isLottie: true } },
    };
    worker.emit([
      { type: 'methodResponse', messageId: 'history', response: { messages: [sticker] } },
    ]);
    document.querySelector('[data-list-key]')!.innerHTML =
      '<div class="Message" data-message-id="11"></div>';
    const source = await adapter.discover()[0]!.resolve();
    worker.handler = (payload) =>
      worker.reply(payload, { arrayBuffer: new TextEncoder().encode('{}').buffer, fullSize: 2 });
    await expect(source.read(0, 4, new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    worker.handler = (payload) =>
      worker.reply(payload, {
        arrayBuffer: new Uint8Array([0x1f, 0x8b, 0x08]).buffer,
        fullSize: 3,
      });
    expect([...(await source.read(0, 4, new AbortController().signal)).bytes]).toEqual([
      0x1f, 0x8b, 0x08,
    ]);
  });

  it('keeps ranges above 4 GiB exact without constructing a whole-file buffer', async () => {
    const size = 5 * 1024 * 1024 * 1024;
    adapter = createWebAAdapter();
    const worker = boot();
    worker.emit([
      {
        type: 'methodResponse',
        messageId: 'history',
        response: {
          messages: [message(11, '701', 'document', { size })],
        },
      },
    ]);
    document.querySelector('[data-list-key]')!.innerHTML =
      '<div class="Message" data-message-id="11"></div>';
    const source = await adapter.discover()[0]!.resolve();
    worker.handler = (payload) => {
      const args = (payload.args as JsonObject[])[0]!;
      expect(args.start).toBe(size - 4);
      expect(args.end).toBe(size - 1);
      worker.reply(payload, { arrayBuffer: new Uint8Array([1, 2, 3, 4]).buffer, fullSize: size });
    };
    const result = await source.read(size - 4, 4, new AbortController().signal);
    expect(result).toMatchObject({ totalSize: size, done: true });
    expect(result.bytes.byteLength).toBe(4);
  });

  it('refreshes a cached exact message and refuses a response for another message', async () => {
    adapter = createWebAAdapter();
    const worker = boot();
    worker.emit([
      {
        type: 'methodResponse',
        messageId: 'history',
        response: {
          messages: [message(11, '701')],
          chats: [{ id: '-10042', accessHash: '777' }],
        },
      },
    ]);
    document.querySelector('[data-list-key]')!.innerHTML =
      '<div class="Message" data-message-id="11"></div>';
    worker.handler = (payload) => {
      expect(payload.name).toBe('fetchMessage');
      expect(payload.args).toEqual([{ chat: { id: '-10042', accessHash: '777' }, messageId: 11 }]);
      worker.reply(payload, { message: message(12, '702') });
    };
    await expect(adapter.discover()[0]!.resolve()).rejects.toMatchObject({
      code: 'source_unavailable',
    });
  });

  it('adds a viewer candidate only for an unambiguous exact media source', async () => {
    adapter = createWebAAdapter();
    const worker = boot();
    worker.emit([
      {
        type: 'methodResponse',
        messageId: 'history',
        response: { messages: [message(11, '701', 'video')] },
      },
    ]);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<dialog id="MediaViewer" open><div class="MediaViewerSlide--active"><video src="https://web.telegram.org/a/progressive/document701"></video></div></dialog>',
    );
    expect(adapter.discover()).toHaveLength(1);
    worker.emit([
      {
        type: 'methodResponse',
        messageId: 'history-2',
        response: { messages: [message(12, '701', 'video')] },
      },
    ]);
    expect(adapter.discover()).toHaveLength(0);
  });

  it('applies partial metadata edits, ignores private text, and invalidates prepared sources on deletion', async () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const master = new FakeChannel('tt-global_1');
    adapter = createWebAAdapter();
    const worker = boot();
    worker.emit([
      {
        type: 'methodResponse',
        messageId: 'history',
        response: { messages: [message(11, '701')] },
      },
    ]);
    document.querySelector('[data-list-key]')!.innerHTML =
      '<div class="Message" data-message-id="11"><div class="Audio"></div></div>';
    const originalCandidate = adapter.discover()[0]!;
    const source = await originalCandidate.resolve();
    master.postMessage({
      type: 'globalDiffUpdate',
      diff: {
        messages: {
          byChatId: {
            '-10042': {
              byId: {
                11: { content: { text: { text: 'Private text must not affect metadata' } } },
              },
            },
          },
        },
      },
    });
    await expect(source.validate?.()).resolves.toBeUndefined();
    master.postMessage({
      type: 'globalDiffUpdate',
      diff: {
        messages: {
          byChatId: {
            '-10042': {
              byId: {
                11: { content: { audio: { id: '702', fileName: 'changed.mp3' } } },
              },
            },
          },
        },
      },
    });
    await expect(source.validate?.()).rejects.toMatchObject({ code: 'source_unavailable' });
    const nextCandidate = adapter.discover()[0]!;
    expect(nextCandidate.key).not.toBe(originalCandidate.key);
    const updated = await nextCandidate.resolve();
    expect(updated.info).toMatchObject({
      filename: 'changed.mp3',
      byteSize: 8,
      identity: { mediaId: '702' },
    });
    master.postMessage({
      type: 'globalDiffUpdate',
      diff: {
        messages: {
          byChatId: {
            '-10042': {
              byId: {
                11: { __delete: true },
              },
            },
          },
        },
      },
    });
    await expect(updated.validate?.()).rejects.toMatchObject({ code: 'source_unavailable' });
  });

  it('invalidates a slave account when currentUserId is removed and rejects TTL introduced by a diff', async () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const master = new FakeChannel('tt-global_1');
    adapter = createWebAAdapter();
    const state = {
      currentUserId: '101',
      messages: { byChatId: { '-10042': { byId: { 11: message(11, '701', 'voice') } } } },
    };
    master.postMessage({ type: 'globalUpdate', global: state });
    document.querySelector('[data-list-key]')!.innerHTML =
      '<div class="Message" data-message-id="11"></div>';
    const source = await adapter.discover()[0]!.resolve();
    master.postMessage({ type: 'globalUpdate', global: state });
    await expect(source.validate?.()).resolves.toBeUndefined();
    master.postMessage({
      type: 'globalDiffUpdate',
      diff: {
        messages: {
          byChatId: {
            '-10042': {
              byId: {
                11: { content: { ttlSeconds: 2147483647 } },
              },
            },
          },
        },
      },
    });
    document.querySelector('[data-message-id="11"]')!.innerHTML = '<div class="Audio"></div>';
    expect(adapter.discover()).toHaveLength(0);
    await expect(source.validate?.()).rejects.toMatchObject({ code: 'source_unavailable' });
    master.postMessage({ type: 'globalDiffUpdate', diff: { currentUserId: { __delete: true } } });
    await expect(source.validate?.()).rejects.toMatchObject({ code: 'account_changed' });
  });

  it('observes a cache-hit photo Blob without issuing additional cache reads', async () => {
    const cacheMatch = vi.fn(
      async () => new Response('photo', { headers: { 'Content-Type': 'image/jpeg' } }),
    );
    class FakeCache {
      match = cacheMatch;
    }
    FakeCache.prototype.match = cacheMatch;
    vi.stubGlobal('Cache', FakeCache);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cached-photo');
    adapter = createWebAAdapter();
    const worker = boot();
    worker.emit([
      {
        type: 'methodResponse',
        messageId: 'history',
        response: { messages: [message(11, '900', 'photo')] },
      },
    ]);
    const cache = Object.create(FakeCache.prototype) as Cache;
    const response = await cache.match(new Request(`${location.origin}/photo900`));
    const blob = await response!.blob();
    const url = URL.createObjectURL(blob);
    document.body.insertAdjacentHTML(
      'beforeend',
      `<dialog id="MediaViewer" open><div class="MediaViewerSlide--active"><img src="${url}" /></div></dialog>`,
    );
    expect(adapter.discover()).toHaveLength(1);
    expect(cacheMatch).toHaveBeenCalledTimes(1);
    expect(worker.sent.filter((payload) => payload.name === 'downloadMedia')).toHaveLength(0);
  });

  it('rejects simultaneous reads on the same resolved source', async () => {
    adapter = createWebAAdapter();
    const worker = boot();
    worker.emit([
      {
        type: 'methodResponse',
        messageId: 'history',
        response: { messages: [message(11, '701')] },
      },
    ]);
    document.querySelector('[data-list-key]')!.innerHTML =
      '<div class="Message" data-message-id="11"></div>';
    const source = await adapter.discover()[0]!.resolve();
    const controller = new AbortController();
    const first = source.read(0, 4, controller.signal);
    const rejected = expect(first).rejects.toMatchObject({ code: 'cancelled' });
    await expect(source.read(0, 4, controller.signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    controller.abort();
    await rejected;
  });
});
