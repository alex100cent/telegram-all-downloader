import type { MediaInfo, MediaKind } from '../../domain/media';

export type JsonObject = Record<string, unknown>;

export function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

export function id(value: unknown): string | undefined {
  const result = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return /^-?\d+$/.test(result) ? result : undefined;
}

export interface MessageMedia {
  peerId: string;
  messageId: string;
  mediaId: string;
  kind: MediaKind;
  filename: string;
  mimeType: string;
  byteSize?: number;
  url: string;
}

const types = ['photo', 'video', 'audio', 'voice', 'document', 'sticker'] as const;

export function extractMessageMedia(value: unknown): MessageMedia | undefined {
  const message = object(value);
  const content = object(message?.content);
  const peerId = id(message?.chatId);
  const messageId = id(message?.id);
  if (
    !content ||
    content.ttlSeconds !== undefined ||
    !peerId ||
    !messageId ||
    Number(messageId) <= 0
  )
    return;
  const candidates = types.flatMap((type) => {
    const media = object(content[type]);
    const mediaId = id(media?.id);
    return media && mediaId ? [{ type, media, mediaId }] : [];
  });
  if (candidates.length !== 1) return;
  const { type, media, mediaId } = candidates[0]!;
  const kind: MediaKind =
    type === 'video' ? (media.isRound ? 'round-video' : media.isGif ? 'animation' : 'video') : type;
  const mimeType =
    typeof media.mimeType === 'string'
      ? media.mimeType
      : type === 'photo'
        ? 'image/jpeg'
        : type === 'voice'
          ? 'audio/ogg'
          : type === 'sticker'
            ? media.isLottie
              ? 'application/x-tgsticker'
              : media.isVideo
                ? 'video/webm'
                : 'image/webp'
            : 'application/octet-stream';
  const extension =
    type === 'photo'
      ? 'jpg'
      : type === 'voice'
        ? 'ogg'
        : type === 'sticker'
          ? media.isLottie
            ? 'tgs'
            : media.isVideo
              ? 'webm'
              : 'webp'
          : mimeType === 'video/mp4'
            ? 'mp4'
            : mimeType === 'audio/mpeg'
              ? 'mp3'
              : 'bin';
  const filename =
    typeof media.fileName === 'string' && media.fileName.trim()
      ? media.fileName
      : `telegram-${kind}-${messageId}.${extension}`;
  const byteSize =
    typeof media.size === 'number' && Number.isSafeInteger(media.size) && media.size > 0
      ? media.size
      : undefined;
  return {
    peerId,
    messageId,
    mediaId,
    kind,
    filename,
    mimeType,
    byteSize,
    url: `${type === 'photo' ? 'photo' : 'document'}${mediaId}`,
  };
}

export function mediaInfo(media: MessageMedia, accountId: string): MediaInfo {
  return {
    identity: {
      client: 'a',
      accountId,
      peerId: media.peerId,
      messageId: media.messageId,
      mediaId: media.mediaId,
      variant: 'original',
    },
    kind: media.kind,
    filename: media.filename,
    mimeType: media.mimeType,
    byteSize: media.byteSize,
    sourceUrl: messageSourceUrl(media.peerId, media.messageId),
  };
}

export function isChannel(peerId: string): boolean {
  return Boolean(id(peerId)) && BigInt(peerId) < -1_000_000_000_000n;
}

export function messageSourceUrl(peerId: string, messageId: string): string {
  if (!isChannel(peerId)) return `https://web.telegram.org/a/#${peerId}`;
  const channel = String(-BigInt(peerId) - 1_000_000_000_000n);
  const deepLink = `tg://privatepost?channel=${channel}&post=${messageId}`;
  return `https://web.telegram.org/a/#${peerId}?tgaddr=${encodeURIComponent(deepLink)}`;
}

export function mediaIdFromUrl(url: string): string | undefined {
  return /(?:^|\/)(?:photo|document)(-?\d+)(?:[?&#]|$)/.exec(url)?.[1];
}

export function messageAddress(
  element: HTMLElement,
): { peerId: string; messageId: string } | undefined {
  const listKey = element.closest<HTMLElement>('[data-list-key]')?.dataset.listKey;
  const peerId = listKey && id(listKey.split('_')[0]);
  const albumId = /^album-media-message-(\d+)$/.exec(element.id)?.[1];
  const messageId = albumId ?? id(element.dataset.messageId);
  if (!peerId || !messageId || Number(messageId) <= 0) return;
  return { peerId, messageId };
}
