import { DownloadError, throwIfAborted } from '../domain/errors';
import type { ResolvedMedia } from '../domain/media';

export const CHUNK_SIZE = 512 * 1024;
export const MAX_PHOTO_BYTES = 32 * 1024 * 1024;
export const MAX_FILE_BYTES = 4 * 1024 ** 3;

export interface FileWriter {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export interface TransferProgress {
  bytes: number;
  total?: number;
  state: 'downloading' | 'finalizing';
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(new DownloadError('cancelled'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}

export async function transferToWriter(
  source: ResolvedMedia,
  writer: FileWriter,
  signal: AbortSignal,
  onProgress: (progress: TransferProgress) => void | Promise<void>,
  retryDelay = 500,
): Promise<number> {
  let offset = 0;
  let total = source.info.byteSize;
  const validateSize = (size: number) => {
    if (!Number.isSafeInteger(size) || size < 0) throw new DownloadError('invalid_response');
    if (size > MAX_FILE_BYTES) throw new DownloadError('file_too_large');
  };
  try {
    if (total !== undefined) validateSize(total);
    while (total === undefined || offset < total) {
      throwIfAborted(signal);
      await source.validate?.();
      const length = total === undefined ? CHUNK_SIZE : Math.min(CHUNK_SIZE, total - offset);
      let result;
      for (let attempt = 0; ; attempt++) {
        try {
          result = await source.read(offset, length, signal);
          break;
        } catch (error) {
          throwIfAborted(signal);
          if (!(error instanceof DownloadError) || !error.retryable || attempt >= 2) throw error;
          await delay(retryDelay * 2 ** attempt, signal);
        }
      }
      throwIfAborted(signal);
      if (result.totalSize !== undefined) {
        validateSize(result.totalSize);
        if (total !== undefined && result.totalSize !== total)
          throw new DownloadError('invalid_response');
        total = result.totalSize;
      }
      const limit = source.info.kind === 'photo' ? MAX_PHOTO_BYTES : CHUNK_SIZE;
      if (!(result.bytes instanceof Uint8Array) || result.bytes.byteLength > limit) {
        throw new DownloadError('invalid_response');
      }
      const end = offset + result.bytes.byteLength;
      validateSize(end);
      if (total !== undefined && end > total) throw new DownloadError('invalid_response');
      if (result.bytes.byteLength === 0 && !result.done)
        throw new DownloadError('invalid_response');
      if (result.done && total !== undefined && end !== total)
        throw new DownloadError('invalid_response');
      if (result.bytes.byteLength > 0) {
        try {
          await writer.write(result.bytes);
        } catch {
          throw new DownloadError('disk_error');
        }
      }
      offset = end;
      await onProgress({ bytes: offset, total, state: 'downloading' });
      if (result.done) break;
    }
    throwIfAborted(signal);
    if (total !== undefined && offset !== total) throw new DownloadError('invalid_response');
    await onProgress({ bytes: offset, total: total ?? offset, state: 'finalizing' });
    throwIfAborted(signal);
    try {
      await writer.close();
    } catch {
      throw new DownloadError('disk_error');
    }
    return offset;
  } catch (error) {
    try {
      await writer.abort();
    } catch {
      // Preserve the failure that interrupted the transfer.
    }
    throwIfAborted(signal);
    throw error;
  } finally {
    source.dispose?.();
  }
}
