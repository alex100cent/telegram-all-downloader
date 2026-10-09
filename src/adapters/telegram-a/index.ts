import { DownloadError, throwIfAborted } from '../../domain/errors';
import type { MediaAdapter, MediaCandidate, ReadResult, ResolvedMedia } from '../../domain/media';
import {
  extractMessageMedia,
  id,
  isChannel,
  mediaIdFromUrl,
  mediaInfo,
  messageAddress,
  object,
  type JsonObject,
  type MessageMedia,
} from './model';
import { accountSlot, currentUser, WebAProtocol } from './protocol';
import { messageMetadata, patchMetadata, removed } from './metadata';
import { observeMediaCache } from './cache';

const PHOTO_LIMIT = 32 * 1024 * 1024;
const CHUNK_LIMIT = 512 * 1024;
const METADATA_LIMIT = 1500;
type Chat = { id: string; accessHash?: string };

function hasMessageAttachment(element: HTMLElement): boolean {
  return [
    ...element.querySelectorAll('.media-inner, .Photo, .Video, .Audio, .Document, .Sticker'),
  ].some(
    (media) =>
      media.closest('.Message[data-message-id]') === element &&
      !media.closest('.WebPage, .EmbeddedMessage'),
  );
}

export function createWebAAdapter(): MediaAdapter {
  return new WebAAdapter();
}

class WebAAdapter implements MediaAdapter {
  readonly client = 'a' as const;
  private readonly slot = accountSlot(location.href);
  private readonly protocol: WebAProtocol;
  private readonly messages = new Map<string, MessageMedia>();
  private readonly snapshots = new Map<string, JsonObject>();
  private readonly revisions = new Map<string, number>();
  private readonly chats = new Map<string, Chat>();
  private readonly blobMedia = new WeakMap<Blob, string>();
  private readonly blobUrls = new Map<string, string>();
  private readonly originalCreateUrl = URL.createObjectURL;
  private readonly originalRevokeUrl = URL.revokeObjectURL;
  private readonly createUrl: typeof URL.createObjectURL;
  private readonly revokeUrl: typeof URL.revokeObjectURL;
  private readonly stopCacheObserver: () => void;
  private userId?: string;
  private generation = 0;
  private disposed = false;

  constructor() {
    this.protocol = new WebAProtocol(
      {
        data: (data) => this.ingest(data),
        state: (data, isPatch) => this.ingestState(data, isPatch),
        outgoing: (payload) => {
          if (!Array.isArray(payload.args)) return;
          this.rememberChat(object(payload.args[0])?.chat);
        },
        reset: () => this.reset(),
        blob: (blob, url) => {
          const mediaId = mediaIdFromUrl(url);
          if (mediaId) this.blobMedia.set(blob, mediaId);
        },
      },
      this.slot,
    );
    this.createUrl = (blob) => {
      const url = this.originalCreateUrl.call(URL, blob);
      const mediaId = blob instanceof Blob && this.blobMedia.get(blob);
      if (mediaId) {
        this.blobUrls.set(url, mediaId);
        this.trim(this.blobUrls);
      }
      return url;
    };
    this.revokeUrl = (url) => {
      this.blobUrls.delete(url);
      this.originalRevokeUrl.call(URL, url);
    };
    URL.createObjectURL = this.createUrl;
    URL.revokeObjectURL = this.revokeUrl;
    this.stopCacheObserver = observeMediaCache((blob, mediaId) => {
      if (!this.disposed) this.blobMedia.set(blob, mediaId);
    });
  }

  private reset(): void {
    this.generation++;
    this.userId = undefined;
    this.messages.clear();
    this.snapshots.clear();
    this.revisions.clear();
    this.chats.clear();
    this.blobUrls.clear();
  }

  private trim<T>(map: Map<string, T>): void {
    while (map.size > METADATA_LIMIT) map.delete(map.keys().next().value!);
  }

  private rememberChat(value: unknown): void {
    const chat = object(value);
    const peerId = id(chat?.id);
    if (!chat || !peerId) return;
    const accessHash = id(chat.accessHash);
    const previous = this.chats.get(peerId);
    this.chats.set(peerId, { id: peerId, accessHash: accessHash ?? previous?.accessHash });
    this.trim(this.chats);
  }

  private rememberMessage(value: unknown): void {
    const data = messageMetadata(value);
    const peerId = id(data?.chatId);
    const messageId = id(data?.id);
    if (!data || !peerId || !messageId) return;
    const key = `${peerId}:${messageId}`;
    const media = extractMessageMedia(value);
    const changed = JSON.stringify(this.snapshots.get(key)) !== JSON.stringify(data);
    this.snapshots.set(key, data);
    this.trim(this.snapshots);
    this.replaceMedia(key, media, changed);
  }

