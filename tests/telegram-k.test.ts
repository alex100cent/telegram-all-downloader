// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebKAdapter } from '../src/adapters/telegram-k';
import { transferToWriter } from '../src/downloads/stream';
import { mediaKey } from '../src/domain/media';

type RecordData = Record<string, unknown>;

function documentMedia(overrides: RecordData = {}) {
  return {
    _: 'document',
    id: '9223372036854775800',
    access_hash: 'fixture-file-access',
    file_reference: new Uint8Array([1, 2, 3]),
    dc_id: 2,
    size: 4,
    mime_type: 'audio/mpeg',
    attributes: [{ _: 'documentAttributeAudio' }],
    file_name: 'Podcast.mp3',
    ...overrides,
  };
}

function setup(bytes = new Uint8Array([1, 2, 3, 4])) {
  const messages = new Map<string, RecordData>();
  const rootScope = { myId: '12345', managers: {} };
  const getSelf = vi.fn(async () => ({ id: rootScope.myId }));
  const requestFilePart = vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => ({
    _: 'upload.file',
    bytes: bytes.slice(offset, offset + limit),
  }));
  const managers = {
    appUsersManager: { getSelf },
    apiFileManager: { requestFilePart },
    appMessagesManager: {
      getMessageByPeer: vi.fn(async (peer: number, mid: number) => messages.get(`${peer}:${mid}`)),
    },
  };
  rootScope.managers = managers;
  const createManagers = vi.fn(() => managers);
  vi.stubGlobal('rootScope', rootScope);
  vi.stubGlobal('createProxiedManagersForAccount', createManagers);
  vi.stubGlobal('apiManagerProxy', {
    getMessageByPeer: (peer: number, mid: number) => messages.get(`${peer}:${mid}`),
  });
  const put = (mid: string, media: RecordData, peer = '-42', extra: RecordData = {}) => {
    const message: RecordData = {
      _: 'message',
      peerId: peer,
      mid: Number(mid),
      id: Number(mid),
      media: { document: media },
      ...extra,
    };
    messages.set(`${peer}:${mid}`, message);
    return message;
  };
  const bubble = (mid: string, peer = '-42') => {
    const element = document.createElement('div');
    element.className = 'bubble';
    element.dataset.mid = mid;
    element.dataset.peerId = peer;
    document.body.append(element);
    return element;
  };
  return { rootScope, messages, managers, createManagers, requestFilePart, put, bubble };
}

