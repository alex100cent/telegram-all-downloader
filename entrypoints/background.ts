import {
  commandReplySchema,
  idSchema,
  isRecord,
  pagePayloadSchema,
  settingsSchema,
  uiRequestSchema,
  type Command,
  type CommandReply,
  type PagePayload,
} from '../src/bridge/protocol';
import { ACTIVE_STATES, DEFAULT_SETTINGS, type JobRecord, type Settings } from '../src/domain/jobs';
import { mediaKey } from '../src/domain/media';
import { JobStore, openDatabase, type Connection } from '../src/storage/database';

export default defineBackground(() => {
  const store = new JobStore(openDatabase());
  let serial: Promise<unknown> = Promise.resolve();
  const sequence = <T>(action: () => Promise<T>): Promise<T> => {
    const result = serial.then(action, action);
    serial = result.catch(() => undefined);
    return result;
  };
  async function settings(): Promise<Settings> {
    const saved = await chrome.storage.local.get('settings');
    const parsed = settingsSchema.safeParse(saved.settings);
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }
  async function command(
    connection: Pick<Connection, 'tabId' | 'sessionId'>,
    value: Command,
  ): Promise<CommandReply> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply: unknown = await Promise.race([
        chrome.tabs.sendMessage(connection.tabId, {
          scope: 'tad-control',
          sessionId: connection.sessionId,
          command: value,
        }),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ ok: false }), 2_000);
        }),
      ]);
      const parsed = commandReplySchema.safeParse(reply);
      return parsed.success ? parsed.data : { ok: false };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }
  }
  async function sourceTabExists(tabId: number): Promise<boolean> {
    try {
      const tab = await chrome.tabs.get(tabId);
      return !!tab.url && /^https:\/\/web\.telegram\.org\/(a|k)\//.test(tab.url);
    } catch {
      return false;
    }
  }
  async function settleSnapshot(
    job: JobRecord,
    state: NonNullable<CommandReply['jobs']>[number],
  ): Promise<boolean> {
    if (
      state.state === 'completed' &&
      typeof state.bytes === 'number' &&
      state.bytes >= job.bytes
    ) {
      const prepared = await store.update(job.id, job.sessionId, {
        state: 'finalizing',
        bytes: state.bytes,
        total: job.total ?? state.bytes,
      });
      if (prepared)
        await store.update(job.id, job.sessionId, { state: 'completed', bytes: state.bytes });
    } else if (state.state === 'failed' || state.state === 'cancelled') {
      await store.update(job.id, job.sessionId, {
        state: state.state,
        error: state.error ?? (state.state === 'cancelled' ? 'cancelled' : 'source_unavailable'),
      });
    } else return false;
    const current = await store.get(job.id);
    return !current || !ACTIVE_STATES.includes(current.state);
  }
  async function reconcile() {
    const jobs = await store.all();
    await Promise.all(
      (await store.connections()).map(async (connection) => {
        const reply = await command(connection, { type: 'probe' });
        if (!reply.ok || !Array.isArray(reply.jobs)) {
          if (!(await sourceTabExists(connection.tabId)))
            await store.disconnect(connection.tabId, connection.sessionId);
          return;
        }
        const live = new Map(reply.jobs.map((entry) => [entry.id, entry]));
        for (const job of jobs) {
          if (
            job.tabId !== connection.tabId ||
            job.sessionId !== connection.sessionId ||
            !ACTIVE_STATES.includes(job.state)
          )
            continue;
          const state = live.get(job.id);
          if (!state)
            await store.update(job.id, job.sessionId, {
              state: 'interrupted',
              error: 'source_unavailable',
            });
          else if (state.state === 'queued' && job.state === 'downloading') {
            await command(connection, { type: 'start', jobId: job.id });
          } else await settleSnapshot(job, state);
        }
      }),
    );
  }
  async function schedule() {
    for (;;) {
      const job = await store.claimNext();
      if (!job) break;
      const result = await command(job, { type: 'start', jobId: job.id });
      if (result.ok) break;
      if (!(await sourceTabExists(job.tabId))) {
        await store.disconnect(job.tabId, job.sessionId);
        continue;
      }
      const probe = await command(job, { type: 'probe' });
      if (
        probe.ok &&
        Array.isArray(probe.jobs) &&
        !probe.jobs.some((entry) => entry.id === job.id)
      ) {
        await store.update(job.id, job.sessionId, {
          state: 'interrupted',
          error: 'source_unavailable',
        });
        continue;
      }
      const snapshot = probe.ok && probe.jobs?.find((entry) => entry.id === job.id);
      if (snapshot && (await settleSnapshot(job, snapshot))) continue;
      // An unresponsive source may still own the writer. Keep its reservation.
      break;
    }
    const count = (await store.all()).filter((job) => ACTIVE_STATES.includes(job.state)).length;
    await chrome.action.setBadgeText({ text: count ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#007c91' });
  }
  async function page(payload: PagePayload, sessionId: string, tabId: number) {
    if (payload.type === 'hello') {
      await store.connect({ tabId, sessionId, client: payload.client, ready: payload.ready });
      await schedule();
      return { ok: true, settings: await settings() };
    }
    const connection = (await store.connections()).find(
      (entry) => entry.tabId === tabId && entry.sessionId === sessionId,
    );
    if (!connection) return { ok: false, error: 'source_unavailable' };
    if (payload.type === 'enqueue') {
      if (payload.media.identity.client !== connection.client)
        return { ok: false, error: 'invalid_response' };
      await reconcile();
      const now = Date.now();
      const job: JobRecord = {
        id: payload.jobId,
        key: mediaKey(payload.media.identity),
        media: payload.media,
        state: 'queued',
        bytes: 0,
        total: payload.media.byteSize,
        createdAt: now,
        updatedAt: now,
        tabId,
        sessionId,
        attempt: 1,
      };
      const result = await store.enqueue(job);
      await schedule();
      return {
        ok: result.accepted,
        job: result.job,
        error: result.accepted ? undefined : 'already_active',
      };
    }
    const current = await store.get(payload.jobId);
    if (!current || current.tabId !== tabId || current.sessionId !== sessionId)
      return { ok: false };
    const changed =
      payload.type === 'progress'
        ? await store.update(payload.jobId, sessionId, {
            bytes: payload.bytes,
            total: payload.total,
            state: payload.state,
          })
        : await store.update(payload.jobId, sessionId, {
            bytes: payload.bytes,
            state: payload.state,
            error: payload.error,
          });
    if (payload.type === 'finish') {
      await store.prune((await settings()).keepHistory);
      await schedule();
    }
    return { ok: changed };
  }
  async function ui(raw: unknown) {
    const request = uiRequestSchema.parse(raw);
    if (request.type === 'list') {
      await reconcile();
      await schedule();
      await store.prune((await settings()).keepHistory);
      return {
        ok: true,
        jobs: await store.all(),
        settings: await settings(),
        connections: await store.connections(),
      };
    }
    if (request.type === 'settings') {
      await chrome.storage.local.set({ settings: request.settings });
      await store.prune(request.settings.keepHistory);
      await Promise.all(
        (await store.connections()).map((connection) =>
          command(connection, { type: 'settings', settings: request.settings }),
        ),
      );
      return { ok: true };
    }
    if (request.type === 'clear_history') {
      await store.clearTerminal();
      return { ok: true };
    }
    const job = await store.get(request.id);
    if (!job) return { ok: false, error: 'source_unavailable' };
    if (request.type === 'cancel') {
      if (!ACTIVE_STATES.includes(job.state)) return { ok: true };
      if (job.state === 'finalizing') return { ok: false, error: 'finalizing' };
      const response = await command(job, { type: 'cancel', jobId: job.id });
      if (!response.ok) {
        if (!(await sourceTabExists(job.tabId))) {
          await store.disconnect(job.tabId, job.sessionId);
          await schedule();
        }
      }
      return response;
    }
    if (request.type === 'retry') {
      const response = await command(job, { type: 'retry', jobId: job.id });
      if (response.ok) {
        await chrome.tabs.update(job.tabId, { active: true });
        return { ok: true };
      }
    }
    if (job.media.sourceUrl) {
      await chrome.tabs.create({ url: job.media.sourceUrl });
      return { ok: true };
    }
    return { ok: false, error: 'source_unavailable' };
  }
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!isRecord(message)) return false;
    if (message.scope === 'tad-page') {
      const parsed = pagePayloadSchema.safeParse(message.payload);
      if (
        !parsed.success ||
        !idSchema.safeParse(message.sessionId).success ||
        sender.id !== chrome.runtime.id ||
        sender.tab?.id === undefined ||
        sender.frameId !== 0 ||
        !sender.url?.match(/^https:\/\/web\.telegram\.org\/(a|k)\//)
      )
        return false;
      if (
        parsed.data.type === 'hello' &&
        new URL(sender.url).pathname.split('/')[1] !== parsed.data.client
      )
        return false;
      const action = () => page(parsed.data, message.sessionId as string, sender.tab!.id!);
      const result =
        parsed.data.type === 'progress' || parsed.data.type === 'finish'
          ? action()
          : sequence(action);
      void result.then(respond).catch(() => respond({ ok: false, error: 'source_unavailable' }));
      return true;
    }
    if (
      message.scope === 'tad-ui' &&
      sender.id === chrome.runtime.id &&
      sender.url === chrome.runtime.getURL('popup.html')
    ) {
      void sequence(() => ui(message))
        .then(respond)
        .catch(() => respond({ ok: false, error: 'source_unavailable' }));
      return true;
    }
    return false;
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void sequence(async () => {
      await store.disconnect(tabId);
      await schedule();
    });
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (
      changeInfo.status === 'loading' ||
      (changeInfo.url && !/^https:\/\/web\.telegram\.org\/(a|k)\//.test(changeInfo.url))
    ) {
      void sequence(async () => {
        await store.disconnect(tabId);
        await schedule();
      });
    }
  });
  chrome.runtime.onStartup.addListener(() => {
    void sequence(async () => {
      await reconcile();
      await schedule();
    });
  });
  void sequence(async () => {
    await reconcile();
    await schedule();
  }).catch(() => undefined);
});
