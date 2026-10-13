import {
  CHANNEL,
  commandSchema,
  donationStateSchema,
  isRecord,
  pageRequestSchema,
  settingsSchema,
} from '../src/bridge/protocol';
import { createDonationNotice } from '../src/ui/donation-notice';

export default defineContentScript({
  matches: ['https://web.telegram.org/a/*', 'https://web.telegram.org/k/*'],
  runAt: 'document_start',
  main(ctx) {
    let sessionId: string | undefined;
    const donationNotice = createDonationNotice(async (action) => {
      const response: unknown = await chrome.runtime.sendMessage({
        scope: 'tad-donation',
        ...action,
      });
      return { ok: isRecord(response) && response.ok === true };
    });
    ctx.onInvalidated(() => donationNotice.dispose());
    const pending = new Map<
      string,
      { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }
    >();
    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== location.origin || !isRecord(event.data))
        return;
      const data = event.data;
      if (data.channel !== CHANNEL) return;
      if (
        data.direction === 'page-response' &&
        data.sessionId === sessionId &&
        typeof data.requestId === 'string'
      ) {
        const request = pending.get(data.requestId);
        if (request) {
          clearTimeout(request.timer);
          pending.delete(data.requestId);
          request.resolve(data.payload);
        }
        return;
      }
      const parsed = pageRequestSchema.safeParse(data);
      if (!parsed.success) return;
      const message = parsed.data;
      if (!sessionId && message.payload.type === 'hello') sessionId = message.sessionId;
      if (sessionId !== message.sessionId) return;
      void chrome.runtime
        .sendMessage({ scope: 'tad-page', sessionId, payload: message.payload })
        .then((payload: unknown) => {
          window.postMessage(
            {
              channel: CHANNEL,
              direction: 'extension-response',
              sessionId,
              requestId: message.requestId,
              payload,
            },
            location.origin,
          );
        })
        .catch(() => {
          window.postMessage(
            {
              channel: CHANNEL,
              direction: 'extension-response',
              sessionId,
              requestId: message.requestId,
              payload: { ok: false, error: 'extension_unavailable' },
            },
            location.origin,
          );
        });
    });
    chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
      if (
        sender.id === chrome.runtime.id &&
        isRecord(message) &&
        message.scope === 'tad-donation'
      ) {
        const donation = donationStateSchema.safeParse(message.donation);
        const settings = settingsSchema.safeParse(message.settings);
        if (!donation.success || !settings.success) return false;
        donationNotice.update(donation.data, settings.data);
        respond({ ok: true });
        return false;
      }
      if (
        sender.id !== chrome.runtime.id ||
        !isRecord(message) ||
        message.scope !== 'tad-control' ||
        message.sessionId !== sessionId
      )
        return false;
      const command = commandSchema.safeParse(message.command);
      if (!command.success) return false;
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(requestId);
        respond({ ok: false, error: 'source_unavailable' });
      }, 10_000);
      pending.set(requestId, { resolve: respond, timer });
      window.postMessage(
        {
          channel: CHANNEL,
          direction: 'extension-command',
          sessionId,
          requestId,
          command: command.data,
        },
        location.origin,
      );
      return true;
    });
  },
});
