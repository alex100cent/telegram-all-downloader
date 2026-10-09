export type TelegramClient = 'a' | 'k';
export type MediaKind =
  'photo' | 'video' | 'audio' | 'voice' | 'round-video' | 'animation' | 'document' | 'sticker';

export interface MediaIdentity {
  client: TelegramClient;
  accountId: string;
  peerId: string;
  messageId: string;
  mediaId: string;
  variant?: string;
}

export interface MediaInfo {
  identity: MediaIdentity;
  kind: MediaKind;
  filename: string;
  mimeType: string;
  byteSize?: number;
  sourceUrl?: string;
}

export interface ReadResult {
  bytes: Uint8Array;
  totalSize?: number;
  done?: boolean;
}

export interface ResolvedMedia {
  info: MediaInfo;
  read(offset: number, length: number, signal: AbortSignal): Promise<ReadResult>;
  validate?(signal?: AbortSignal): Promise<void>;
  dispose?(): void;
}

export interface MediaCandidate {
  key: string;
  anchor: HTMLElement;
  resolve(): Promise<ResolvedMedia>;
}

export interface MediaAdapter {
  readonly client: TelegramClient;
  discover(): MediaCandidate[];
  dispose(): void;
}

export function mediaKey(identity: MediaIdentity): string {
  return JSON.stringify([
    identity.accountId,
    identity.peerId,
    identity.messageId,
    identity.mediaId,
    identity.variant ?? '',
  ]);
}
