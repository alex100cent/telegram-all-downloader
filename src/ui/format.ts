import type { JobRecord } from '../domain/jobs';
import type { Language } from '../i18n';

export function formatBytes(value: number, language: Language): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const power =
    value === 0 ? 0 : Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const unit = Math.max(0, power);
  const amount = new Intl.NumberFormat(language, {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value / 1024 ** unit);
  return `${amount} ${units[unit]}`;
}

export function jobProgress(job: Pick<JobRecord, 'bytes' | 'total' | 'media'>): {
  total?: number;
  percent?: number;
} {
  const total = job.total ?? job.media.byteSize;
  if (total === undefined || !Number.isFinite(total) || total <= 0) return {};
  return { total, percent: Math.min(100, Math.max(0, Math.floor((job.bytes / total) * 100))) };
}

export function formatTimestamp(value: number, language: Language): string {
  return new Intl.DateTimeFormat(language, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}
