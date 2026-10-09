import { DownloadError, throwIfAborted } from '../../domain/errors';
import type {
  MediaAdapter,
  MediaCandidate,
  MediaInfo,
  MediaKind,
  ResolvedMedia,
} from '../../domain/media';

type Data = Record<string, unknown>;
type FileLocation = Data & {
  _: string;
  id: unknown;
  access_hash: unknown;
  file_reference: unknown;
  thumb_size: string;
};
type PartOptions = {
  dcId: number;
  location: FileLocation;
  offset: number;
  limit: number;
  floodMaxTimeout: number;
};
interface Managers {
  appUsersManager: { getSelf(): Promise<unknown> };
  appMessagesManager: { getMessageByPeer(peer: number, mid: number): Promise<unknown> };
  apiFileManager: { requestFilePart(options: PartOptions): Promise<unknown> };
}
interface WebKWindow extends Window {
  rootScope?: { myId?: unknown; managers?: Managers };
  apiManagerProxy?: { getMessageByPeer(peer: number, mid: number): unknown };
  createProxiedManagersForAccount?: (account: number) => Managers;
  appMediaViewer?: {
    target?: { peerId?: unknown; mid?: unknown; message?: unknown; index?: number };
    wholeDiv?: HTMLElement;
  };
}
interface Target {
  peer: string;
  mid: string;
  index: number;
  message?: unknown;
}
interface Selection {
  media: Data;
  variant: string;
  size?: number;
  kind: MediaKind;
  mime: string;
  filename: string;
  location: FileLocation;
  dcId: number;
}

const MAX_PART_SIZE = 512 * 1024;
const PART_TIMEOUT_MS = 60_000;
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/x-wav': 'wav',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'application/x-tgsticker': 'tgs',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'application/octet-stream': 'bin',
};

function data(value: unknown): Data | undefined {
  return value !== null && typeof value === 'object' ? (value as Data) : undefined;
}

function decimal(value: unknown, positive = false): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return;
  const result = String(value);
  if (!/^-?\d+$/.test(result) || result === '0' || (positive && result.startsWith('-'))) return;
  return result;
}

function finiteSize(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : undefined;
}

function accountSlot(): number {
  const value = Number(new URL(window.location.href).searchParams.get('account') ?? '1');
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 1;
}

function getMessage(runtime: WebKWindow, target: Target): unknown {
  return runtime.apiManagerProxy?.getMessageByPeer(Number(target.peer), Number(target.mid));
}

function getAttachment(message: unknown, index: number): Data | undefined {
  const envelope = data(message);
  if (envelope?._ !== 'message' || !data(envelope.media)) return;
  let media = data(envelope.media)!;
  if (finiteSize(media.ttl_seconds) || envelope.ephemeral_id) return;
  if (media.extended_media) {
    const entries = Array.isArray(media.extended_media)
      ? media.extended_media
      : [media.extended_media];
    media = data(data(entries[index])?.media) ?? {};
  } else if (index !== 0) {
    return;
  }
  // Link previews and avatars are deliberately outside the message attachment scope.
  const attachment = data(media.document) ?? data(media.photo);
  return attachment?._ === 'document' || attachment?._ === 'photo' ? attachment : undefined;
}

function identifyKind(document: Data): MediaKind {
  const attributes = Array.isArray(document.attributes)
    ? document.attributes.map(data).filter(Boolean)
    : [];
  const audio = attributes.find((attribute) => attribute?._ === 'documentAttributeAudio');
  const video = attributes.find((attribute) => attribute?._ === 'documentAttributeVideo');
  if (
    document.type === 'sticker' ||
    attributes.some((attribute) => attribute?._ === 'documentAttributeSticker')
  )
    return 'sticker';
  if (document.type === 'voice' || data(audio?.pFlags)?.voice || audio?.voice) return 'voice';
  if (document.type === 'round' || data(video?.pFlags)?.round_message || video?.round_message)
    return 'round-video';
  if (
    document.type === 'gif' ||
    attributes.some((attribute) => attribute?._ === 'documentAttributeAnimated')
  )
    return 'animation';
  if (audio || document.type === 'audio') return 'audio';
  if (video || document.type === 'video') return 'video';
  return 'document';
}

