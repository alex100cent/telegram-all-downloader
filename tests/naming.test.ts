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
  it('does not label a converted MP4 animation as GIF', () => {
    const animation = { ...base, kind: 'animation' as const, mimeType: 'video/mp4' };
    expect(safeFilename({ ...animation, filename: 'party.gif' })).toBe('party.gif.mp4');
    expect(safeFilename({ ...animation, filename: 'party.GIF' })).toBe('party.GIF.mp4');
    expect(safeFilename({ ...animation, filename: 'party.mp4' })).toBe('party.mp4');
    expect(safeFilename({ ...base, filename: 'voice.mp3' })).toBe('voice.mp3.ogg');
  });
  it('keeps names whose extension matches the delivered container or describes a document', () => {
    const name = (filename: string, mimeType: string) =>
      safeFilename({ ...base, kind: 'document', filename, mimeType });
    expect(name('clip.mov', 'video/mp4')).toBe('clip.mov');
    expect(name('song.mp4', 'audio/mp4')).toBe('song.mp4');
    expect(name('voice.oga', 'audio/ogg')).toBe('voice.oga');
    expect(name('sticker.tgs', 'application/x-tgsticker')).toBe('sticker.tgs');
    expect(name('report.pdf', 'application/octet-stream')).toBe('report.pdf');
    expect(name('notes.txt', 'application/pdf')).toBe('notes.txt');
    expect(name('README', 'application/octet-stream')).toBe('README');
    expect(name('sample.tadqa', 'application/octet-stream')).toBe('sample.tadqa');
  });
  it('preserves Unicode and the file extension within a byte limit', () => {
    const name = safeFilename({ ...base, filename: `${'Подкаст'.repeat(40)}.ogg` });
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(180);
    expect(name.endsWith('.ogg')).toBe(true);
  });
});
