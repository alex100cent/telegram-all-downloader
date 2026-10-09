import { describe, expect, it } from 'vitest';
import { safeFilename } from '../src/naming';
import type { MediaInfo } from '../src/domain/media';

const base: MediaInfo = {
  identity: { client: 'k', accountId: '1', peerId: '2', messageId: '3', mediaId: '4' },
  kind: 'voice',
  filename: '',
  mimeType: 'audio/ogg',
};
describe('file names', () => {
  it('uses the real format instead of relabelling voice as mp3', () =>
    expect(safeFilename(base)).toBe('voice_3.ogg'));
  it('removes traversal and reserved names', () => {
    expect(safeFilename({ ...base, filename: '../../bad:name.ogg' })).not.toContain('/');
    expect(safeFilename({ ...base, filename: 'CON.ogg' })).toBe('_CON.ogg');
  });
  it('preserves Unicode and the file extension within a byte limit', () => {
    const name = safeFilename({ ...base, filename: `${'Подкаст'.repeat(40)}.ogg` });
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(180);
    expect(name.endsWith('.ogg')).toBe(true);
  });
});
