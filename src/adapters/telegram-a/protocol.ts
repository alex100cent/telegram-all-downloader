import { DownloadError, throwIfAborted } from '../../domain/errors';
import { id, object, type JsonObject } from './model';

const PREFIX = 'tad-a:';
const TIMEOUT = 60_000;
type Method = 'downloadMedia' | 'fetchMessage' | 'fetchCurrentUser';
type Pending = { resolve(value: unknown): void; reject(error: unknown): void; cancel(): void };

export interface ProtocolObserver {
  data(value: JsonObject): void;
  state?(value: JsonObject, isPatch: boolean): void;
  outgoing(value: JsonObject): void;
  reset(): void;
  blob(blob: Blob, url: string): void;
}

export class WebAProtocol {
  private readonly pending = new Map<string, Pending>();
  private readonly downloads = new Map<string, string>();
  private readonly cleanups: (() => void)[] = [];
  private readonly originalWorker = window.Worker;
  private readonly originalChannel = window.BroadcastChannel;
  private readonly wrappedWorker: typeof Worker;
  private readonly wrappedChannel?: typeof BroadcastChannel;
  private readonly channel?: BroadcastChannel;
  private worker?: Worker;
  private workerReady = false;
  private disposed = false;
  private readonly token = -Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

  constructor(
    private readonly observer: ProtocolObserver,
    readonly accountSlot: number,
  ) {
    this.wrappedWorker = new Proxy(this.originalWorker, {
      construct: (target, args) => {
        const worker = Reflect.construct(target, args) as Worker;
        this.attach(worker);
        return worker;
      },
    });
    window.Worker = this.wrappedWorker;
    if (typeof this.originalChannel !== 'undefined') {
      this.channel = new this.originalChannel(`tt-global_${accountSlot}`);
      this.channel.addEventListener('message', this.onBroadcast);
      this.wrappedChannel = new Proxy(this.originalChannel, {
        construct: (target, args) => {
          const channel = Reflect.construct(target, args) as BroadcastChannel;
          if (args[0] === `tt-global_${accountSlot}`) this.attachChannel(channel);
          return channel;
        },
      });
      window.BroadcastChannel = this.wrappedChannel;
    }
  }

  private attachChannel(channel: BroadcastChannel): void {
    const post = channel.postMessage;
    const observe = (message: unknown) => {
      const data = object(message);
      if (data?.type === 'callApi') this.observeOutgoing(data);
    };
    const wrapper = function (this: BroadcastChannel, message: unknown) {
      observe(message);
      post.call(this, message);
    };
    channel.postMessage = wrapper;
    channel.addEventListener('message', this.onBroadcast, { capture: true });
    this.cleanups.push(() => {
      channel.removeEventListener('message', this.onBroadcast, { capture: true });
      if (channel.postMessage === wrapper) channel.postMessage = post;
    });
  }

  private attach(worker: Worker): void {
    const post = worker.postMessage;
    const terminate = worker.terminate;
    let initId: string | undefined;
    const observe = (message: unknown) => {
      const envelope = object(message);
      if (Array.isArray(envelope?.payloads)) {
        for (const item of envelope.payloads) {
          const payload = object(item);
          if (!payload) continue;
          if (payload.type === 'initApi') {
            if (this.worker && this.worker !== worker) this.invalidate();
            this.worker = worker;
            this.workerReady = false;
            initId = typeof payload.messageId === 'string' ? payload.messageId : undefined;
          } else if (this.worker === worker && payload.type === 'callMethod') {
            if (payload.name === 'destroy') this.invalidate();
            this.observeOutgoing(payload);
          }
        }
      }
    };
    const wrapper = function (this: Worker, message: unknown, ...rest: unknown[]) {
      observe(message);
      Reflect.apply(post, this, [message, ...rest]);
    } as Worker['postMessage'];
    worker.postMessage = wrapper;
    const onTerminate = () => {
      if (this.worker === worker) {
        this.invalidate();
        this.worker = undefined;
      }
    };
    const terminateWrapper = function (this: Worker) {
      onTerminate();
      terminate.call(this);
    };
    worker.terminate = terminateWrapper;
    const receive = (event: MessageEvent) => {
      if (this.disposed || this.worker !== worker) return;
      const data = object(event.data);
      if (!Array.isArray(data?.payloads)) return;
      const remaining: unknown[] = [];
      for (const item of data.payloads) {
        const payload = object(item);
        if (!payload) {
          remaining.push(item);
          continue;
        }
        if (payload.type === 'methodResponse' && payload.messageId === initId)
          this.workerReady = true;
        if (!this.receive(payload)) remaining.push(item);
      }
      if (!remaining.length) event.stopImmediatePropagation();
      else if (remaining.length !== data.payloads.length) data.payloads = remaining;
    };
    worker.addEventListener('message', receive, { capture: true });
    this.cleanups.push(() => {
      worker.removeEventListener('message', receive, { capture: true });
      if (worker.postMessage === wrapper) worker.postMessage = post;
      if (worker.terminate === terminateWrapper) worker.terminate = terminate;
    });
  }

