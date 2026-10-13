import { openDB, type DBSchema } from 'idb';
import { ACTIVE_STATES, type JobRecord } from '../domain/jobs';
import type { TelegramClient } from '../domain/media';
import { DEFAULT_DONATION_STATE, DONATION_INTERVAL, type DonationState } from '../domain/donations';

export interface Connection {
  tabId: number;
  sessionId: string;
  client: TelegramClient;
  ready: boolean;
}
interface Database extends DBSchema {
  jobs: { key: string; value: JobRecord; indexes: { key: string } };
  connections: { key: number; value: Connection };
  donation: { key: string; value: DonationState };
}
export function openDatabase(name = 'telegram-all-downloader') {
  return openDB<Database>(name, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('jobs', { keyPath: 'id' }).createIndex('key', 'key');
        db.createObjectStore('connections', { keyPath: 'tabId' });
      }
      if (oldVersion < 2) db.createObjectStore('donation');
    },
  });
}
export type DatabasePromise = ReturnType<typeof openDatabase>;

export class JobStore {
  constructor(private readonly database: DatabasePromise) {}
  async donation(): Promise<DonationState> {
    return (await (await this.database).get('donation', 'state')) ?? { ...DEFAULT_DONATION_STATE };
  }
  async dismissDonation(milestone: number): Promise<boolean> {
    const tx = (await this.database).transaction('donation', 'readwrite');
    const state = (await tx.store.get('state')) ?? { ...DEFAULT_DONATION_STATE };
    if (
      !Number.isSafeInteger(milestone) ||
      milestone <= state.dismissedMilestone ||
      milestone % DONATION_INTERVAL !== 0 ||
      milestone > state.completedDownloads
    ) {
      await tx.done;
      return false;
    }
    await tx.store.put({ ...state, dismissedMilestone: milestone }, 'state');
    await tx.done;
    return true;
  }
  async all(): Promise<JobRecord[]> {
    return (await (await this.database).getAll('jobs')).sort((a, b) => b.createdAt - a.createdAt);
  }
  async get(id: string): Promise<JobRecord | undefined> {
    return (await this.database).get('jobs', id);
  }
  async enqueue(job: JobRecord): Promise<{ accepted: boolean; job: JobRecord }> {
    const db = await this.database;
    const tx = db.transaction('jobs', 'readwrite');
    const same = await tx.store.index('key').getAll(job.key);
    const duplicate = same.find((entry) => ACTIVE_STATES.includes(entry.state));
    if (duplicate) {
      await tx.done;
      return { accepted: false, job: duplicate };
    }
    if (await tx.store.get(job.id)) {
      await tx.done;
      throw new Error('Duplicate job ID');
    }
    job.attempt = Math.max(0, ...same.map((entry) => entry.attempt)) + 1;
    await tx.store.put(job);
    await tx.done;
    return { accepted: true, job };
  }
  async claimNext(): Promise<JobRecord | undefined> {
    const tx = (await this.database).transaction('jobs', 'readwrite');
    const jobs = await tx.store.getAll();
    if (jobs.some((job) => job.state === 'downloading' || job.state === 'finalizing')) {
      await tx.done;
      return;
    }
    const next = jobs
      .filter((job) => job.state === 'queued')
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (next) {
      next.state = 'downloading';
      next.updatedAt = Date.now();
      await tx.store.put(next);
    }
    await tx.done;
    return next;
  }
  async update(
    id: string,
    sessionId: string,
    patch: Partial<Pick<JobRecord, 'state' | 'bytes' | 'total' | 'error' | 'destinationName'>>,
  ): Promise<boolean> {
    const tx = (await this.database).transaction(['jobs', 'donation'], 'readwrite');
    const jobs = tx.objectStore('jobs');
    const job = await jobs.get(id);
    if (!job || job.sessionId !== sessionId || !ACTIVE_STATES.includes(job.state)) {
      await tx.done;
      return false;
    }
    if (patch.bytes !== undefined && patch.bytes < job.bytes) {
      await tx.done;
      return false;
    }
    if (job.total !== undefined && patch.total !== undefined && patch.total !== job.total) {
      await tx.done;
      return false;
    }
    const bytes = patch.bytes ?? job.bytes;
    const total = patch.total ?? job.total;
    if (total !== undefined && bytes > total) {
      await tx.done;
      return false;
    }
    if (
      patch.state === 'completed' &&
      (job.state !== 'finalizing' || (total !== undefined && bytes !== total))
    ) {
      await tx.done;
      return false;
    }
    if (
      job.state === 'queued' &&
      (patch.state === 'downloading' || patch.state === 'finalizing' || patch.state === 'completed')
    ) {
      await tx.done;
      return false;
    }
    if (job.state === 'finalizing' && patch.state === 'downloading') {
      await tx.done;
      return false;
    }
    await jobs.put({ ...job, ...patch, bytes, total, updatedAt: Date.now() });
    if (patch.state === 'completed') {
      const donation = tx.objectStore('donation');
      const state = (await donation.get('state')) ?? { ...DEFAULT_DONATION_STATE };
      await donation.put(
        {
          ...state,
          completedDownloads: Math.min(Number.MAX_SAFE_INTEGER, state.completedDownloads + 1),
        },
        'state',
      );
    }
    await tx.done;
    return true;
  }
  async disconnect(tabId: number, sessionId?: string): Promise<void> {
    const db = await this.database;
    const tx = db.transaction(['jobs', 'connections'], 'readwrite');
    for (const job of await tx.objectStore('jobs').getAll()) {
      if (
        job.tabId === tabId &&
        (!sessionId || job.sessionId === sessionId) &&
        ACTIVE_STATES.includes(job.state)
      ) {
        await tx.objectStore('jobs').put({
          ...job,
          state: 'interrupted',
          error: 'source_unavailable',
          updatedAt: Date.now(),
        });
      }
    }
    const connection = await tx.objectStore('connections').get(tabId);
    if (connection && (!sessionId || connection.sessionId === sessionId))
      await tx.objectStore('connections').delete(tabId);
    await tx.done;
  }
  async connect(connection: Connection): Promise<void> {
    const db = await this.database;
    const old = await db.get('connections', connection.tabId);
    if (old && old.sessionId !== connection.sessionId)
      await this.disconnect(old.tabId, old.sessionId);
    await db.put('connections', connection);
  }
  async connections(): Promise<Connection[]> {
    return (await this.database).getAll('connections');
  }
  async clearTerminal(): Promise<void> {
    await this.prune(false);
  }
  async prune(keepHistory: boolean): Promise<void> {
    const tx = (await this.database).transaction('jobs', 'readwrite');
    const jobs = (await tx.store.getAll()).sort((a, b) => b.createdAt - a.createdAt);
    let terminalCount = 0;
    for (const job of jobs) {
      if (ACTIVE_STATES.includes(job.state)) continue;
      if (!keepHistory || ++terminalCount > 500 || job.updatedAt < Date.now() - 30 * 86400_000)
        await tx.store.delete(job.id);
    }
    await tx.done;
  }
}