  private replaceMedia(key: string, media?: MessageMedia, invalidate = false): void {
    const previous = this.messages.get(key);
    if (invalidate || JSON.stringify(previous) !== JSON.stringify(media)) {
      this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
      this.trim(this.revisions);
    }
    if (media) {
      this.messages.set(key, media);
      this.trim(this.messages);
    } else this.messages.delete(key);
  }

  private forgetMessages(peerId?: string): void {
    for (const key of new Set([
      ...this.snapshots.keys(),
      ...this.messages.keys(),
      ...this.revisions.keys(),
    ])) {
      if (peerId && !key.startsWith(`${peerId}:`)) continue;
      this.snapshots.delete(key);
      this.replaceMedia(key, undefined, true);
    }
  }

  private ingestState(data: JsonObject, isPatch: boolean): void {
    if (
      ('currentUserId' in data && !id(data.currentUserId)) ||
      (!isPatch && !id(data.currentUserId))
    ) {
      this.reset();
      return;
    }
    const nextUser = currentUser(data);
    if (nextUser) {
      if (this.userId && this.userId !== nextUser) this.reset();
      this.userId = nextUser;
    }
    if (!isPatch) this.chats.clear();
    const seen = new Set<string>();
    const chats = object(data.chats);
    const chatMap = object(chats?.byId);
    if (removed(chats) || removed(chatMap)) this.chats.clear();
    else if (chatMap) {
      for (const [peerId, value] of Object.entries(chatMap)) {
        if (removed(value)) this.chats.delete(peerId);
        else {
          const chat = object(value);
          if (chat && id(peerId)) {
            if ('accessHash' in chat && !id(chat.accessHash)) this.chats.delete(peerId);
            this.rememberChat({ ...chat, id: peerId });
          }
        }
      }
    }
    const messages = object(data.messages);
    const byChat = object(messages?.byChatId);
    if (removed(messages) || removed(byChat)) {
      this.forgetMessages();
      return;
    }
    if (!byChat) {
      if (!isPatch) this.forgetMessages();
      return;
    }
    for (const [peerId, value] of Object.entries(byChat)) {
      if (!id(peerId)) continue;
      const chat = object(value);
      const byId = object(chat?.byId);
      if (removed(chat) || removed(byId)) {
        this.forgetMessages(peerId);
        continue;
      }
      if (!byId) continue;
      for (const [messageId, patch] of Object.entries(byId)) {
        if (!id(messageId)) continue;
        const key = `${peerId}:${messageId}`;
        seen.add(key);
        if (removed(patch)) {
          this.snapshots.delete(key);
          this.replaceMedia(key, undefined, true);
          continue;
        }
        const selected = messageMetadata(patch);
        if (!selected) continue;
        const merged = patchMetadata(isPatch ? this.snapshots.get(key) : undefined, selected);
        this.rememberMessage({ ...merged, id: Number(messageId), chatId: peerId });
      }
    }
    if (!isPatch) {
      for (const key of new Set([
        ...this.snapshots.keys(),
        ...this.messages.keys(),
        ...this.revisions.keys(),
      ])) {
        if (!seen.has(key)) {
          this.snapshots.delete(key);
          this.replaceMedia(key, undefined, true);
        }
      }
    }
  }

  private ingest(data: JsonObject): void {
    const nextUser = currentUser(data);
    if (nextUser) {
      if (this.userId && this.userId !== nextUser) this.reset();
      this.userId = nextUser;
    }
    if (
      data['@type'] === 'updateAuthorizationState' &&
      data.authorizationState !== 'authorizationStateReady'
    ) {
      this.reset();
      return;
    }
    const peerId = id(data.chatId);
    const messageId = id(data.id);
    if (data['@type'] === 'updateMessage' && data.isFull !== true && peerId && messageId) {
      const patch = messageMetadata(data.message);
      if (patch)
        this.rememberMessage({
          ...patchMetadata(this.snapshots.get(`${peerId}:${messageId}`), patch),
          id: Number(messageId),
          chatId: peerId,
        });
    } else this.rememberMessage(data.message);
    this.rememberChat(data.chat);
    if (Array.isArray(data.messages))
      data.messages.forEach((message) => this.rememberMessage(message));
    if (Array.isArray(data.chats)) data.chats.forEach((chat) => this.rememberChat(chat));
    if (data['@type'] === 'deleteMessages' && Array.isArray(data.ids)) {
      const peerId = id(data.chatId);
      for (const messageId of data.ids) {
        const selectedId = id(messageId);
        if (!selectedId) continue;
        const keys = peerId
          ? [`${peerId}:${selectedId}`]
          : new Set([...this.snapshots.keys(), ...this.messages.keys(), ...this.revisions.keys()]);
        for (const key of keys) {
          if (key.endsWith(`:${selectedId}`)) {
            this.snapshots.delete(key);
            this.replaceMedia(key, undefined, true);
          }
        }
      }
    }
  }