  private observeOutgoing(payload: JsonObject): void {
    if (payload.name === 'downloadMedia' && Array.isArray(payload.args)) {
      const args = object(payload.args[0]);
      if (typeof payload.messageId === 'string' && typeof args?.url === 'string') {
        this.downloads.set(payload.messageId, args.url);
        if (this.downloads.size > 2000) this.downloads.delete(this.downloads.keys().next().value!);
      }
    }
    this.observer.outgoing(payload);
  }

  private receive(payload: JsonObject): boolean {
    const requestId = typeof payload.messageId === 'string' ? payload.messageId : '';
    if (requestId.startsWith(PREFIX)) {
      const pending = this.pending.get(requestId);
      if (payload.type === 'methodResponse' || payload.type === 'messageResponse') {
        this.downloads.delete(requestId);
        if (payload.error)
          pending?.reject(
            new DownloadError('network_error', 'Telegram could not retrieve this file.', true),
          );
        else pending?.resolve(payload.response);
      }
      return true;
    }
    if (payload.type === 'methodResponse' || payload.type === 'messageResponse') {
      const response = object(payload.response);
      const url = this.downloads.get(requestId);
      if (payload.type === 'methodResponse') this.downloads.delete(requestId);
      if (url && response?.dataBlob instanceof Blob) this.observer.blob(response.dataBlob, url);
      if (response) this.observer.data(response);
    } else if (payload.type === 'updates' && Array.isArray(payload.updates)) {
      for (const update of payload.updates) {
        const data = object(update);
        if (data) this.observer.data(data);
      }
    }
    return false;
  }

  private onBroadcast = (event: MessageEvent): void => {
    const data = object(event.data);
    if (!data || this.disposed) return;
    if (data.type === 'messageResponse' || data.type === 'messageCallback') {
      if (data.token === this.token) this.receive(data);
      else if (data.type === 'messageResponse') this.receive(data);
    } else if (data.type === 'globalUpdate' || data.type === 'globalDiffUpdate') {
      const state = object(data.type === 'globalUpdate' ? data.global : data.diff);
      if (state) this.observer.state?.(state, data.type === 'globalDiffUpdate');
    } else if (data.type === 'callApi') {
      this.observeOutgoing(data);
    }
  };

  async request(method: Method, args: unknown[], signal?: AbortSignal): Promise<unknown> {
    if (this.disposed) throw new DownloadError('source_unavailable');
    if (signal) throwIfAborted(signal);
    if ((!this.worker || !this.workerReady) && !this.channel) {
      throw new DownloadError(
        'source_unavailable',
        'Reload Telegram to connect the downloader.',
        true,
      );
    }
    const requestId = `${PREFIX}${crypto.randomUUID()}`;
    const activeWorker = this.workerReady ? this.worker : undefined;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cancelRemote = () => {
        if (activeWorker)
          activeWorker.postMessage({
            payloads: [{ type: 'cancelProgress', messageId: requestId }],
          });
        else
          this.channel?.postMessage({
            type: 'cancelApiProgress',
            token: this.token,
            messageId: requestId,
          });
      };
      const finish = (error: unknown, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        this.pending.delete(requestId);
        if (error) reject(error);
        else resolve(value);
      };
      const onAbort = () => {
        cancelRemote();
        finish(new DownloadError('cancelled'));
      };
      const timeout = setTimeout(() => {
        cancelRemote();
        finish(
          new DownloadError(
            'timeout',
            'Telegram did not respond. Keep the source tab open and retry.',
            true,
          ),
        );
      }, TIMEOUT);
      this.pending.set(requestId, {
        resolve: (value) => finish(undefined, value),
        reject: (error) => finish(error),
        cancel: cancelRemote,
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const request = {
          messageId: requestId,
          name: method,
          args,
          withCallback: method === 'downloadMedia',
        };
        if (activeWorker)
          activeWorker.postMessage({ payloads: [{ type: 'callMethod', ...request }] });
        else this.channel?.postMessage({ type: 'callApi', token: this.token, ...request });
      } catch {
        finish(
          new DownloadError('source_unavailable', 'The Telegram connection was closed.', true),
        );
      }
    });
  }

  private invalidate(): void {
    this.workerReady = false;
    this.observer.reset();
    for (const pending of this.pending.values())
      pending.reject(new DownloadError('account_changed'));
    this.downloads.clear();
  }

  dispose(): void {
    this.disposed = true;
    for (const pending of this.pending.values()) {
      pending.cancel();
      pending.reject(new DownloadError('cancelled'));
    }
    for (const cleanup of this.cleanups) cleanup();
    if (window.Worker === this.wrappedWorker) window.Worker = this.originalWorker;
    if (this.wrappedChannel && window.BroadcastChannel === this.wrappedChannel)
      window.BroadcastChannel = this.originalChannel;
    this.channel?.close();
    this.downloads.clear();
  }
}

export function accountSlot(url: string): number {
  const value = Number(new URL(url).searchParams.get('account'));
  return Number.isSafeInteger(value) && value > 1 ? value : 1;
}

export function currentUser(value: JsonObject): string | undefined {
  return value['@type'] === 'updateCurrentUser'
    ? id(object(value.currentUser)?.id)
    : id(value.currentUserId);
}
