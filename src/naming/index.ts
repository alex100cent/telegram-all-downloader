import type { MediaInfo } from '../domain/media';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-tgsticker': 'tgs',
  'text/plain': 'txt',
};
// Media extensions that must not contradict the container Telegram delivers.
const CONTAINERS: Record<string, string> = {
  gif: 'gif',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  mp4: 'mp4',
  m4a: 'mp4',
  m4v: 'mp4',
  mov: 'mp4',
  webm: 'webm',
  mkv: 'webm',
  ogg: 'ogg',
  oga: 'ogg',
  ogv: 'ogg',
  opus: 'ogg',
  mp3: 'mp3',
  flac: 'flac',
  wav: 'wav',
  tgs: 'tgs',
};

export function safeFilename(
  info: Pick<MediaInfo, 'filename' | 'kind' | 'mimeType' | 'identity'>,
): string {
  const extension = EXTENSIONS[info.mimeType.split(';')[0]?.trim().toLowerCase() ?? ''];
  let name = info.filename
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- File names must not contain control characters.
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*‪-‮⁦-⁩]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
    .replace(/\.{2,}/g, '_');
  if (!name) name = `${info.kind}_${info.identity.messageId}`;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  const current = /\.([a-z0-9]{1,12})$/i.exec(name)?.[1]?.toLowerCase();
  const container = current && CONTAINERS[current];
  if (
    extension &&
    (!current || (container && CONTAINERS[extension] && container !== CONTAINERS[extension]))
  )
    name += `.${extension}`;
  const suffix = name.match(/\.[a-z0-9]{1,12}$/i)?.[0] ?? '';
  const stem = suffix ? name.slice(0, -suffix.length) : name;
  const encoder = new TextEncoder();
  let shortened = stem;
  while (encoder.encode(shortened + suffix).length > 180)
    shortened = [...shortened].slice(0, -1).join('');
  return shortened + suffix;
}
