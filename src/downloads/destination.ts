import { DownloadError } from '../domain/errors';
import type { MediaInfo } from '../domain/media';
import { safeFilename } from '../naming';

export interface DirectoryOptions {
  naming: 'original' | 'message' | 'numbered';
  collision: 'keep-both' | 'skip' | 'overwrite';
  index: number;
}

export interface DirectoryDestination {
  handle: FileSystemFileHandle;
  filename: string;
}

type PermissionDirectory = FileSystemDirectoryHandle & {
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
};

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DownloadError('cancelled');
}

function operation<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal);
  if (!signal) return work();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DownloadError('cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    const cleanup = () => signal.removeEventListener('abort', abort);
    try {
      work().then(
        (result) => {
          cleanup();
          if (signal.aborted) reject(new DownloadError('cancelled'));
          else resolve(result);
        },
        (error: unknown) => {
          cleanup();
          reject(signal.aborted ? new DownloadError('cancelled') : error);
        },
      );
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export function directoryFilename(
  info: MediaInfo,
  options: Pick<DirectoryOptions, 'naming' | 'index'>,
): string {
  if (
    !['original', 'message', 'numbered'].includes(options.naming) ||
    !Number.isSafeInteger(options.index) ||
    options.index < 1
  )
    throw new DownloadError('disk_error');
  const messageId = safeFilename({
    filename: info.identity.messageId || 'unknown',
    kind: 'document',
    mimeType: 'application/octet-stream',
    identity: { ...info.identity, messageId: 'unknown' },
  });
  const safeInfo = { ...info, identity: { ...info.identity, messageId } };
  const original = safeFilename(safeInfo);
  const prefix =
    options.naming === 'message'
      ? `${messageId}_`
      : options.naming === 'numbered'
        ? `${String(options.index).padStart(3, '0')}_`
        : '';
  return safeFilename({ ...safeInfo, filename: prefix + original });
}

function collisionName(original: string, index: number): string {
  if (!index) return original;
  const extension = /\.[a-z0-9]{1,12}$/i.exec(original)?.[0] ?? '';
  const stem = extension ? original.slice(0, -extension.length) : original;
  const suffix = ` (${index})${extension}`;
  const encoder = new TextEncoder();
  const budget = 180 - encoder.encode(suffix).length;
  let bytes = 0;
  let shortened = '';
  for (const character of stem) {
    bytes += encoder.encode(character).length;
    if (bytes > budget) break;
    shortened += character;
  }
  return shortened + suffix;
}

function namedError(error: unknown, name: string): boolean {
  return error instanceof DOMException && error.name === name;
}

export async function resolveDirectoryDestination(
  dir: FileSystemDirectoryHandle,
  info: MediaInfo,
  options: DirectoryOptions,
  signal?: AbortSignal,
): Promise<DirectoryDestination | undefined> {
  try {
    checkAbort(signal);
    if (!['keep-both', 'skip', 'overwrite'].includes(options.collision))
      throw new DownloadError('disk_error');
    const original = directoryFilename(info, options);
    const permissionDir = dir as PermissionDirectory;
    if (
      permissionDir.queryPermission &&
      (await operation(() => permissionDir.queryPermission!({ mode: 'readwrite' }), signal)) !==
        'granted'
    )
      throw new DownloadError('disk_error');

    for (let index = 0; Number.isSafeInteger(index); index++) {
      checkAbort(signal);
      const filename = collisionName(original, index);
      let existing: FileSystemFileHandle | 'directory' | undefined;
      try {
        existing = await operation(() => dir.getFileHandle(filename), signal);
      } catch (error) {
        if (namedError(error, 'TypeMismatchError')) existing = 'directory';
        else if (!namedError(error, 'NotFoundError')) throw error;
      }
      if (existing) {
        if (options.collision === 'skip') return undefined;
        if (options.collision === 'keep-both') continue;
        if (existing === 'directory') throw new DownloadError('disk_error');
        return { handle: existing, filename };
      }
      try {
        const handle = await operation(() => dir.getFileHandle(filename, { create: true }), signal);
        return { handle, filename };
      } catch (error) {
        // A directory can appear between the lookup and creation; never replace it.
        if (namedError(error, 'TypeMismatchError')) {
          if (options.collision === 'skip') return undefined;
          if (options.collision === 'keep-both') continue;
        }
        throw error;
      }
    }
    throw new DownloadError('disk_error');
  } catch (error) {
    checkAbort(signal);
    if (error instanceof DownloadError) throw error;
    if (namedError(error, 'AbortError')) throw new DownloadError('cancelled');
    throw new DownloadError('disk_error');
  }
}
