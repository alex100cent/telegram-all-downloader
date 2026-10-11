import { describe, expect, it, vi } from 'vitest';
import {
  resolveDirectoryDestination,
  directoryFilename,
  type DirectoryOptions,
} from '../src/downloads/destination';
import type { MediaInfo } from '../src/domain/media';
import { safeFilename } from '../src/naming';

const info: MediaInfo = {
  identity: { client: 'a', accountId: '1', peerId: '2', messageId: '42', mediaId: '3' },
  filename: 'report.pdf',
  mimeType: 'application/pdf',
  kind: 'document',
};
const options: DirectoryOptions = {
  naming: 'original',
  collision: 'keep-both',
  index: 1,
};

function fixture(permission: PermissionState | undefined = 'granted') {
  const entries = new Map<string, FileSystemFileHandle | 'directory'>();
  const createWritable = vi.fn();
  const addFile = (name: string) => {
    const handle = { kind: 'file', name, createWritable } as unknown as FileSystemFileHandle;
    entries.set(name, handle);
    return handle;
  };
  const queryPermission = vi.fn(async () => permission);
  const requestPermission = vi.fn();
  const getFileHandle = vi.fn(
    async (name: string, config?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> => {
      const entry = entries.get(name);
      if (entry === 'directory') throw new DOMException('', 'TypeMismatchError');
      if (entry) return entry;
      if (config?.create) return addFile(name);
      throw new DOMException('', 'NotFoundError');
    },
  );
  const dir = {
    kind: 'directory',
    name: 'destination',
    getFileHandle,
    ...(permission === undefined ? {} : { queryPermission }),
    requestPermission,
  } as unknown as FileSystemDirectoryHandle;
  return {
    dir,
    entries,
    addFile,
    createWritable,
    getFileHandle,
    queryPermission,
    requestPermission,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('directory destinations', () => {
  it.each([
    ['original', 1, 'report.pdf'],
    ['message', 1, '42_report.pdf'],
    ['numbered', 1, '001_report.pdf'],
    ['numbered', 1234, '1234_report.pdf'],
  ] as const)('uses %s naming with index %i', async (naming, index, filename) => {
    const fs = fixture();
    const result = await resolveDirectoryDestination(fs.dir, info, { ...options, naming, index });
    expect(result).toEqual({ filename, handle: fs.entries.get(filename) });
    expect(directoryFilename(info, { naming, index })).toBe(filename);
    expect(fs.queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(fs.requestPermission).not.toHaveBeenCalled();
    expect(fs.createWritable).not.toHaveBeenCalled();
  });

  it('retains both files and directories, including occupied suffixes', async () => {
    const fs = fixture();
    const original = fs.addFile('report.pdf');
    fs.entries.set('report (1).pdf', 'directory');
    fs.addFile('report (2).pdf');
    const result = await resolveDirectoryDestination(fs.dir, info, options);
    expect(result?.filename).toBe('report (3).pdf');
    expect(fs.entries.get('report.pdf')).toBe(original);
    expect(fs.entries.get('report (1).pdf')).toBe('directory');
    expect(fs.createWritable).not.toHaveBeenCalled();
  });

  it('allocates different handles when sequential jobs have identical names', async () => {
    const fs = fixture();
    const first = await resolveDirectoryDestination(fs.dir, info, options);
    const second = await resolveDirectoryDestination(fs.dir, info, options);
    expect(first?.filename).toBe('report.pdf');
    expect(second?.filename).toBe('report (1).pdf');
    expect(first?.handle).not.toBe(second?.handle);
  });

  it.each(['file', 'directory'] as const)(
    'skips an existing %s without changing it',
    async (kind) => {
      const fs = fixture();
      if (kind === 'file') fs.addFile('report.pdf');
      else fs.entries.set('report.pdf', 'directory');
      expect(
        await resolveDirectoryDestination(fs.dir, info, { ...options, collision: 'skip' }),
      ).toBeUndefined();
      expect(fs.getFileHandle).toHaveBeenCalledTimes(1);
      expect(fs.createWritable).not.toHaveBeenCalled();
    },
  );

  it('allows overwrite only when requested and does not open a writer', async () => {
    const fs = fixture();
    const original = fs.addFile('report.pdf');
    const result = await resolveDirectoryDestination(fs.dir, info, {
      ...options,
      collision: 'overwrite',
    });
    expect(result).toEqual({ filename: 'report.pdf', handle: original });
    expect(fs.getFileHandle).toHaveBeenCalledTimes(1);
    expect(fs.createWritable).not.toHaveBeenCalled();
  });

  it('rejects overwriting a directory', async () => {
    const fs = fixture();
    fs.entries.set('report.pdf', 'directory');
    await expect(
      resolveDirectoryDestination(fs.dir, info, { ...options, collision: 'overwrite' }),
    ).rejects.toMatchObject({ code: 'disk_error' });
    expect(fs.entries.get('report.pdf')).toBe('directory');
    expect(fs.createWritable).not.toHaveBeenCalled();
  });

  it.each(['keep-both', 'skip', 'overwrite'] as const)(
    'handles a directory appearing during creation with %s',
    async (collision) => {
      const fs = fixture();
      fs.getFileHandle.mockRejectedValueOnce(new DOMException('', 'NotFoundError'));
      fs.entries.set('report.pdf', 'directory');
      const pending = resolveDirectoryDestination(fs.dir, info, { ...options, collision });
      if (collision === 'overwrite')
        await expect(pending).rejects.toMatchObject({ code: 'disk_error' });
      else {
        const result = await pending;
        expect(result?.filename).toBe(collision === 'skip' ? undefined : 'report (1).pdf');
      }
      expect(fs.entries.get('report.pdf')).toBe('directory');
      expect(fs.createWritable).not.toHaveBeenCalled();
    },
  );

  it.each(['original', 'message', 'numbered'] as const)(
    'removes path traversal from %s names and fallback message IDs',
    async (naming) => {
      const fs = fixture();
      const unsafe = {
        ...info,
        filename: '../../CON\\file:bad?.pdf',
        identity: { ...info.identity, messageId: '../../wrong\\folder' },
      };
      const result = await resolveDirectoryDestination(fs.dir, unsafe, { ...options, naming });
      expect(result?.filename).not.toMatch(/[/\\:*?]|\.\./);
      const fallback = await resolveDirectoryDestination(
        fs.dir,
        { ...unsafe, filename: '...' },
        { ...options, naming },
      );
      expect(fallback?.filename).not.toMatch(/[/\\:*?]|\.\./);
      expect(fallback?.filename).toMatch(/\.pdf$/);
    },
  );

  it('keeps UTF-8 names within 180 bytes, with a distinct suffix and complete extension', async () => {
    const fs = fixture();
    const long = { ...info, filename: `${'Подкаст🎵'.repeat(50)}.pdf` };
    const first = await resolveDirectoryDestination(fs.dir, long, options);
    const second = await resolveDirectoryDestination(fs.dir, long, options);
    expect(first?.filename).toBe(safeFilename(long));
    expect(second?.filename).not.toBe(first?.filename);
    expect(second?.filename).toMatch(/ \(1\)\.pdf$/);
    for (const result of [first, second]) {
      expect(new TextEncoder().encode(result!.filename).length).toBeLessThanOrEqual(180);
      expect(result!.filename).not.toContain('\uFFFD');
    }
  });

  it.each(['denied', 'prompt'] as const)(
    'fails when write permission is %s without prompting',
    async (permission) => {
      const fs = fixture(permission);
      await expect(resolveDirectoryDestination(fs.dir, info, options)).rejects.toMatchObject({
        code: 'disk_error',
      });
      expect(fs.requestPermission).not.toHaveBeenCalled();
      expect(fs.getFileHandle).not.toHaveBeenCalled();
    },
  );

  it('supports handles without queryPermission and relies on filesystem permission checks', async () => {
    const fs = fixture();
    delete (fs.dir as FileSystemDirectoryHandle & { queryPermission?: unknown }).queryPermission;
    expect((await resolveDirectoryDestination(fs.dir, info, options))?.filename).toBe('report.pdf');
    fs.getFileHandle.mockRejectedValue(new DOMException('', 'NotAllowedError'));
    await expect(resolveDirectoryDestination(fs.dir, info, options)).rejects.toMatchObject({
      code: 'disk_error',
    });
  });

  it('rechecks permission for each job', async () => {
    const fs = fixture();
    await resolveDirectoryDestination(fs.dir, info, options);
    fs.queryPermission.mockResolvedValue('denied');
    fs.getFileHandle.mockClear();
    await expect(resolveDirectoryDestination(fs.dir, info, options)).rejects.toMatchObject({
      code: 'disk_error',
    });
    expect(fs.getFileHandle).not.toHaveBeenCalled();
  });

  it('cancels before any filesystem or permission call', async () => {
    const fs = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      resolveDirectoryDestination(fs.dir, info, options, controller.signal),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fs.queryPermission).not.toHaveBeenCalled();
    expect(fs.getFileHandle).not.toHaveBeenCalled();
  });

  it('cancels a pending permission check without later allocating a file', async () => {
    const fs = fixture();
    const gate = deferred<PermissionState>();
    fs.queryPermission.mockReturnValueOnce(gate.promise);
    const controller = new AbortController();
    const pending = resolveDirectoryDestination(fs.dir, info, options, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    gate.resolve('granted');
    await Promise.resolve();
    expect(fs.getFileHandle).not.toHaveBeenCalled();
  });

  it('cancels a pending lookup and consumes late failure without creating a file', async () => {
    const fs = fixture();
    const gate = deferred<FileSystemFileHandle>();
    fs.getFileHandle.mockReturnValueOnce(gate.promise);
    const controller = new AbortController();
    const pending = resolveDirectoryDestination(fs.dir, info, options, controller.signal);
    await vi.waitFor(() => expect(fs.getFileHandle).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    gate.reject(new DOMException('', 'NotFoundError'));
    await Promise.resolve();
    expect(fs.getFileHandle).toHaveBeenCalledTimes(1);
    expect(fs.createWritable).not.toHaveBeenCalled();
  });

  it('cancels an in-flight creation without handing its late handle to a writer', async () => {
    const fs = fixture();
    const gate = deferred<FileSystemFileHandle>();
    fs.getFileHandle
      .mockRejectedValueOnce(new DOMException('', 'NotFoundError'))
      .mockReturnValueOnce(gate.promise);
    const controller = new AbortController();
    const pending = resolveDirectoryDestination(fs.dir, info, options, controller.signal);
    await vi.waitFor(() => expect(fs.getFileHandle).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    gate.resolve(fs.addFile('report.pdf'));
    await Promise.resolve();
    expect(fs.getFileHandle).toHaveBeenCalledTimes(2);
    expect(fs.createWritable).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid batch index %s',
    async (index) => {
      const fs = fixture();
      await expect(
        resolveDirectoryDestination(fs.dir, info, { ...options, naming: 'numbered', index }),
      ).rejects.toMatchObject({ code: 'disk_error' });
      expect(fs.getFileHandle).not.toHaveBeenCalled();
    },
  );
});