beforeEach(() => {
  vi.stubGlobal('location', new URL('https://web.telegram.org/k/'));
  document.body.replaceChildren();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Telegram Web K adapter', () => {
  it('deduplicates the same channel document with Web A while retaining K routing', async () => {
    const env = setup();
    env.put('500000007', documentMedia(), '-42', {
      id: 7,
      peer_id: { _: 'peerChannel', channel_id: 42 },
    });
    env.bubble('500000007');
    const source = await createWebKAdapter().discover()[0]!.resolve();
    expect(mediaKey(source.info.identity)).toBe(
      mediaKey({
        client: 'a',
        accountId: '12345',
        peerId: '-1000000000042',
        messageId: '7',
        mediaId: '9223372036854775800',
        variant: 'original',
      }),
    );
    expect(source.info.sourceUrl).toBe('https://web.telegram.org/k/?account=1#-42?message=7');
    expect((await source.read(0, 4096, new AbortController().signal)).bytes).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it('reads the clicked unplayed podcast by message identity, independently of the current audio', async () => {
    const env = setup();
    env.put('100', documentMedia());
    env.put('101', documentMedia({ id: '9223372036854775801', file_name: 'Other.mp3' }));
    const selectedBubble = env.bubble('100');
    env.bubble('101');
    const audio = document.createElement('audio');
    audio.src = 'blob:https://web.telegram.org/unrelated-prefetch';
    document.body.append(audio);
    const play = vi.spyOn(audio, 'play');
    const adapter = createWebKAdapter();
    const source = await adapter
      .discover()
      .find((candidate) => candidate.anchor === selectedBubble)!
      .resolve();
    const result = await source.read(0, 4096, new AbortController().signal);
    expect(source.info.identity).toMatchObject({
      client: 'k',
      peerId: '-42',
      messageId: '100',
      mediaId: '9223372036854775800',
      accountId: '12345',
    });
    expect(source.info.filename).toBe('Podcast.mp3');
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(result.done).toBe(true);
    expect(env.requestFilePart.mock.calls[0]![0]).toMatchObject({
      location: { id: '9223372036854775800', thumb_size: '' },
      offset: 0,
      limit: 4096,
    });
    expect(play).not.toHaveBeenCalled();
    expect(JSON.stringify(source.info)).not.toContain('fixture-file-access');
    expect(JSON.stringify(source.info)).not.toContain('file_reference');
  });

  it('reads complete sequential original chunks without asking the native Blob downloader', async () => {
    const bytes = Uint8Array.from({ length: 8192 + 333 }, (_, index) => index % 251);
    const env = setup(bytes);
    env.put('100', documentMedia({ size: bytes.length }));
    env.bubble('100');
    const source = await createWebKAdapter().discover()[0]!.resolve();
    const received: number[] = [];
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      const part = await source.read(offset, 4096, new AbortController().signal);
      received.push(...part.bytes);
      expect(part.done).toBe(offset + part.bytes.length === bytes.length);
    }
    expect(Uint8Array.from(received)).toEqual(bytes);
    expect(env.requestFilePart).toHaveBeenCalledTimes(3);
  });

  it('works with the shared writer when the final requested range is not Telegram-aligned', async () => {
    const original = Uint8Array.from({ length: 512 * 1024 + 333 }, (_, index) => index % 251);
    const env = setup(original);
    env.put('100', documentMedia({ size: original.byteLength }));
    env.bubble('100');
    const source = await createWebKAdapter().discover()[0]!.resolve();
    const saved = new Uint8Array(original.byteLength);
    let position = 0;
    const close = vi.fn(async () => undefined);
    await transferToWriter(
      source,
      {
        async write(bytes) {
          saved.set(bytes, position);
          position += bytes.byteLength;
        },
        close,
        abort: vi.fn(async () => undefined),
      },
      new AbortController().signal,
      () => undefined,
    );
    expect(saved).toEqual(original);
    expect(close).toHaveBeenCalledOnce();
    expect(env.requestFilePart.mock.calls[1]![0]).toMatchObject({
      offset: 512 * 1024,
      limit: 4096,
    });
  });

  it('chooses the largest downloadable photo rather than cached or stripped previews', async () => {
    const env = setup();
    env.put('100', documentMedia(), '-42', {
      media: {
        photo: {
          _: 'photo',
          id: '8888',
          access_hash: 'photo-access',
          file_reference: [1],
          dc_id: 4,
          sizes: [
            { _: 'photoSize', type: 'm', w: 320, h: 240, size: 500 },
            { _: 'photoSizeProgressive', type: 'y', w: 1280, h: 960, sizes: [100, 1000, 2000] },
            { _: 'photoStrippedSize', type: 'i', bytes: [1] },
            { _: 'photoCachedSize', type: 'c', w: 4096, h: 4096, bytes: [1] },
          ],
        },
      },
    });
    env.bubble('100');
    const source = await createWebKAdapter().discover()[0]!.resolve();
    expect(source.info).toMatchObject({
      kind: 'photo',
      byteSize: 2000,
      mimeType: 'image/jpeg',
      filename: 'photo_8888_y.jpg',
    });
    expect(source.info.identity.variant).toBe('original');
  });

  it.each([
    ['audio', [{ _: 'documentAttributeAudio' }], 'audio/flac', 'flac'],
    ['voice', [{ _: 'documentAttributeAudio', pFlags: { voice: true } }], 'audio/ogg', 'ogg'],
    [
      'round-video',
      [{ _: 'documentAttributeVideo', pFlags: { round_message: true } }],
      'video/mp4',
      'mp4',
    ],
    ['video', [{ _: 'documentAttributeVideo' }], 'video/mp4', 'mp4'],
    [
      'animation',
      [{ _: 'documentAttributeAnimated' }, { _: 'documentAttributeVideo' }],
      'video/mp4',
      'mp4',
    ],
    ['document', [], 'application/pdf', 'pdf'],
    ['sticker', [{ _: 'documentAttributeSticker' }], 'image/webp', 'webp'],
    ['sticker', [{ _: 'documentAttributeSticker' }], 'video/webm', 'webm'],
    ['sticker', [{ _: 'documentAttributeSticker' }], 'application/x-tgsticker', 'tgs'],
  ])('preserves the real format of %s (%s)', async (kind, attributes, mime, extension) => {
    const env = setup();
    env.put('100', documentMedia({ file_name: undefined, attributes, mime_type: mime }));
    env.bubble('100');
    const source = await createWebKAdapter().discover()[0]!.resolve();
    expect(source.info.kind).toBe(kind);
    expect(source.info.mimeType).toBe(mime);
    expect(source.info.filename).toBe(`${kind}_9223372036854775800.${extension}`);
  });

  it('preserves gzip TGS bytes without the Telegram renderer conversion', async () => {
    const raw = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
    const env = setup(raw);
    env.put(
      '100',
      documentMedia({
        mime_type: 'application/x-tgsticker',
        attributes: [{ _: 'documentAttributeSticker' }],
      }),
    );
    env.bubble('100');
    const source = await createWebKAdapter().discover()[0]!.resolve();
    expect((await source.read(0, 4096, new AbortController().signal)).bytes).toEqual(raw);
  });

  it('keeps album items separate, including documents grouped inside one bubble', async () => {
    const env = setup();
    env.put('100', documentMedia());
    env.put('101', documentMedia({ id: '98765' }));
    const album = env.bubble('100');
    album.innerHTML =
      '<div class="grouped-item" data-mid="100"></div><div class="grouped-item" data-mid="101"></div>';
    const candidates = createWebKAdapter().discover();
    expect(candidates).toHaveLength(2);
    expect((await candidates[1]!.resolve()).info.identity).toMatchObject({
      messageId: '101',
      mediaId: '98765',
    });
  });

  it('uses the explicit media index for accessible paid albums and skips unpaid previews', async () => {
    const env = setup();
    env.put('100', documentMedia(), '-42', {
      media: {
        extended_media: [
          { _: 'messageExtendedMediaPreview' },
          { _: 'messageExtendedMedia', media: { document: documentMedia({ id: '999' }) } },
        ],
      },
    });
    const album = env.bubble('100');
    album.innerHTML =
      '<div class="album-item" data-index="0"></div><div class="album-item" data-index="1"></div>';
    const candidates = createWebKAdapter().discover();
    expect(candidates).toHaveLength(1);
    expect((await candidates[0]!.resolve()).info.identity.mediaId).toBe('999');
  });

  it('addresses the current viewer target directly after paging to a different message', async () => {
    const env = setup();
    env.put('100', documentMedia());
    const second = env.put('101', documentMedia({ id: '555' }));
    env.bubble('100');
    const viewer = document.createElement('div');
    viewer.innerHTML = '<div class="media-viewer-buttons"></div>';
    document.body.append(viewer);
    vi.stubGlobal('appMediaViewer', {
      wholeDiv: viewer,
      target: { peerId: '-42', mid: 101, message: second, index: -1 },
    });
    const candidates = createWebKAdapter().discover();
    expect(
      (await candidates.find((candidate) => candidate.key.endsWith(':viewer'))!.resolve()).info
        .identity.mediaId,
    ).toBe('555');
  });

  it('allows readable protected channel attachments without changing protection flags', async () => {
    const env = setup();
    const message = env.put('100', documentMedia(), '-42', { pFlags: { noforwards: true } });
    env.bubble('100');
    const source = await createWebKAdapter().discover()[0]!.resolve();
    expect((await source.read(0, 4096, new AbortController().signal)).done).toBe(true);
    expect(message.pFlags).toEqual({ noforwards: true });
  });

  it('rejects an account change before reading any bytes', async () => {
    const env = setup();
    env.put('100', documentMedia());
    env.bubble('100');
    const source = await createWebKAdapter().discover()[0]!.resolve();
    env.rootScope.myId = '67890';
    await expect(source.read(0, 4096, new AbortController().signal)).rejects.toMatchObject({
      code: 'account_changed',
    });
    expect(env.requestFilePart).not.toHaveBeenCalled();
  });

  it('rejects an edited attachment rather than downloading a replacement under the old identity', async () => {
    const env = setup();
    env.put('100', documentMedia());
    env.bubble('100');
    const candidate = createWebKAdapter().discover()[0]!;
    const source = await candidate.resolve();
    env.put('100', documentMedia({ id: '666' }));
    await expect(candidate.resolve()).rejects.toMatchObject({ code: 'ambiguous_media' });
    await expect(source.read(0, 4096, new AbortController().signal)).rejects.toMatchObject({
      code: 'ambiguous_media',
    });
    expect(env.requestFilePart).not.toHaveBeenCalled();
  });

  it('rejects a truncated response even when the server reports success', async () => {
    const env = setup(new Uint8Array(100));
    env.put('100', documentMedia({ size: 200 }));
    env.bubble('100');
    const source = await createWebKAdapter().discover()[0]!.resolve();
    await expect(source.read(0, 4096, new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('cancels a waiting request without cancelling Telegram playback requests for the same document', async () => {
    const env = setup();
    env.put('100', documentMedia());
    env.bubble('100');
    let finish!: (value: { _: string; bytes: Uint8Array<ArrayBuffer> }) => void;
    env.requestFilePart.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const source = await createWebKAdapter().discover()[0]!.resolve();
    const controller = new AbortController();
    const first = source.read(0, 4096, controller.signal);
    await vi.waitFor(() => expect(env.requestFilePart).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    await expect(source.read(0, 4096, new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    finish({ _: 'upload.file', bytes: new Uint8Array([1, 2, 3, 4]) });
  });

  it('does not discover expiring media, link previews, text-only messages, or avatars', () => {
    const env = setup();
    env.put('100', documentMedia(), '-42', {
      media: { document: documentMedia(), ttl_seconds: 10 },
    });
    env.put('101', documentMedia(), '-42', { media: { webpage: { document: documentMedia() } } });
    env.put('102', documentMedia(), '-42', { media: undefined });
    env.bubble('100');
    env.bubble('101');
    env.bubble('102');
    expect(createWebKAdapter().discover()).toEqual([]);
  });

  it('fails with an explicit compatibility error if the Telegram runtime disappears', async () => {
    const env = setup();
    env.put('100', documentMedia());
    env.bubble('100');
    const candidate = createWebKAdapter().discover()[0]!;
    vi.stubGlobal('createProxiedManagersForAccount', undefined);
    await expect(candidate.resolve()).rejects.toMatchObject({ code: 'unsupported_client' });
  });
});