  discover(): MediaCandidate[] {
    if (this.disposed || !this.userId) return [];
    const result: MediaCandidate[] = [];
    const found = new Set<string>();
    for (const element of document.querySelectorAll<HTMLElement>(
      '#MiddleColumn .Message[data-message-id], #MiddleColumn [id^="album-media-message-"]',
    )) {
      if (element.querySelector('[id^="album-media-message-"]')) continue;
      const address = messageAddress(element);
      if (!address) continue;
      const { peerId, messageId } = address;
      if (object(this.snapshots.get(`${peerId}:${messageId}`)?.content)?.ttlSeconds !== undefined)
        continue;
      if (
        !this.messages.has(`${peerId}:${messageId}`) &&
        !element.matches('[id^="album-media-message-"]') &&
        !hasMessageAttachment(element)
      )
        continue;
      const selected = this.messages.get(`${peerId}:${messageId}`);
      const key = `a:${this.slot}:${this.userId}:${peerId}:${messageId}:${selected?.mediaId ?? 'unresolved'}:${this.revisions.get(`${peerId}:${messageId}`) ?? 0}`;
      if (found.has(key)) continue;
      found.add(key);
      result.push(this.candidate(key, element, peerId, messageId));
    }
    const viewer = document.querySelector<HTMLElement>(
      '#MediaViewer[open] .MediaViewerSlide--active',
    );
    if (viewer) {
      const mediaIds = new Set<string>();
      for (const element of viewer.querySelectorAll<HTMLImageElement | HTMLVideoElement>(
        'img[src],video[src]',
      )) {
        const mediaId = this.blobUrls.get(element.src) ?? mediaIdFromUrl(element.src);
        if (mediaId) mediaIds.add(mediaId);
      }
      if (mediaIds.size === 1) {
        const mediaId = [...mediaIds][0];
        const matches = [...this.messages.values()].filter((media) => media.mediaId === mediaId);
        if (matches.length === 1) {
          const media = matches[0]!;
          result.push(
            this.candidate(
              `a:viewer:${this.slot}:${this.userId}:${media.peerId}:${media.messageId}:${media.mediaId}:${this.revisions.get(`${media.peerId}:${media.messageId}`) ?? 0}`,
              viewer,
              media.peerId,
              media.messageId,
            ),
          );
        }
      }
    }
    return result;
  }

  private candidate(
    key: string,
    anchor: HTMLElement,
    peerId: string,
    messageId: string,
  ): MediaCandidate {
    const generation = this.generation;
    const userId = this.userId!;
    return { key, anchor, resolve: () => this.resolve(peerId, messageId, userId, generation) };
  }

  private assertAccount(userId: string, generation: number): void {
    if (
      this.disposed ||
      this.userId !== userId ||
      this.generation !== generation ||
      accountSlot(location.href) !== this.slot
    ) {
      throw new DownloadError(
        'account_changed',
        'The Telegram account changed. Select the file again.',
      );
    }
  }

