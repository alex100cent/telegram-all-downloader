import { describe, expect, it, vi } from 'vitest';
import { CHUNK_SIZE, transferToWriter, type FileWriter } from '../src/downloads/stream';
import { DownloadError } from '../src/domain/errors';
import type { ResolvedMedia } from '../src/domain/media';

const info: ResolvedMedia['info'] = {
  identity: { client: 'a', accountId: '1', peerId: '-1', messageId: '2', mediaId: '3' },
  filename: 'podcast.mp3',
  mimeType: 'audio/mpeg',
  kind: 'audio',
};

function writer(): FileWriter {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
  };
}

describe('streaming transfer', () => {
  it('writes every byte sequentially and awaits the disk before reading another chunk', async () => {
    const data = Uint8Array.from({ length: CHUNK_SIZE + 73 }, (_, i) => i % 251);
    const saved: Uint8Array[] = [];
    let writing = false;
    const sink = writer();
    sink.write = async (bytes) => {
      writing = true;
      await Promise.resolve();
      saved.push(bytes);
      writing = false;
    };
    const source: ResolvedMedia = {
      info: { ...info, byteSize: data.length },
      read: async (offset, length) => {
        expect(writing).toBe(false);
        return { bytes: data.slice(offset, offset + length), totalSize: data.length };
      },
    };
    expect(await transferToWriter(source, sink, new AbortController().signal, () => {})).toBe(
      data.length,
    );
    expect([...saved.flatMap((bytes) => [...bytes])]).toEqual([...data]);
    expect(sink.close).toHaveBeenCalledOnce();
    expect(sink.abort).not.toHaveBeenCalled();
  });

  it('rejects a truncated file instead of reporting completion', async () => {
    const sink = writer();
    const source: ResolvedMedia = {
      info: { ...info, byteSize: 20 },
      read: async () => ({ bytes: new Uint8Array(10), done: true }),
    };
    await expect(
      transferToWriter(source, sink, new AbortController().signal, () => {}),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(sink.close).not.toHaveBeenCalled();
    expect(sink.abort).toHaveBeenCalledOnce();
  });

  it('retries only the failed offset and never writes a chunk twice', async () => {
    let calls = 0;
    const sink = writer();
    const read = vi.fn(async () => {
      if (++calls === 1) throw new DownloadError('network_error', 'offline', true);
      return { bytes: new Uint8Array(10), totalSize: 10 };
    });
    await transferToWriter({ info, read }, sink, new AbortController().signal, () => {}, 0);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[0]).toEqual(read.mock.calls[1]);
    expect(sink.write).toHaveBeenCalledOnce();
  });

  it('aborts the writer when cancelled during a source request', async () => {
    const controller = new AbortController();
    const sink = writer();
    await expect(
      transferToWriter(
        {
          info,
          read: async () => {
            controller.abort();
            return { bytes: new Uint8Array(10), done: true };
          },
        },
        sink,
        controller.signal,
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(sink.write).not.toHaveBeenCalled();
    expect(sink.abort).toHaveBeenCalledOnce();
  });

  it('cancels pending validation and aborts the writer without reading media', async () => {
    const controller = new AbortController();
    const sink = writer();
    const validate = vi.fn<NonNullable<ResolvedMedia['validate']>>(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DownloadError('cancelled')), {
            once: true,
          });
        }),
    );
    const read = vi.fn<ResolvedMedia['read']>();
    const dispose = vi.fn();
    const transfer = transferToWriter(
      { info, validate, read, dispose },
      sink,
      controller.signal,
      () => {},
    );
    expect(validate).toHaveBeenCalledWith(controller.signal);
    controller.abort();
    await expect(transfer).rejects.toMatchObject({ code: 'cancelled' });
    expect(read).not.toHaveBeenCalled();
    expect(sink.write).not.toHaveBeenCalled();
    expect(sink.close).not.toHaveBeenCalled();
    expect(sink.abort).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('does not report success when closing the file fails', async () => {
    const sink = writer();
    sink.close = vi.fn().mockRejectedValue(new Error('disk full'));
    await expect(
      transferToWriter(
        { info, read: async () => ({ bytes: new Uint8Array(10), done: true }) },
        sink,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'disk_error' });
    expect(sink.abort).toHaveBeenCalledOnce();
  });

  it('keeps an accepted cancellation when the pending progress callback rejects', async () => {
    const controller = new AbortController();
    const sink = writer();
    await expect(
      transferToWriter(
        { info, read: async () => ({ bytes: new Uint8Array(10), done: true }) },
        sink,
        controller.signal,
        async () => {
          controller.abort();
          throw new Error('Extension connection lost');
        },
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(sink.close).not.toHaveBeenCalled();
    expect(sink.abort).toHaveBeenCalledOnce();
  });

  it('rejects a changed total size between chunks', async () => {
    const source: ResolvedMedia = {
      info: { ...info, byteSize: 10 },
      read: async () => ({ bytes: new Uint8Array(10), totalSize: 11 }),
    };
    await expect(
      transferToWriter(source, writer(), new AbortController().signal, () => {}),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('streams 1 GiB without retaining the complete file', async () => {
    const size = 1024 ** 3;
    const block = new Uint8Array(CHUNK_SIZE);
    let totalWritten = 0;
    let largestWrite = 0;
    const sink: FileWriter = {
      write: async (data) => {
        totalWritten += data.byteLength;
        largestWrite = Math.max(largestWrite, data.byteLength);
      },
      close: async () => {},
      abort: async () => {},
    };
    const source: ResolvedMedia = {
      info: { ...info, byteSize: size },
      read: async () => ({ bytes: block, totalSize: size }),
    };
    await transferToWriter(source, sink, new AbortController().signal, () => {});
    expect(totalWritten).toBe(size);
    expect(largestWrite).toBe(CHUNK_SIZE);
  });
});
