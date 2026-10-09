import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { JobStore, openDatabase } from '../src/storage/database';
import type { JobRecord } from '../src/domain/jobs';

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