function fileName(media: Data, kind: MediaKind, mime: string, variant = ''): string {
  const attribute = Array.isArray(media.attributes)
    ? media.attributes.map(data).find((item) => item?._ === 'documentAttributeFilename')
    : undefined;
  const provided = typeof media.file_name === 'string' ? media.file_name : attribute?.file_name;
  if (typeof provided === 'string' && provided.trim()) return provided;
  const extension = EXTENSIONS[mime];
  return `${kind}_${String(media.id)}${variant ? `_${variant}` : ''}${extension ? `.${extension}` : ''}`;
}

function selectMedia(media: Data): Selection {
  const id = decimal(media.id, true);
  const dcId = finiteSize(media.dc_id);
  if (!id || !dcId || media.access_hash === undefined || !media.file_reference) {
    throw new DownloadError('source_unavailable');
  }
  const location: FileLocation = {
    _: media._ === 'photo' ? 'inputPhotoFileLocation' : 'inputDocumentFileLocation',
    id: media.id,
    access_hash: media.access_hash,
    file_reference: media.file_reference,
    thumb_size: '',
  };
  if (media._ === 'photo') {
    const sizes = Array.isArray(media.sizes)
      ? media.sizes.map(data).filter((size): size is Data => !!size)
      : [];
    const candidates = sizes.filter(
      (size) =>
        (size._ === 'photoSize' || size._ === 'photoSizeProgressive') &&
        typeof size.type === 'string' &&
        finiteSize(size.w) &&
        finiteSize(size.h),
    );
    const getSize = (size: Data) =>
      finiteSize(size.size) ??
      (Array.isArray(size.sizes)
        ? finiteSize(Math.max(0, ...size.sizes.map((entry) => finiteSize(entry) ?? 0)))
        : undefined);
    candidates.sort(
      (a, b) =>
        Number(b.w) * Number(b.h) - Number(a.w) * Number(a.h) ||
        (getSize(b) ?? 0) - (getSize(a) ?? 0),
    );
    const best = candidates[0];
    if (!best) throw new DownloadError('source_unavailable');
    location.thumb_size = best.type as string;
    return {
      media,
      location,
      dcId,
      variant: location.thumb_size,
      size: getSize(best),
      kind: 'photo',
      mime: 'image/jpeg',
      filename: fileName(media, 'photo', 'image/jpeg', location.thumb_size),
    };
  }
  const kind = identifyKind(media);
  const mime =
    typeof media.mime_type === 'string' && media.mime_type
      ? media.mime_type
      : 'application/octet-stream';
  return {
    media,
    location,
    dcId,
    variant: 'original',
    size: finiteSize(media.size),
    kind,
    mime,
    filename: fileName(media, kind, mime),
  };
}

function bytesFrom(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (
    Array.isArray(value) &&
    value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  )
    return Uint8Array.from(value);
  throw new DownloadError('invalid_response');
}

function waitForPart(promise: Promise<unknown>, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onAbort = () => finish(() => reject(new DownloadError('cancelled')));
    const timer = window.setTimeout(
      () => finish(() => reject(new DownloadError('timeout', 'timeout', true))),
      PART_TIMEOUT_MS,
    );
    const finish = (callback: () => void) => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    promise.then(
      (result) => finish(() => resolve(result)),
      (error: unknown) =>
        finish(() => {
          if (error instanceof DownloadError) reject(error);
          else
            reject(
              new DownloadError('network_error', 'Telegram could not read the file part.', true),
            );
        }),
    );
  });
}

function sourceUrl(target: Target, message: Data, slot: number): string | undefined {
  const serverId = decimal(message.id, true);
  if (!serverId) return;
  return `https://web.telegram.org/k/?account=${slot}#${target.peer}?message=${serverId}`;
}

