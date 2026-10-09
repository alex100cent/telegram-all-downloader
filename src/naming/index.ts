import type { MediaInfo } from '../domain/media';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-tgsticker': 'tgs',
  'text/plain': 'txt',
};

export function safeFilename(
  info: Pick<MediaInfo, 'filename' | 'kind' | 'mimeType' | 'identity'>,
): string {
  const extension = EXTENSIONS[info.mimeType.split(';')[0]?.trim() ?? ''];
  let name = info.filename
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- File names must not contain control characters.
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
    .replace(/\.{2,}/g, '_');
  if (!name) name = `${info.kind}_${info.identity.messageId}`;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  if (!/\.[a-z0-9]{1,12}$/i.test(name) && extension) name += `.${extension}`;
  const suffix = name.match(/\.[a-z0-9]{1,12}$/i)?.[0] ?? '';
  const stem = suffix ? name.slice(0, -suffix.length) : name;
  const encoder = new TextEncoder();
  let shortened = stem;
  while (encoder.encode(shortened + suffix).length > 180)
    shortened = [...shortened].slice(0, -1).join('');
  return shortened + suffix;
}
