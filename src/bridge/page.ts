import {
  CHANNEL,
  commandSchema,
  isRecord,
  type Command,
  type CommandReply,
  type PagePayload,
} from './protocol';

export class PageBridge {
  readonly sessionId = crypto.randomUUID();
  private pending = new Map<
    string,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private onCommand?: (command: Command) => Promise<CommandReply>;
  constructor() {
    window.addEventListener('message', this.receive);
  }
  handleCommands(handler: (command: Command) => Promise<CommandReply>) {
    this.onCommand = handler;
  }
  request(payload: PagePayload): Promise<Record<string, unknown>> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Extension connection timed out'));
      }, 10_000);
      this.pending.set(requestId, { resolve, reject, timer });
      window.postMessage(
        {
          channel: CHANNEL,
          direction: 'page-request',
          sessionId: this.sessionId,
          requestId,
          payload,
        },
        location.origin,
      );
    });
  }
  private receive = (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== location.origin || !isRecord(event.data))
      return;
    const data = event.data;
    if (
      data.channel !== CHANNEL ||
      data.sessionId !== this.sessionId ||
      typeof data.requestId !== 'string'
    )
      return;
    if (data.direction === 'extension-response') {
      const pending = this.pending.get(data.requestId);
      if (!pending || !isRecord(data.payload)) return;
      clearTimeout(pending.timer);
      this.pending.delete(data.requestId);
      pending.resolve(data.payload);
    } else if (data.direction === 'extension-command') {
      // Telegram can apply a meta CSP after document_start, so validation must never JIT.
      const parsed = commandSchema.safeParse(data.command, { jitless: true });
      if (!parsed.success || !this.onCommand) return;
      void this.onCommand(parsed.data)
        .then((payload) => {
          window.postMessage(
            {
              channel: CHANNEL,
              direction: 'page-response',
              sessionId: this.sessionId,
              requestId: data.requestId,
              payload,
            },
            location.origin,
          );
        })
        .catch(() => {
          window.postMessage(
            {
              channel: CHANNEL,
              direction: 'page-response',
              sessionId: this.sessionId,
              requestId: data.requestId,
              payload: { ok: false },
            },
            location.origin,
          );
        });
    }
  };
  dispose() {
    window.removeEventListener('message', this.receive);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Page closed'));
    }
    this.pending.clear();
  }
}