  private async resolve(
    peerId: string,
    messageId: string,
    userId: string,
    generation: number,
  ): Promise<ResolvedMedia> {
    const validate = async () => this.assertAccount(userId, generation);
    await validate();
    const key = `${peerId}:${messageId}`;
    let media = this.messages.get(key);
    let chat = this.chats.get(peerId);
    if (chat && (!isChannel(peerId) || chat.accessHash)) {
      let refreshedSuccessfully = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        const beforeRequest = this.revisions.get(key) ?? 0;
        const result = object(
          await this.protocol.request('fetchMessage', [{ chat, messageId: Number(messageId) }]),
        );
        this.assertAccount(userId, generation);
        if ((this.revisions.get(key) ?? 0) !== beforeRequest) continue;
        const refreshed = extractMessageMedia(result?.message);
        if (!refreshed || refreshed.peerId !== peerId || refreshed.messageId !== messageId) break;
        media = refreshed;
        this.rememberMessage(result?.message);
        refreshedSuccessfully = true;
        break;
      }
      if (!refreshedSuccessfully) {
        throw new DownloadError(
          'source_unavailable',
          'This message no longer contains an available attachment.',
          true,
        );
      }
    }
    if (!media)
      throw new DownloadError(
        'source_unavailable',
        'Reopen this chat to load its attachment details.',
        true,
      );
    const selected = media;
    const signature = JSON.stringify(selected);
    let revision = this.revisions.get(key) ?? 0;
    const validateSelection = async (signal?: AbortSignal) => {
      if (signal) throwIfAborted(signal);
      await validate();
      const current = this.messages.get(key);
      if (JSON.stringify(current) === signature && (this.revisions.get(key) ?? 0) === revision)
        return;
      const currentChat = this.chats.get(peerId);
      if (currentChat && (!isChannel(peerId) || currentChat.accessHash)) chat = currentChat;
      if (chat && (!isChannel(peerId) || chat.accessHash)) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const beforeRequest = this.revisions.get(key) ?? 0;
          const result = object(
            await this.protocol.request(
              'fetchMessage',
              [{ chat, messageId: Number(messageId) }],
              signal,
            ),
          );
          this.assertAccount(userId, generation);
          // A later update must not be overwritten by an earlier RPC response.
          if ((this.revisions.get(key) ?? 0) !== beforeRequest) continue;
          const refreshed = extractMessageMedia(result?.message);
          if (JSON.stringify(refreshed) !== signature) break;
          this.rememberMessage(result?.message);
          revision = this.revisions.get(key) ?? 0;
          return;
        }
      }
      throw new DownloadError(
        'source_unavailable',
        'The attachment changed or was removed. Select it again.',
      );
    };
    const info = mediaInfo(selected, userId);
    const sourceUrl = new URL(info.sourceUrl!);
    if (this.slot > 1) sourceUrl.searchParams.set('account', String(this.slot));
    info.sourceUrl = sourceUrl.href;
    let photo: Uint8Array | undefined;
    let disposed = false;
    let reading = false;
    const read = async (
      offset: number,
      length: number,
      signal: AbortSignal,
    ): Promise<ReadResult> => {
      throwIfAborted(signal);
      this.assertAccount(userId, generation);
      await validateSelection(signal);
      if (disposed) throw new DownloadError('source_unavailable');
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(length) ||
        length <= 0 ||
        length > CHUNK_LIMIT
      ) {
        throw new DownloadError('invalid_response', 'Invalid media range.');
      }
      if (photo) {
        const bytes = photo.slice(offset, offset + length);
        return {
          bytes,
          totalSize: photo.byteLength,
          done: offset + bytes.byteLength === photo.byteLength,
        };
      }
      const response = object(
        await this.protocol.request(
          'downloadMedia',
          [
            {
              url: selected.url,
              mediaFormat: 1,
              start: offset,
              end: offset + length - 1,
            },
          ],
          signal,
        ),
      );
      throwIfAborted(signal);
      await validateSelection(signal);
      if (disposed) throw new DownloadError('cancelled');
      if (!(response?.arrayBuffer instanceof ArrayBuffer)) {
        throw new DownloadError(
          'source_unavailable',
          'Telegram did not return the selected attachment.',
          true,
        );
      }
      const bytes = new Uint8Array(response.arrayBuffer);
      if (selected.kind === 'photo') {
        if (offset !== 0 || !bytes.byteLength) throw new DownloadError('invalid_response');
        if (bytes.byteLength > PHOTO_LIMIT)
          throw new DownloadError('file_too_large', 'This photo exceeds the 32 MiB photo limit.');
        photo = bytes;
        info.byteSize = bytes.byteLength;
        return {
          bytes: bytes.slice(0, length),
          totalSize: bytes.byteLength,
          done: bytes.byteLength <= length,
        };
      }
      const totalSize = response.fullSize;
      if (
        typeof totalSize !== 'number' ||
        !Number.isSafeInteger(totalSize) ||
        totalSize <= 0 ||
        (selected.byteSize !== undefined && totalSize !== selected.byteSize) ||
        bytes.byteLength !== Math.min(length, totalSize - offset)
      ) {
        throw new DownloadError(
          'invalid_response',
          'Telegram returned an incomplete or inconsistent file range.',
          true,
        );
      }
      if (
        offset === 0 &&
        selected.mimeType === 'application/x-tgsticker' &&
        (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
      ) {
        throw new DownloadError(
          'invalid_response',
          'Telegram returned a non-TGS sticker representation.',
        );
      }
      info.byteSize = totalSize;
      if (typeof response.mimeType === 'string' && response.mimeType)
        info.mimeType = response.mimeType;
      return { bytes, totalSize, done: offset + bytes.byteLength === totalSize };
    };
    return {
      info,
      read: async (offset, length, signal) => {
        if (reading)
          throw new DownloadError('invalid_response', 'Only one file range may be read at a time.');
        reading = true;
        try {
          return await read(offset, length, signal);
        } finally {
          reading = false;
        }
      },
      validate: validateSelection,
      dispose: () => {
        disposed = true;
        photo = undefined;
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    this.protocol.dispose();
    this.stopCacheObserver();
    this.reset();
    if (URL.createObjectURL === this.createUrl) URL.createObjectURL = this.originalCreateUrl;
    if (URL.revokeObjectURL === this.revokeUrl) URL.revokeObjectURL = this.originalRevokeUrl;
  }
}
