import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command, CommandReply, PagePayload } from '../src/bridge/protocol';
import { DownloadError } from '../src/domain/errors';
import type { MediaAdapter, MediaCandidate, ResolvedMedia } from '../src/domain/media';
import { startPageController } from '../src/page/controller';

const bridge = vi.hoisted(() => ({
  request: vi.fn<(payload: PagePayload) => Promise<Record<string, unknown>>>(),
  dispose: vi.fn(),
  command: undefined as ((command: Command) => Promise<CommandReply>) | undefined,
}));

vi.mock('../src/bridge/page', () => ({
  PageBridge: class {
    request = bridge.request;
    dispose = bridge.dispose;
    handleCommands(handler: (command: Command) => Promise<CommandReply>) {
      bridge.command = handler;
    }
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function makeSource(id = 'media-1') {
  return {
    info: {
      identity: {
        client: 'a' as const,
        accountId: 'account-1',
        peerId: 'chat-1',
        messageId: '1',
        mediaId: id,
      },
      kind: 'audio' as const,
      filename: 'episode.mp3',
      mimeType: 'audio/mpeg',
      byteSize: 3,
    },
    read: vi
      .fn<ResolvedMedia['read']>()
      .mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), totalSize: 3, done: true }),
    validate: vi.fn<NonNullable<ResolvedMedia['validate']>>().mockResolvedValue(undefined),
    dispose: vi.fn(),
  } satisfies ResolvedMedia;
}

describe('page controller', () => {
  let candidates: MediaCandidate[];
  let dispose: (() => void) | undefined;
  let adapter: MediaAdapter;
  const writer = { write: vi.fn(), close: vi.fn(), abort: vi.fn() };
  const createWritable = vi.fn();
  const picker = vi.fn<() => Promise<FileSystemFileHandle>>();
  const handle = { createWritable } as unknown as FileSystemFileHandle;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main id="MiddleColumn"></main>';
    candidates = [];
    bridge.command = undefined;
    bridge.dispose.mockReset();
    bridge.request.mockReset().mockImplementation(async () => ({
      ok: true,
      settings: { language: 'en', theme: 'system', keepHistory: true },
    }));
    writer.write.mockReset().mockResolvedValue(undefined);
    writer.close.mockReset().mockResolvedValue(undefined);
    writer.abort.mockReset().mockResolvedValue(undefined);
    createWritable.mockReset().mockResolvedValue(writer);
    picker.mockReset().mockResolvedValue(handle);
    vi.stubGlobal('showSaveFilePicker', picker);
    adapter = { client: 'a', discover: vi.fn(() => candidates), dispose: vi.fn() };
  });

  afterEach(async () => {
    dispose?.();
    dispose = undefined;
    await flush();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function flush() {
    for (let index = 0; index < 15; index++) await Promise.resolve();
  }

  function addCandidate(
    key: string,
    source = makeSource(key),
    resolve: MediaCandidate['resolve'] = async () => source,
  ) {
    const anchor = document.createElement('div');
    anchor.dataset.messageId = key;
    document.querySelector('#MiddleColumn')!.append(anchor);
    const candidate: MediaCandidate = { key, anchor, resolve: vi.fn(resolve) };
    candidates.push(candidate);
    return candidate;
  }

  async function start() {
    dispose = startPageController(adapter);
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();
  }

  function button(key: string): HTMLButtonElement {
    const result = document
      .querySelector(`[data-tad-control="${key}"]`)
      ?.shadowRoot?.querySelector('button');
    if (!result) throw new Error(`Control missing: ${key}`);
    return result;
  }

  async function click(target: HTMLButtonElement, trusted = true) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'isTrusted', { value: trusted });
    target.dispatchEvent(event);
    await flush();
  }

  function enqueuedId(): string {
    const payload = bridge.request.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry.type === 'enqueue');
    if (payload?.type !== 'enqueue') throw new Error('No queued job');
    return payload.jobId;
  }

  async function command(value: Command) {
    if (!bridge.command) throw new Error('Command handler missing');
    const reply = await bridge.command(value);
    await flush();
    return reply;
  }

  async function rescan() {
    document.querySelector('#MiddleColumn')!.append(document.createElement('span'));
    await vi.advanceTimersByTimeAsync(400);
    await flush();
  }

  it('limits resolution to three concurrent candidates and drains the queue', async () => {
    const requests = Array.from({ length: 7 }, () => deferred<ResolvedMedia>());
    requests.forEach((request, index) =>
      addCandidate(`file-${index}`, makeSource(`file-${index}`), () => request.promise),
    );
    await start();
    expect(
      candidates.filter((candidate) => vi.mocked(candidate.resolve).mock.calls.length),
    ).toHaveLength(3);
    requests[0]!.resolve(makeSource('file-0'));
    await flush();
    expect(
      candidates.filter((candidate) => vi.mocked(candidate.resolve).mock.calls.length),
    ).toHaveLength(4);
    requests.slice(1).forEach((request, index) => request.resolve(makeSource(`file-${index + 1}`)));
    await flush();
    expect(
      candidates.every((candidate) => vi.mocked(candidate.resolve).mock.calls.length === 1),
    ).toBe(true);
    expect(button('file-6').disabled).toBe(false);
  });

  it('keeps preparation failures actionable and requires a new user gesture after recovery', async () => {
    const source = makeSource();
    const candidate = addCandidate('first', source);
    vi.mocked(candidate.resolve).mockRejectedValueOnce(new DownloadError('ambiguous_media'));
    await start();
    expect(button('first').dataset.error).toBe('true');
    expect(button('first').title).toContain('Could not identify this attachment precisely');
    expect(button('first').disabled).toBe(false);
    await click(button('first'));
    expect(picker).not.toHaveBeenCalled();
    expect(button('first').dataset.error).toBe('false');
    expect(document.querySelector('[data-tad-notice]')?.shadowRoot?.textContent).toContain(
      'Save again',
    );
    await click(button('first'));
    expect(picker).toHaveBeenCalledOnce();
  });

  it('does not open a picker for a synthetic click', async () => {
    addCandidate('first');
    await start();
    await click(button('first'), false);
    expect(picker).not.toHaveBeenCalled();
  });

  it('keeps the button usable when opening the native picker throws synchronously', async () => {
    const source = makeSource();
    addCandidate('first', source);
    picker.mockImplementationOnce(() => {
      throw new DOMException('No activation', 'SecurityError');
    });
    await start();
    await click(button('first'));
    expect(button('first').disabled).toBe(false);
    expect(source.dispose).not.toHaveBeenCalled();
    await click(button('first'));
    expect(enqueuedId()).toBeTruthy();
  });

  it('deduplicates candidates without moving controls between duplicate anchors', async () => {
    const first = addCandidate('same');
    const second = addCandidate('same');
    await start();
    await rescan();
    expect(document.querySelectorAll('[data-tad-control]')).toHaveLength(1);
    expect(first.resolve).toHaveBeenCalledOnce();
    expect(second.resolve).not.toHaveBeenCalled();
  });

  it('retains the prepared source after a cancelled picker and allows another save', async () => {
    const source = makeSource();
    addCandidate('first', source);
    picker.mockRejectedValueOnce(new DOMException('User cancelled', 'AbortError'));
    await start();
    await click(button('first'));
    expect(source.dispose).not.toHaveBeenCalled();
    expect(button('first').disabled).toBe(false);
    expect(bridge.request).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'enqueue' }));
    await click(button('first'));
    expect(enqueuedId()).toBeTruthy();
  });

  it('prevents simultaneous picker requests for the same underlying attachment', async () => {
    addCandidate('message', makeSource());
    addCandidate('viewer', makeSource());
    const destination = deferred<FileSystemFileHandle>();
    picker.mockReturnValue(destination.promise);
    await start();
    await click(button('message'));
    await click(button('viewer'));
    expect(picker).toHaveBeenCalledOnce();
    destination.resolve(handle);
    await flush();
    expect(
      bridge.request.mock.calls.filter(([payload]) => payload.type === 'enqueue'),
    ).toHaveLength(1);
    expect(button('viewer').dataset.active).toBe('true');
  });

  it('keeps an active source alive when its message leaves the DOM and confirms only a committed file', async () => {
    const source = makeSource();
    const candidate = addCandidate('first', source);
    const closed = deferred<void>();
    writer.close.mockReturnValue(closed.promise);
    await start();
    await click(button('first'));
    const id = enqueuedId();
    candidate.anchor.remove();
    candidates = [];
    await rescan();
    expect(source.dispose).not.toHaveBeenCalled();
    await command({ type: 'start', jobId: id });
    expect(writer.close).toHaveBeenCalledOnce();
    expect(bridge.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'finish', state: 'completed' }),
    );
    closed.resolve();
    await flush();
    expect(bridge.request).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'finish', state: 'completed', bytes: 3 }),
    );
    expect(source.dispose).toHaveBeenCalledOnce();
  });

  it('releases queued sources once on cancellation without creating a writer', async () => {
    const source = makeSource();
    addCandidate('first', source);
    await start();
    await click(button('first'));
    const id = enqueuedId();
    await command({ type: 'cancel', jobId: id });
    await command({ type: 'cancel', jobId: id });
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(createWritable).not.toHaveBeenCalled();
    expect(bridge.request.mock.calls.filter(([payload]) => payload.type === 'finish')).toHaveLength(
      1,
    );
    expect((await command({ type: 'probe' })).jobs?.[0]?.state).toBe('cancelled');
  });

  it('rejects cancellation during commit and reports completion only after the file closes', async () => {
    addCandidate('first');
    const closed = deferred<void>();
    writer.close.mockReturnValue(closed.promise);
    await start();
    await click(button('first'));
    const id = enqueuedId();
    await command({ type: 'start', jobId: id });
    expect(writer.close).toHaveBeenCalledOnce();
    expect(button('first').disabled).toBe(true);
    expect(button('first').title).toContain('Saving file…');
    expect(await command({ type: 'cancel', jobId: id })).toEqual({ ok: false });
    expect(bridge.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'finish', state: 'completed' }),
    );
    closed.resolve();
    await flush();
    expect(writer.abort).not.toHaveBeenCalled();
    expect(bridge.request).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'finish', state: 'completed', bytes: 3 }),
    );
    expect(button('first').disabled).toBe(false);
  });

  it('aborts page teardown during finalization before close begins', async () => {
    addCandidate('first');
    const finalizing = deferred<Record<string, unknown>>();
    bridge.request.mockImplementation(async (payload) => {
      if (payload.type === 'progress' && payload.state === 'finalizing') return finalizing.promise;
      return { ok: true };
    });
    await start();
    await click(button('first'));
    await command({ type: 'start', jobId: enqueuedId() });
    expect(button('first').title).toContain('Saving file…');
    expect(writer.close).not.toHaveBeenCalled();
    dispose?.();
    finalizing.resolve({ ok: true });
    await flush();
    expect(writer.abort).toHaveBeenCalledOnce();
    expect(writer.close).not.toHaveBeenCalled();
    expect(bridge.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'finish', state: 'completed' }),
    );
  });

  it('reports writer creation failure as a disk error and releases the source', async () => {
    const source = makeSource();
    addCandidate('first', source);
    createWritable.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    await start();
    await click(button('first'));
    await command({ type: 'start', jobId: enqueuedId() });
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(bridge.request).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'finish', state: 'failed', error: 'disk_error' }),
    );
    expect(button('first').title).toContain('Check free disk space');
  });

  it('cancels while waiting for the start grant without opening a file writer', async () => {
    const source = makeSource();
    addCandidate('first', source);
    const granted = deferred<Record<string, unknown>>();
    bridge.request.mockImplementation(async (payload) => {
      if (payload.type === 'progress' && payload.bytes === 0) return granted.promise;
      return { ok: true };
    });
    await start();
    await click(button('first'));
    const id = enqueuedId();
    await command({ type: 'start', jobId: id });
    await command({ type: 'cancel', jobId: id });
    granted.resolve({ ok: true });
    await flush();
    expect(createWritable).not.toHaveBeenCalled();
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(bridge.request).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'finish', state: 'cancelled' }),
    );
  });

  it('preserves cancellation if the pending start grant then rejects', async () => {
    addCandidate('first');
    const granted = deferred<Record<string, unknown>>();
    bridge.request.mockImplementation(async (payload) => {
      if (payload.type === 'progress') return granted.promise;
      return { ok: true };
    });
    await start();
    await click(button('first'));
    const id = enqueuedId();
    await command({ type: 'start', jobId: id });
    expect(await command({ type: 'cancel', jobId: id })).toEqual({ ok: true });
    granted.reject(new Error('Disconnected'));
    await flush();
    expect(createWritable).not.toHaveBeenCalled();
    expect(bridge.request).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'finish', state: 'cancelled', error: 'cancelled' }),
    );
  });

  it('validates the selected source again before opening a writer', async () => {
    const source = makeSource();
    source.validate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new DownloadError('account_changed'));
    addCandidate('first', source);
    await start();
    await click(button('first'));
    await command({ type: 'start', jobId: enqueuedId() });
    expect(createWritable).not.toHaveBeenCalled();
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(bridge.request).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'finish', state: 'failed', error: 'account_changed' }),
    );
  });

  it('does not claim success when committing the file fails', async () => {
    const source = makeSource();
    addCandidate('first', source);
    writer.close.mockRejectedValue(new Error('Disk full'));
    await start();
    await click(button('first'));
    await command({ type: 'start', jobId: enqueuedId() });
    expect(writer.abort).toHaveBeenCalledOnce();
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(bridge.request).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'finish', state: 'failed', error: 'disk_error' }),
    );
    expect(bridge.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'finish', state: 'completed' }),
    );
  });

  it('disposes an invalidated account source after destination selection', async () => {
    const source = makeSource();
    source.validate.mockRejectedValue(new DownloadError('account_changed'));
    addCandidate('first', source);
    await start();
    await click(button('first'));
    expect(bridge.request).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'enqueue' }));
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(button('first').dataset.error).toBe('true');
    expect(button('first').title).toContain('The account changed');
  });

  it('releases the source and settles a job when enqueue loses the extension connection', async () => {
    const source = makeSource();
    addCandidate('first', source);
    bridge.request.mockImplementation(async (payload) => {
      if (payload.type === 'enqueue') throw new Error('Disconnected');
      return { ok: true };
    });
    await start();
    await click(button('first'));
    expect(source.dispose).toHaveBeenCalledOnce();
    expect((await command({ type: 'probe' })).jobs?.[0]?.state).toBe('failed');
    expect(button('first').disabled).toBe(false);
  });

  it('requires preparation and a fresh gesture when retrying from the popup', async () => {
    const firstSource = makeSource();
    const secondSource = makeSource();
    const candidate = addCandidate('first', firstSource);
    vi.mocked(candidate.resolve)
      .mockResolvedValueOnce(firstSource)
      .mockResolvedValueOnce(secondSource);
    await start();
    await click(button('first'));
    const id = enqueuedId();
    await command({ type: 'cancel', jobId: id });
    await command({ type: 'retry', jobId: id });
    expect(candidate.resolve).toHaveBeenCalledTimes(2);
    expect(picker).toHaveBeenCalledOnce();
    expect(secondSource.dispose).not.toHaveBeenCalled();
    await click(button('first'));
    expect(picker).toHaveBeenCalledTimes(2);
  });

  it('does not enqueue a picker result after the page has been disposed', async () => {
    const source = makeSource();
    addCandidate('first', source);
    const destination = deferred<FileSystemFileHandle>();
    picker.mockReturnValue(destination.promise);
    await start();
    await click(button('first'));
    dispose?.();
    expect(source.dispose).toHaveBeenCalledOnce();
    destination.resolve(handle);
    await flush();
    expect(bridge.request).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'enqueue' }));
    expect(source.dispose).toHaveBeenCalledOnce();
    expect(adapter.dispose).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-tad-control]')).toBeNull();
  });

  it('disposes late resolution and does not start queued work after page disposal', async () => {
    const pending = Array.from({ length: 4 }, () => deferred<ResolvedMedia>());
    pending.forEach((request, index) =>
      addCandidate(`file-${index}`, makeSource(), () => request.promise),
    );
    await start();
    dispose?.();
    const sources = pending.map(() => makeSource());
    pending.forEach((request, index) => request.resolve(sources[index]!));
    await flush();
    expect(candidates[3]!.resolve).not.toHaveBeenCalled();
    expect(sources.slice(0, 3).every((source) => source.dispose.mock.calls.length === 1)).toBe(
      true,
    );
    expect(document.querySelector('[data-tad-notice]')).toBeNull();
  });
});
