import { BUILD } from '../build';
import type { JobRecord } from '../domain/jobs';
import { formatBytes, jobProgress } from './format';

interface BrandVersion {
  brand: string;
  version: string;
}
interface UserAgentData {
  brands?: BrandVersion[];
  platform?: string;
  getHighEntropyValues?(hints: string[]): Promise<{
    fullVersionList?: BrandVersion[];
    platform?: string;
    platformVersion?: string;
  }>;
}

export function buildSummary(): string {
  return `Telegram All Downloader ${BUILD.version}, build ${BUILD.id}${BUILD.ciRun ? `, CI #${BUILD.ciRun}` : ', local'}`;
}

export async function detectBrowser(): Promise<string> {
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  try {
    const values = await data?.getHighEntropyValues?.(['fullVersionList', 'platformVersion']);
    const brands = (values?.fullVersionList ?? data?.brands ?? []).filter(
      ({ brand }) => !/not.?a.?brand/i.test(brand),
    );
    const ordered = [
      ...brands.filter(({ brand }) => brand !== 'Chromium'),
      ...brands.filter(({ brand }) => brand === 'Chromium'),
    ];
    const platform = [values?.platform ?? data?.platform, values?.platformVersion]
      .filter(Boolean)
      .join(' ');
    if (ordered.length)
      return [ordered.map(({ brand, version }) => `${brand} ${version}`).join(' / '), platform]
        .filter(Boolean)
        .join(', ');
  } catch {
    /* Fall back to the user agent string below. */
  }
  return navigator.userAgent;
}

export function diagnosticsReport(job: JobRecord, browser: string): string {
  const { total, percent } = jobProgress(job);
  const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(job.media.mimeType)
    ? job.media.mimeType.toLowerCase()
    : 'other';
  return [
    buildSummary(),
    `Browser: ${browser}`,
    `Telegram: Web ${job.media.identity.client.toUpperCase()}`,
    `Attachment: ${job.media.kind}, ${mime}, ${total === undefined ? 'size unknown' : formatBytes(total, 'en')}`,
    `Result: ${job.state}${job.error ? `, ${job.error}` : ''}, ${percent ?? '?'}% transferred, attempt ${job.attempt}`,
  ].join('\n');
}
