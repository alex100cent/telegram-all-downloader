import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { JobStore, openDatabase } from '../src/storage/database';
import type { JobRecord } from '../src/domain/jobs';
import { openDB } from 'idb';
import { pendingDonationMilestone } from '../src/domain/donations';

function record(id: string, key = id): JobRecord {
  return {
    id,
    key,
    media: {
      identity: { client: 'a', accountId: '1', peerId: '2', messageId: id, mediaId: id },
      kind: 'audio',
      filename: 'test.mp3',
      mimeType: 'audio/mpeg',
      byteSize: 100,
    },
    state: 'queued',
    bytes: 0,
    total: 100,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tabId: 1,
    sessionId: 'session',
    attempt: 1,
  };
}
function create() {
  const database = openDatabase(crypto.randomUUID());
  return { database, store: new JobStore(database) };
}
describe('persistent queue', () => {
  it('allows just one executor despite simultaneous claim requests', async () => {
    const { store } = create();
    await store.enqueue(record('one'));
    await store.enqueue(record('two'));
    const results = await Promise.all([store.claimNext(), store.claimNext()]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('deduplicates across tabs and keeps the earlier record', async () => {
    const { store } = create();
    await store.enqueue(record('one', 'same'));
    const duplicate = await store.enqueue({ ...record('two', 'same'), tabId: 2 });
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.job.id).toBe('one');
  });
  it('persists running work when the coordinator is recreated', async () => {
    const { store, database } = create();
    await store.enqueue(record('one'));
    await store.claimNext();
    expect((await new JobStore(database).get('one'))?.state).toBe('downloading');
    expect(await new JobStore(database).claimNext()).toBeUndefined();
  });
  it('rejects stale sessions, backward progress, and unconfirmed completion', async () => {
    const { store } = create();
    await store.enqueue(record('one'));
    await store.claimNext();
    expect(await store.update('one', 'other', { bytes: 20 })).toBe(false);
    await store.update('one', 'session', { bytes: 50 });
    expect(await store.update('one', 'session', { bytes: 10 })).toBe(false);
    expect(await store.update('one', 'session', { bytes: 100, state: 'completed' })).toBe(false);
    await store.update('one', 'session', { bytes: 100, state: 'finalizing' });
    expect(await store.update('one', 'session', { bytes: 100, state: 'completed' })).toBe(true);
    expect(await store.update('one', 'session', { state: 'failed' })).toBe(false);
  });
  it('marks source-dependent tasks interrupted on tab replacement', async () => {
    const { store } = create();
    await store.connect({ tabId: 1, sessionId: 'session', client: 'a', ready: true });
    await store.enqueue(record('one'));
    await store.claimNext();
    await store.connect({ tabId: 1, sessionId: 'new', client: 'a', ready: true });
    expect((await store.get('one'))?.state).toBe('interrupted');
    expect(await store.claimNext()).toBeUndefined();
  });
  it('does not erase a known total when a progress sample omits it', async () => {
    const { store } = create();
    await store.enqueue(record('one'));
    await store.claimNext();
    await store.update('one', 'session', { bytes: 50, total: undefined });
    expect((await store.get('one'))?.total).toBe(100);
  });
  it('clears history without deleting queued jobs or saved files', async () => {
    const { store } = create();
    await store.enqueue(record('one'));
    await store.enqueue(record('two'));
    await store.update('one', 'session', { state: 'cancelled' });
    await store.clearTerminal();
    expect((await store.all()).map((job) => job.id)).toEqual(['two']);
  });
});

async function complete(store: JobStore, id: string) {
  await store.enqueue(record(id));
  await store.claimNext();
  await store.update(id, 'session', { state: 'finalizing', bytes: 100 });
  return store.update(id, 'session', { state: 'completed', bytes: 100 });
}

describe('donation milestones', () => {
  it('counts only committed downloads and keeps the latest pending multiple of twenty', async () => {
    const { store } = create();
    for (let i = 1; i <= 19; i++) await complete(store, String(i));
    expect(pendingDonationMilestone(await store.donation())).toBeUndefined();
    await complete(store, '20');
    expect(pendingDonationMilestone(await store.donation())).toBe(20);
    await store.dismissDonation(20);
    expect(pendingDonationMilestone(await store.donation())).toBeUndefined();
    for (let i = 21; i <= 40; i++) await complete(store, String(i));
    expect(pendingDonationMilestone(await store.donation())).toBe(40);
  });

  it('deduplicates concurrent completion reports atomically with the job state', async () => {
    const { store } = create();
    await store.enqueue(record('one'));
    await store.claimNext();
    await store.update('one', 'session', { state: 'finalizing', bytes: 100 });
    const results = await Promise.all([
      store.update('one', 'session', { state: 'completed', bytes: 100 }),
      store.update('one', 'session', { state: 'completed', bytes: 100 }),
    ]);
    expect(results.sort()).toEqual([false, true]);
    expect((await store.get('one'))?.state).toBe('completed');
    expect(await store.donation()).toEqual({ completedDownloads: 1, dismissedMilestone: 0 });
  });

  it.each(['failed', 'cancelled', 'interrupted', 'skipped'] as const)(
    'does not count %s jobs or invalid completion',
    async (state) => {
      const { store } = create();
      await store.enqueue(record('one'));
      await store.claimNext();
      expect(await store.update('one', 'session', { state: 'completed', bytes: 100 })).toBe(false);
      await store.update('one', 'session', { state });
      expect((await store.donation()).completedDownloads).toBe(0);
    },
  );

  it('preserves lifetime counts through restart, history clearing, pruning, and replay', async () => {
    const name = crypto.randomUUID();
    const database = openDatabase(name);
    const store = new JobStore(database);
    await complete(store, 'one');
    await store.clearTerminal();
    expect(await store.update('one', 'session', { state: 'completed', bytes: 100 })).toBe(false);
    await complete(store, 'two');
    await store.prune(false);
    (await database).close();
    const reopened = openDatabase(name);
    const restored = new JobStore(reopened);
    expect(await restored.all()).toEqual([]);
    expect(await restored.donation()).toEqual({ completedDownloads: 2, dismissedMilestone: 0 });
    (await reopened).close();
  });

  it('dismisses only the requested milestone and rejects future or invalid acknowledgements', async () => {
    const { store, database } = create();
    await (
      await database
    ).put('donation', { completedDownloads: 40, dismissedMilestone: 0 }, 'state');
    expect(await store.dismissDonation(20)).toBe(true);
    expect(pendingDonationMilestone(await store.donation())).toBe(40);
    for (const value of [0, -20, 21, 20, 60, NaN])
      expect(await store.dismissDonation(value)).toBe(false);
    expect((await store.donation()).dismissedMilestone).toBe(20);
    expect(await store.dismissDonation(40)).toBe(true);
    expect(pendingDonationMilestone(await store.donation())).toBeUndefined();
  });

  it('upgrades existing installs without inferring a counter from old download history', async () => {
    const name = crypto.randomUUID();
    const old = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('jobs', { keyPath: 'id' }).createIndex('key', 'key');
        db.createObjectStore('connections', { keyPath: 'tabId' });
      },
    });
    await old.put('jobs', { ...record('old'), state: 'completed', bytes: 100 });
    old.close();
    const upgraded = openDatabase(name);
    const store = new JobStore(upgraded);
    expect((await store.get('old'))?.state).toBe('completed');
    expect(await store.donation()).toEqual({ completedDownloads: 0, dismissedMilestone: 0 });
    await complete(store, 'new');
    expect((await store.donation()).completedDownloads).toBe(1);
    (await upgraded).close();
  });
});
