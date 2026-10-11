import { PageBridge } from '../bridge/page';
import { settingsSchema, type CommandReply } from '../bridge/protocol';
import { DownloadError, errorCode, type ErrorCode } from '../domain/errors';
import { DEFAULT_SETTINGS, type Settings } from '../domain/jobs';
import {
  mediaKey,
  type MediaAdapter,
  type MediaCandidate,
  type MediaInfo,
  type ResolvedMedia,
} from '../domain/media';
import { transferToWriter } from '../downloads/stream';
import {
  directoryFilename,
  resolveDirectoryDestination,
  type DirectoryOptions,
} from '../downloads/destination';
import { safeFilename } from '../naming';
import { createBatchPanel, type BatchEntry } from './batch-panel';

interface FilePickerWindow extends Window {
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}
interface Control {
  candidate: MediaCandidate;
  host: HTMLElement;
  button: HTMLButtonElement;
  source?: ResolvedMedia;
  preparing: boolean;
  preparation?: Promise<boolean>;
  prepareError?: ErrorCode;
  selecting: boolean;
  jobId?: string;
  previousPosition: string;
  positionChanged: boolean;
}
interface PageJob {
  id: string;
  key: string;
  candidate: MediaCandidate;
  info: MediaInfo;
  source?: ResolvedMedia;
  handle?: FileSystemFileHandle;
  directory?: FileSystemDirectoryHandle;
  destinationOptions?: DirectoryOptions;
  destinationName?: string;
  controller: AbortController;
  state: 'queued' | 'downloading' | 'finalizing' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  bytes: number;
  total?: number;
  error?: ErrorCode;
  finishing?: Promise<void>;
}

const copy = {
  ru: {
    prepare: 'Подготовка файла…',
    save: 'Скачать файл',
    saved: 'Скачано',
    saving: 'Сохранение файла…',
    queued: 'В очереди',
    cancel: 'Отменить',
    retry: 'Повторить',
    picker: 'Выберите файл для сохранения',
    unavailable: 'Не удалось получить файл. Откройте сообщение заново.',
    noPicker:
      'В этом браузере недоступна потоковая запись. Используйте актуальный Chrome или Яндекс.Браузер.',
    selectAgain: 'Нажмите «Сохранить снова» для выбора места на диске.',
    again: 'Сохранить снова',
    duplicate: 'Этот файл уже скачивается.',
    reconnect: 'Перезагрузите Telegram, чтобы подключить расширение.',
    disk: 'Не удалось записать файл. Проверьте свободное место и повторите.',
    tooLarge: 'Размер файла превышает поддерживаемый предел 4 GiB.',
    unknown: 'Файл не удалось определить однозначно. Откройте исходное сообщение.',
    changed: 'Аккаунт изменился. Выберите файл заново.',
    code: 'Код',
    close: 'Закрыть',
  },
  en: {
    prepare: 'Preparing file…',
    save: 'Save file',
    saved: 'Saved',
    saving: 'Saving file…',
    queued: 'Queued',
    cancel: 'Cancel',
    retry: 'Retry',
    picker: 'Choose where to save the file',
    unavailable: 'Could not retrieve this file. Reopen the message.',
    noPicker: 'Streaming file access is unavailable. Use a current Chrome or Yandex Browser.',
    selectAgain: 'Click “Save again” to choose a destination.',
    again: 'Save again',
    duplicate: 'This file is already downloading.',
    reconnect: 'Reload Telegram to connect the extension.',
    disk: 'Could not write the file. Check free disk space and retry.',
    tooLarge: 'This file exceeds the supported 4 GiB limit.',
    unknown: 'Could not identify this attachment precisely. Open its original message.',
    changed: 'The account changed. Select the file again.',
    code: 'Code',
    close: 'Close',
  },
};