function identityPeer(target: Target, message: Data): string {
  const peer = data(message.peer_id);
  if (peer?._ !== 'peerChannel') return target.peer;
  const channelId = decimal(peer.channel_id, true);
  if (!channelId || String(-BigInt(channelId)) !== target.peer)
    throw new DownloadError('ambiguous_media');
  return String(-1_000_000_000_000n - BigInt(channelId));
}

export function createWebKAdapter(): MediaAdapter {
  const runtime = window as WebKWindow;
  let disposed = false;

  const resolve = async (
    target: Target,
    slot: number,
    expectedAccount?: string,
    expectedMedia?: string,
  ): Promise<ResolvedMedia> => {
    if (disposed || accountSlot() !== slot) throw new DownloadError('account_changed');
    if (
      !runtime.rootScope?.managers ||
      !runtime.apiManagerProxy ||
      typeof runtime.createProxiedManagersForAccount !== 'function'
    ) {
      throw new DownloadError('unsupported_client');
    }
    const managers = runtime.createProxiedManagersForAccount(slot);
    const self = data(await managers.appUsersManager.getSelf());
    const accountId = decimal(self?.id, true);
    if (!accountId) throw new DownloadError('source_unavailable');
    if (
      (expectedAccount && expectedAccount !== accountId) ||
      (decimal(runtime.rootScope.myId, true) && decimal(runtime.rootScope.myId, true) !== accountId)
    ) {
      throw new DownloadError('account_changed');
    }
    const message = data(
      getMessage(runtime, target) ??
        target.message ??
        (await managers.appMessagesManager.getMessageByPeer(
          Number(target.peer),
          Number(target.mid),
        )),
    );
    if (
      !message ||
      (message.peerId !== undefined && decimal(message.peerId) !== target.peer) ||
      (message.mid !== undefined && String(message.mid) !== target.mid)
    ) {
      throw new DownloadError('ambiguous_media');
    }
    const media = getAttachment(message, target.index);
    if (!media) throw new DownloadError('source_unavailable');
    if (expectedMedia && decimal(media.id, true) !== expectedMedia)
      throw new DownloadError('ambiguous_media');
    const selected = selectMedia(media);
    const mediaId = decimal(media.id, true)!;
    const info: MediaInfo = {
      identity: {
        client: 'k',
        accountId,
        peerId: identityPeer(target, message),
        messageId: decimal(message.id, true) ?? target.mid,
        mediaId,
        variant: 'original',
      },
      kind: selected.kind,
      filename: selected.filename,
      mimeType: selected.mime,
      byteSize: selected.size,
      sourceUrl: sourceUrl(target, message, slot),
    };
    let sourceDisposed = false;
    let reading = false;
    const validate = async () => {
      if (disposed || sourceDisposed) throw new DownloadError('source_unavailable');
      if (accountSlot() !== slot || decimal(runtime.rootScope?.myId, true) !== accountId)
        throw new DownloadError('account_changed');
      const activeSelf = data(await managers.appUsersManager.getSelf());
      if (decimal(activeSelf?.id, true) !== accountId) throw new DownloadError('account_changed');
      const current = getMessage(runtime, target);
      if (current && decimal(getAttachment(current, target.index)?.id, true) !== mediaId)
        throw new DownloadError('ambiguous_media');
    };
    return {
      info,
      validate,
      async read(offset, length, signal) {
        throwIfAborted(signal);
        if (reading)
          throw new DownloadError('invalid_response', 'A file part is already being read.');
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          offset % 4096 ||
          !Number.isInteger(length) ||
          length <= 0 ||
          length > MAX_PART_SIZE
        ) {
          throw new DownloadError('invalid_response', 'Invalid file part range.');
        }
        reading = true;
        let pending: Promise<unknown> | undefined;
        try {
          await validate();
          throwIfAborted(signal);
          if (selected.size !== undefined && offset >= selected.size) {
            if (offset !== selected.size) throw new DownloadError('invalid_response');
            return { bytes: new Uint8Array(), totalSize: selected.size, done: true };
          }
          let requestLimit = 4096;
          while (requestLimit < length) requestLimit *= 2;
          pending = Promise.resolve(
            managers.apiFileManager.requestFilePart({
              dcId: selected.dcId,
              location: selected.location,
              offset,
              limit: requestLimit,
              floodMaxTimeout: 30,
            }),
          );
          void pending.then(
            () => {
              reading = false;
            },
            () => {
              reading = false;
            },
          );
          const result = data(await waitForPart(pending, signal));
          throwIfAborted(signal);
          if (disposed || sourceDisposed) throw new DownloadError('source_unavailable');
          if (accountSlot() !== slot || decimal(runtime.rootScope?.myId, true) !== accountId)
            throw new DownloadError('account_changed');
          if (!result || result._ !== 'upload.file') throw new DownloadError('invalid_response');
          const bytes = bytesFrom(result.bytes);
          const expected =
            selected.size === undefined ? undefined : Math.min(length, selected.size - offset);
          if (
            bytes.byteLength > length ||
            (expected !== undefined && bytes.byteLength !== expected)
          )
            throw new DownloadError('invalid_response', 'The file part has an unexpected length.');
          return {
            bytes,
            totalSize: selected.size,
            done:
              selected.size === undefined
                ? bytes.byteLength < length
                : offset + bytes.byteLength === selected.size,
          };
        } finally {
          if (!pending) reading = false;
        }
      },
      dispose() {
        sourceDisposed = true;
      },
    };
  };

  return {
    client: 'k',
    discover() {
      if (disposed || !window.location.pathname.startsWith('/k/')) return [];
      const slot = accountSlot();
      const account = decimal(runtime.rootScope?.myId, true);
      const candidates: MediaCandidate[] = [];
      const add = (target: Target, anchor: HTMLElement, viewer = false) => {
        if (
          !Number.isSafeInteger(Number(target.peer)) ||
          !Number.isSafeInteger(Number(target.mid)) ||
          Number(target.mid) <= 0
        )
          return;
        const message = getMessage(runtime, target) ?? target.message;
        const media = getAttachment(message, target.index);
        if (!media) return;
        const mediaId = decimal(media.id, true);
        if (!mediaId) return;
        candidates.push({
          key: [
            'k',
            slot,
            account ?? '',
            target.peer,
            target.mid,
            target.index,
            mediaId,
            viewer ? 'viewer' : 'message',
          ].join(':'),
          anchor,
          resolve: () => resolve(target, slot, account, mediaId),
        });
      };
      document
        .querySelectorAll<HTMLElement>('.bubble[data-peer-id][data-mid]')
        .forEach((bubble) => {
          const peer = decimal(bubble.dataset.peerId);
          if (!peer) return;
          const itemSelector =
            '.grouped-item[data-mid], .document-container[data-mid], .album-item[data-index]';
          const items = [...bubble.querySelectorAll<HTMLElement>(itemSelector)].filter(
            (element) => !element.parentElement?.closest(itemSelector),
          );
          for (const item of items.length ? items : [bubble]) {
            const mid = decimal(item.dataset.mid ?? bubble.dataset.mid, true);
            const index = Number(item.dataset.index ?? '0');
            if (!mid || !Number.isInteger(index) || index < 0) continue;
            add({ peer, mid, index }, item);
          }
        });
      const viewer = runtime.appMediaViewer;
      const viewerTarget = viewer?.target;
      const viewerAnchor =
        viewer?.wholeDiv?.querySelector<HTMLElement>('.media-viewer-buttons') ??
        document.querySelector<HTMLElement>('.media-viewer-whole.active .media-viewer-buttons');
      const peer = decimal(viewerTarget?.peerId);
      const mid = decimal(viewerTarget?.mid, true);
      if (peer && mid && viewerAnchor && viewerAnchor.isConnected) {
        const index = viewerTarget?.index === -1 ? 0 : (viewerTarget?.index ?? 0);
        if (Number.isInteger(index) && index >= 0)
          add({ peer, mid, index, message: viewerTarget?.message }, viewerAnchor, true);
      }
      return candidates;
    },
    dispose() {
      disposed = true;
    },
  };
}