const buttonStyle = `
:host{position:absolute;right:8px;top:8px;z-index:12;display:block;font:12px/1.3 system-ui,sans-serif;color-scheme:light dark}
button{appearance:none;border:1px solid #74d2df99;border-radius:18px;background:#103947ee;color:#f2fcff;box-shadow:0 2px 8px #001a2730;min-width:32px;height:30px;padding:0 10px;cursor:pointer;font:600 12px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;gap:6px}
button:hover{background:#075a6d}button:focus-visible{outline:3px solid #51cee5;outline-offset:3px}button:disabled{opacity:.6;cursor:wait}button[data-error=true]{border-color:#f4b36a}svg{width:16px;height:16px;pointer-events:none}.label{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;
const ARROW = '↓';

export function startPageController(adapter: MediaAdapter): () => void {
  const bridge = new PageBridge();
  let settings: Settings = DEFAULT_SETTINGS;
  let connected = false;
  let disposed = false;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | undefined;
  const startupTimers: ReturnType<typeof setTimeout>[] = [];
  const controls = new Map<string, Control>();
  const jobs = new Map<string, PageJob>();
  const selections = new Set<string>();
  const pendingSources = new Set<ResolvedMedia>();
  const preparationQueue: Array<{ control: Control; resolve: (prepared: boolean) => void }> = [];
  let preparationsRunning = 0;
  let notice: HTMLElement | undefined;
  let launcher: HTMLElement | undefined;
  let batchBusy = false;
  const batchCandidates = new Map<string, { candidate: MediaCandidate; info: MediaInfo }>();
  const albumIds = new WeakMap<Element, string>();
  const words = () =>
    copy[
      settings.language === 'auto'
        ? navigator.language.startsWith('ru')
          ? 'ru'
          : 'en'
        : settings.language
    ];

  const batchPanel = createBatchPanel({
    settings,
    entries: batchEntries,
    download: selectBatchDestination,
  });
  function batchEntries(): BatchEntry[] {
    scan();
    batchCandidates.clear();
    const entries = new Map<string, BatchEntry>();
    for (const control of controls.values()) {
      const info =
        control.source?.info ?? (control.jobId ? jobs.get(control.jobId)?.info : undefined);
      if (!info || entries.size >= 200) continue;
      const key = mediaKey(info.identity);
      if (entries.has(key)) continue;
      const parent = control.candidate.anchor.closest('.Message,.bubble');
      if (parent && !albumIds.has(parent)) albumIds.set(parent, crypto.randomUUID());
      batchCandidates.set(key, { candidate: control.candidate, info });
      entries.set(key, {
        key,
        info,
        album: parent ? albumIds.get(parent) : undefined,
        disabled: !!activeJob(key) || selections.has(key),
      });
    }
    return [...entries.values()];
  }
  function openBatch(retries?: PageJob[]): number {
    if (disposed || batchBusy) return 0;
    if (!retries) {
      batchPanel.open();
      return 1;
    }
    const retryCandidates = new Map<string, { candidate: MediaCandidate; info: MediaInfo }>();
    const entries: BatchEntry[] = [];
    for (const job of retries) {
      if (activeJob(job.key) || retryCandidates.has(job.key)) continue;
      retryCandidates.set(job.key, { candidate: job.candidate, info: job.info });
      entries.push({ key: job.key, info: job.info });
    }
    if (entries.length) {
      batchCandidates.clear();
      for (const [key, entry] of retryCandidates) batchCandidates.set(key, entry);
      batchPanel.open(
        entries,
        entries.map((entry) => entry.key),
      );
    }
    return entries.length;
  }
  function selectBatchDestination(
    entries: BatchEntry[],
    options: Omit<DirectoryOptions, 'index'>,
    event: MouseEvent,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.isTrusted || disposed || batchBusy || !entries.length) return;
    if (!connected) {
      showNotice(words().reconnect);
      void handshake();
      return;
    }
    const picker = (window as FilePickerWindow).showDirectoryPicker;
    if (!picker) {
      showNotice(words().noPicker);
      return;
    }
    const selected = entries
      .map((entry) => ({ entry, captured: batchCandidates.get(entry.key) }))
      .filter(
        (
          item,
        ): item is {
          entry: BatchEntry;
          captured: { candidate: MediaCandidate; info: MediaInfo };
        } => !!item.captured && !activeJob(item.entry.key) && !selections.has(item.entry.key),
      );
    if (!selected.length) {
      showNotice(words().duplicate);
      return;
    }
    let destination: Promise<FileSystemDirectoryHandle>;
    try {
      destination = picker.call(window, { mode: 'readwrite' });
    } catch (error) {
      if (errorCode(error) !== 'cancelled') showNotice(failureNotice('disk_error'));
      return;
    }
    batchBusy = true;
    batchPanel.setBusy(true);
    for (const { entry } of selected) selections.add(entry.key);
    const batchId = crypto.randomUUID();
    const language = words() === copy.ru ? 'ru' : 'en';
    const batchLabel = `${language === 'ru' ? 'Пакет' : 'Batch'} · ${new Date().toLocaleString(language)}`;
    let accepted = 0;
    let rejected = entries.length - selected.length;
    void destination
      .then(async (directory) => {
        for (let index = 0; index < selected.length; index++) {
          if (disposed) break;
          const { entry, captured } = selected[index]!;
          if (
            activeJob(entry.key) ||
            [...jobs.values()].filter((job) =>
              ['queued', 'downloading', 'finalizing'].includes(job.state),
            ).length >= 200
          ) {
            rejected++;
            continue;
          }
          const id = crypto.randomUUID();
          const destinationOptions = { ...options, index: index + 1 };
          const job: PageJob = {
            id,
            key: entry.key,
            candidate: captured.candidate,
            info: captured.info,
            directory,
            destinationOptions,
            controller: new AbortController(),
            state: 'queued',
            bytes: 0,
            total: captured.info.byteSize,
          };
          jobs.set(id, job);
          for (const control of controls.values()) {
            const info =
              control.source?.info ?? (control.jobId ? jobs.get(control.jobId)?.info : undefined);
            if (info && mediaKey(info.identity) === entry.key) {
              releaseControlSource(control);
              control.jobId = id;
              paint(control);
            }
          }
          try {
            const reply = await bridge.request({
              type: 'enqueue',
              jobId: id,
              media: {
                ...captured.info,
                filename: directoryFilename(captured.info, destinationOptions),
              },
              batchId,
              batchLabel,
            });
            if (reply.ok !== true) throw new DownloadError('source_unavailable');
            accepted++;
          } catch {
            rejected++;
            if (job.state === 'queued') {
              job.state = 'failed';
              job.error = 'source_unavailable';
              await finish(job);
            }
          }
        }
        if (!disposed)
          batchPanel.showResult(
            language === 'ru'
              ? `Добавлено в очередь: ${accepted}. Не добавлено: ${rejected}. Результаты доступны в менеджере загрузок.`
              : `Added to queue: ${accepted}. Not added: ${rejected}. See the download manager for results.`,
          );
      })
      .catch((error: unknown) => {
        if (errorCode(error) !== 'cancelled') showNotice(failureNotice('disk_error'));
      })
      .finally(() => {
        for (const { entry } of selected) selections.delete(entry.key);
        batchBusy = false;
        batchPanel.setBusy(false);
      });
  }

  function showNotice(text: string, action?: { label: string; run: (event: MouseEvent) => void }) {
    if (disposed) return;
    notice?.remove();
    notice = document.createElement('div');
    notice.dataset.tadNotice = 'true';
    notice.style.cssText =
      'position:fixed;bottom:24px;right:24px;z-index:2147483646;max-width:360px';
    const shadow = notice.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent =
      ':host{font:14px/1.5 system-ui,sans-serif}.box{background:#103947;color:#fff;padding:16px;border-radius:16px;box-shadow:0 6px 32px #0004}p{margin:0 0 12px}button{font:600 13px system-ui;border:0;border-radius:8px;background:#8fe2ee;color:#08323d;padding:9px 12px;cursor:pointer;margin-right:8px}button:focus-visible{outline:3px solid white;outline-offset:2px}';
    const box = document.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'status');
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    box.append(paragraph);
    if (action) {
      const button = document.createElement('button');
      button.textContent = action.label;
      button.onclick = action.run;
      box.append(button);
    }
    const close = document.createElement('button');
    close.textContent = words().close;
    close.onclick = () => notice?.remove();
    box.append(close);
    shadow.append(style, box);
    document.documentElement.append(notice);
  }
  function describeError(code: ErrorCode): string {
    if (code === 'disk_error') return words().disk;
    if (code === 'account_changed') return words().changed;
    if (code === 'ambiguous_media' || code === 'invalid_response') return words().unknown;
    if (code === 'file_too_large') return words().tooLarge;
    if (code === 'destination_required') return words().noPicker;
    return words().unavailable;
  }
  function failureNotice(code: ErrorCode): string {
    return `${describeError(code)} ${words().code}: ${code}`;
  }
  function paint(control: Control) {
    const job = control.jobId ? jobs.get(control.jobId) : undefined;
    const active = job && ['queued', 'downloading', 'finalizing'].includes(job.state);
    control.button.disabled = control.preparing || control.selecting || job?.state === 'finalizing';
    control.button.dataset.error = String(job?.state === 'failed' || !!control.prepareError);
    let title: string = words().save;
    let label = ARROW;
    if (control.selecting) {
      title = words().picker;
      label = '…';
    } else if (control.preparing) {
      title = words().prepare;
      label = '…';
    } else if (control.prepareError) {
      title = `${describeError(control.prepareError)} ${words().retry}`;
      label = '↻';
    } else if (job?.state === 'queued') {
      title = `${words().queued} · ${words().cancel}`;
      label = '…';
    } else if (job?.state === 'finalizing') {
      label = '…';
      title = words().saving;
    } else if (job?.state === 'downloading') {
      label = job.total ? `${Math.min(99, Math.floor((job.bytes / job.total) * 100))}%` : '…';
      title = words().cancel;
    } else if (job?.state === 'completed') {
      label = '✓';
      title = `${words().saved} · ${words().again}`;
    } else if (job?.state === 'failed') {
      label = '↻';
      title = `${job.error ? describeError(job.error) : words().unavailable} ${words().retry}`;
    }
    const filename = control.source?.info.filename ?? job?.info.filename;
    if (filename) title += `: ${filename}`;
    control.button.textContent = label;
    control.button.title = title;
    control.button.setAttribute('aria-label', title);
    if (active) control.button.dataset.active = 'true';
    else delete control.button.dataset.active;
  }
  function paintJob(job: PageJob) {
    for (const control of controls.values()) if (control.jobId === job.id) paint(control);
  }
  async function handshake() {
    try {
      const reply = await bridge.request({ type: 'hello', client: adapter.client, ready: true });
      connected = reply.ok === true;
      const parsed = settingsSchema.safeParse(reply.settings, { jitless: true });
      if (parsed.success) settings = parsed.data;
      batchPanel.updateSettings(settings);
      paintLauncher();
      if (!disposed) for (const control of controls.values()) paint(control);
    } catch {
      connected = false;
    }
  }
  function ownedSource(source: ResolvedMedia): ResolvedMedia {
    let released = false;
    return {
      info: { ...source.info, filename: safeFilename(source.info) },
      read: (offset, length, signal) => source.read(offset, length, signal),
      validate: source.validate ? (signal) => source.validate!(signal) : undefined,
      dispose: () => {
        if (released) return;
        released = true;
        try {
          source.dispose?.();
        } catch {
          /* Cleanup cannot change a committed file's status. */
        }
      },
    };
  }
  function resolveJobSource(job: PageJob): Promise<ResolvedMedia> {
    const signal = job.controller.signal;
    if (signal.aborted) return Promise.reject(new DownloadError('cancelled'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const stop = () => {
        settled = true;
        signal.removeEventListener('abort', stop);
        reject(new DownloadError('cancelled'));
      };
      signal.addEventListener('abort', stop, { once: true });
      void Promise.resolve()
        .then(() => {
          if (signal.aborted) throw new DownloadError('cancelled');
          return job.candidate.resolve();
        })
        .then((value) => {
          const source = ownedSource(value);
          if (settled || signal.aborted) {
            source.dispose?.();
            return;
          }
          settled = true;
          signal.removeEventListener('abort', stop);
          resolve(source);
        })
        .catch((error: unknown) => {
          signal.removeEventListener('abort', stop);
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
    });
  }
  function liveControl(control: Control): boolean {
    return !disposed && control.host.isConnected && controls.get(control.candidate.key) === control;
  }
  function activeJob(key: string): PageJob | undefined {
    return [...jobs.values()].find(
      (job) => job.key === key && ['queued', 'downloading', 'finalizing'].includes(job.state),
    );
  }
  function releaseControlSource(control: Control) {
    control.source?.dispose?.();
    control.source = undefined;
  }
  function removeControl(control: Control) {
    control.host.remove();
    if (control.positionChanged && control.candidate.anchor.style.position === 'relative') {
      control.candidate.anchor.style.position = control.previousPosition;
    }
    releaseControlSource(control);
  }
  function drainPreparations() {
    while (!disposed && preparationsRunning < 3 && preparationQueue.length) {
      const pending = preparationQueue.shift()!;
      const { control } = pending;
      preparationsRunning++;
      void (async () => {
        let prepared = false;
        try {
          if (!liveControl(control)) return;
          const source = ownedSource(await control.candidate.resolve());
          if (!liveControl(control)) {
            source.dispose?.();
            return;
          }
          releaseControlSource(control);
          const existing = activeJob(mediaKey(source.info.identity));
          if (existing) {
            control.jobId = existing.id;
            source.dispose?.();
          } else {
            control.source = source;
            control.jobId = undefined;
          }
          control.prepareError = undefined;
          prepared = true;
        } catch (error) {
          control.prepareError = errorCode(error);
        } finally {
          control.preparing = false;
          control.preparation = undefined;
          preparationsRunning--;
          if (liveControl(control)) paint(control);
          pending.resolve(prepared);
          drainPreparations();
        }
      })();
    }
  }
  function prepare(control: Control): Promise<boolean> {
    if (control.preparation) return control.preparation;
    if (!liveControl(control) || control.selecting) return Promise.resolve(false);
    control.preparing = true;
    control.prepareError = undefined;
    paint(control);
    control.preparation = new Promise((resolve) => preparationQueue.push({ control, resolve }));
    drainPreparations();
    return control.preparation ?? Promise.resolve(false);
  }
  function finish(job: PageJob): Promise<void> {
    if (job.finishing) return job.finishing;
    job.source?.dispose?.();
    job.handle = undefined;
    job.directory = undefined;
    job.source = undefined;
    paintJob(job);
    job.finishing = (async () => {
      try {
        if (!disposed)
          await bridge.request({
            type: 'finish',
            jobId: job.id,
            bytes: job.bytes,
            state: job.state as 'completed' | 'failed' | 'cancelled' | 'skipped',
            error: job.error,
          });
      } catch {
        /* Reconciliation recovers terminal state from this page. */
      }
      if (jobs.size > 200) {
        for (const [id, previous] of jobs) {
          if (!['queued', 'downloading', 'finalizing'].includes(previous.state) && id !== job.id) {
            jobs.delete(id);
            if (jobs.size <= 200) break;
          }
        }
      }
    })();
    return job.finishing;
  }
  async function run(job: PageJob) {
    if (job.state !== 'queued' || (!job.directory && (!job.source || !job.handle))) return;
    job.state = 'downloading';
    paintJob(job);
    try {
      const grant = await bridge.request({
        type: 'progress',
        jobId: job.id,
        bytes: 0,
        total: job.total,
        state: 'downloading',
      });
      if (grant.ok !== true) throw new DownloadError('source_unavailable');
      if (!job.source) {
        const source = await resolveJobSource(job);
        if (
          mediaKey(source.info.identity) !== job.key ||
          source.info.mimeType !== job.info.mimeType ||
          (job.info.byteSize !== undefined && source.info.byteSize !== job.info.byteSize)
        ) {
          source.dispose?.();
          throw new DownloadError('source_unavailable');
        }
        job.source = source;
      }
      await job.source.validate?.(job.controller.signal);
      if (job.controller.signal.aborted) throw new DownloadError('cancelled');
      if (job.directory && job.destinationOptions) {
        const destination = await resolveDirectoryDestination(
          job.directory,
          job.info,
          job.destinationOptions,
          job.controller.signal,
        );
        if (!destination) {
          job.state = 'skipped';
          await finish(job);
          return;
        }
        job.handle = destination.handle;
        job.destinationName = destination.filename;
        const reply = await bridge.request({
          type: 'progress',
          jobId: job.id,
          bytes: 0,
          total: job.total,
          state: 'downloading',
          destinationName: destination.filename,
        });
        if (reply.ok !== true) throw new DownloadError('source_unavailable');
      }
      if (job.controller.signal.aborted) throw new DownloadError('cancelled');
      let writable: FileSystemWritableFileStream;
      try {
        writable = await job.handle!.createWritable();
      } catch {
        throw new DownloadError('disk_error');
      }
      let lastProgress = 0;
      job.bytes = await transferToWriter(
        job.source,
        {
          write: (bytes) => writable.write(new Uint8Array(bytes)),
          close: () => writable.close(),
          abort: () => writable.abort(),
        },
        job.controller.signal,
        async (progress) => {
          job.bytes = progress.bytes;
          job.total = progress.total;
          job.state = progress.state;
          paintJob(job);
          if (progress.state === 'finalizing' || Date.now() - lastProgress >= 500) {
            lastProgress = Date.now();
            const reply = await bridge.request({ type: 'progress', jobId: job.id, ...progress });
            if (reply.ok !== true) throw new DownloadError('source_unavailable');
          }
        },
      );
      job.state = 'completed';
    } catch (error) {
      job.error = job.controller.signal.aborted ? 'cancelled' : errorCode(error);
      job.state = job.error === 'cancelled' ? 'cancelled' : 'failed';
      if (job.state === 'failed') showNotice(failureNotice(job.error));
    }
    await finish(job);
  }
  function cancel(job: PageJob): boolean {
    if (!['queued', 'downloading'].includes(job.state)) return false;
    job.controller.abort();
    if (job.state === 'queued') {
      job.state = 'cancelled';
      job.error = 'cancelled';
      void finish(job);
    }
    return true;
  }
  async function prepareAgain(control: Control) {
    releaseControlSource(control);
    control.jobId = undefined;
    if (await prepare(control)) {
      if (liveControl(control) && control.source)
        showNotice(words().selectAgain, {
          label: words().again,
          run: (event) => selectDestination(control, event),
        });
    } else if (liveControl(control) && control.prepareError)
      showNotice(failureNotice(control.prepareError));
  }
  function selectDestination(control: Control, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.isTrusted || disposed || control.preparing || control.selecting) return;
    if (!liveControl(control)) {
      showNotice(words().unavailable);
      return;
    }
    const current = control.jobId ? jobs.get(control.jobId) : undefined;
    if (current && ['queued', 'downloading', 'finalizing'].includes(current.state)) {
      cancel(current);
      return;
    }
    if (!connected) {
      showNotice(words().reconnect);
      void handshake();
      return;
    }
    if (!control.source) {
      void prepareAgain(control);
      return;
    }
    const source = control.source;
    const key = mediaKey(source.info.identity);
    if (activeJob(key) || selections.has(key)) {
      showNotice(words().duplicate);
      return;
    }
    const picker = (window as FilePickerWindow).showSaveFilePicker;
    if (!picker) {
      showNotice(words().noPicker);
      return;
    }
    let destination: Promise<FileSystemFileHandle>;
    try {
      destination = picker.call(window, { suggestedName: source.info.filename });
    } catch (error) {
      if (errorCode(error) !== 'cancelled') showNotice(words().picker);
      return;
    }
    selections.add(key);
    pendingSources.add(source);
    control.source = undefined;
    control.selecting = true;
    paint(control);
    let transferred = false;
    let invalidSource = false;
    let selectedJob: PageJob | undefined;
    void destination
      .then(async (handle) => {
        if (disposed) return;
        await source.validate?.();
        if (disposed) return;
        if (activeJob(key)) {
          showNotice(words().duplicate);
          return;
        }
        const id = crypto.randomUUID();
        const job: PageJob = {
          id,
          key,
          candidate: control.candidate,
          info: source.info,
          source,
          handle,
          controller: new AbortController(),
          state: 'queued',
          bytes: 0,
          total: source.info.byteSize,
        };
        selectedJob = job;
        transferred = true;
        pendingSources.delete(source);
        jobs.set(id, job);
        control.jobId = id;
        control.selecting = false;
        for (const entry of controls.values()) {
          if (entry.source && mediaKey(entry.source.info.identity) === key) {
            releaseControlSource(entry);
            entry.jobId = id;
            paint(entry);
          }
        }
        paint(control);
        const reply = await bridge.request({ type: 'enqueue', jobId: id, media: source.info });
        if (reply.ok !== true && job.state === 'queued') {
          job.error = 'source_unavailable';
          job.state = 'failed';
          await finish(job);
          showNotice(reply.error === 'already_active' ? words().duplicate : words().reconnect);
        }
      })
      .catch(async (error: unknown) => {
        if (!selectedJob && errorCode(error) !== 'cancelled') {
          invalidSource = true;
          control.prepareError = errorCode(error);
        }
        if (selectedJob && selectedJob.state === 'queued') {
          selectedJob.error = errorCode(error);
          selectedJob.state = selectedJob.error === 'cancelled' ? 'cancelled' : 'failed';
          await finish(selectedJob);
        }
        if (errorCode(error) !== 'cancelled' && (!selectedJob || selectedJob.state === 'failed'))
          showNotice(failureNotice(errorCode(error)));
      })
      .finally(() => {
        selections.delete(key);
        pendingSources.delete(source);
        control.selecting = false;
        if (!transferred) {
          if (liveControl(control) && !invalidSource) control.source = source;
          else source.dispose?.();
        }
        if (liveControl(control)) paint(control);
      });
  }
  function add(candidate: MediaCandidate) {
    const host = document.createElement('span');
    host.dataset.tadControl = candidate.key;
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = buttonStyle;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = ARROW;
    shadow.append(style, button);
    const previousPosition = candidate.anchor.style.position;
    const positionChanged = getComputedStyle(candidate.anchor).position === 'static';
    if (positionChanged) candidate.anchor.style.position = 'relative';
    candidate.anchor.append(host);
    const control: Control = {
      candidate,
      host,
      button,
      preparing: false,
      selecting: false,
      previousPosition,
      positionChanged,
    };
    controls.set(candidate.key, control);
    button.addEventListener('mousedown', (event) => event.stopPropagation());
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      if (!event.isTrusted) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const old = control.jobId && jobs.get(control.jobId);
      if (old && ['failed', 'completed', 'cancelled', 'skipped'].includes(old.state)) {
        event.preventDefault();
        event.stopPropagation();
        void prepareAgain(control);
        return;
      }
      selectDestination(control, event);
    });
    void prepare(control);
  }
  function scan() {
    scanTimer = undefined;
    if (disposed || !document.body) return;
    let candidates: MediaCandidate[];
    try {
      candidates = adapter.discover();
    } catch {
      return;
    }
    const live = new Map<string, MediaCandidate>();
    for (const candidate of candidates)
      if (!live.has(candidate.key)) live.set(candidate.key, candidate);
    for (const [key, control] of controls) {
      if (
        live.get(key)?.anchor !== control.candidate.anchor ||
        !control.candidate.anchor.isConnected ||
        !control.host.isConnected
      ) {
        removeControl(control);
        controls.delete(key);
      }
    }
    for (const candidate of live.values()) if (!controls.has(candidate.key)) add(candidate);
  }
  function scheduleScan() {
    if (!scanTimer && !disposed) scanTimer = setTimeout(scan, 180);
  }
  function paintLauncher() {
    const button = launcher?.shadowRoot?.querySelector('button');
    if (button) button.textContent = words() === copy.ru ? 'Скачать несколько' : 'Download several';
  }
  bridge.handleCommands(async (command): Promise<CommandReply> => {
    if (disposed) return { ok: false };
    if (command.type === 'open_batch') return { ok: !!openBatch() };
    if (command.type === 'retry_batch') {
      const retries = command.jobIds
        .map((id) => jobs.get(id))
        .filter((job): job is PageJob => !!job && ['failed', 'cancelled'].includes(job.state));
      const accepted = openBatch(retries);
      return { ok: accepted > 0, accepted, rejected: command.jobIds.length - accepted };
    }
    if (command.type === 'probe')
      return {
        ok: true,
        jobs: [...jobs.values()].map(({ id, state, bytes, total, error, destinationName }) => ({
          id,
          state,
          bytes,
          total,
          error,
          destinationName,
        })),
      };
    if (command.type === 'settings') {
      settings = command.settings;
      batchPanel.updateSettings(settings);
      paintLauncher();
      for (const control of controls.values()) paint(control);
      return { ok: true };
    }
    const job = jobs.get(command.jobId);
    if (!job) return { ok: false };
    if (command.type === 'start') {
      if (job.state === 'queued') void run(job);
      return { ok: ['queued', 'downloading', 'finalizing'].includes(job.state) };
    }
    if (command.type === 'cancel') {
      return { ok: cancel(job) };
    }
    if (command.type === 'retry') {
      const control = [...controls.values()].find(
        (entry) => entry.candidate.key === job.candidate.key,
      );
      if (!control || ['queued', 'downloading', 'finalizing'].includes(job.state))
        return { ok: false };
      void prepareAgain(control);
      return { ok: true };
    }
    return { ok: false };
  });
  const initialize = () => {
    if (disposed || observer) return;
    launcher = document.createElement('div');
    launcher.dataset.tadBatchLauncher = 'true';
    launcher.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:2147483640';
    const shadow = launcher.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent =
      'button{font:600 13px system-ui;border:1px solid #70cddd;border-radius:24px;padding:10px 16px;background:#103947;color:white;cursor:pointer;box-shadow:0 2px 12px #0003}button:focus-visible{outline:3px solid #51cee5;outline-offset:3px}';
    const button = document.createElement('button');
    button.type = 'button';
    button.onclick = (event) => {
      if (event.isTrusted) openBatch();
    };
    shadow.append(style, button);
    document.documentElement.append(launcher);
    paintLauncher();
    observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => {
        const element =
          mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (
          element?.closest(
            '[data-tad-control],[data-tad-notice],[data-tad-batch],[data-tad-batch-launcher]',
          )
        )
          return false;
        if (element?.closest('#MiddleColumn,.bubbles,#MediaViewer,.media-viewer-whole'))
          return true;
        return [...mutation.addedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches('#MiddleColumn,.bubbles,#MediaViewer,.media-viewer-whole') ||
              node.querySelector('#MiddleColumn,.bubbles,#MediaViewer,.media-viewer-whole')),
        );
      });
      if (relevant) scheduleScan();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-mid', 'data-peer-id', 'data-message-id', 'data-list-key', 'open'],
    });
    void handshake();
    scan();
    for (const ms of [1_000, 3_000, 7_000])
      startupTimers.push(
        setTimeout(() => {
          scheduleScan();
          if (!connected) void handshake();
        }, ms),
      );
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('pagehide', dispose);
    document.removeEventListener('DOMContentLoaded', initialize);
    observer?.disconnect();
    if (scanTimer) clearTimeout(scanTimer);
    startupTimers.forEach(clearTimeout);
    for (const pending of preparationQueue.splice(0)) pending.resolve(false);
    for (const control of controls.values()) {
      removeControl(control);
    }
    controls.clear();
    notice?.remove();
    launcher?.remove();
    batchPanel.dispose();
    batchCandidates.clear();
    for (const source of pendingSources) source.dispose?.();
    pendingSources.clear();
    for (const job of jobs.values()) {
      // Page teardown can still stop finalization before the atomic close begins.
      // A close already in flight may commit; transferToWriter reports its actual result.
      if (job.state === 'finalizing') job.controller.abort();
      cancel(job);
      if (job.state === 'cancelled') void finish(job);
    }
    adapter.dispose();
    bridge.dispose();
  }
  window.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
