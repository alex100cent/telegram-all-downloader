import type { ErrorCode } from './errors';
import type { MediaInfo } from './media';

export type JobState =
  | 'queued'
  | 'downloading'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'skipped';
export interface JobRecord {
  id: string;
  key: string;
  media: MediaInfo;
  state: JobState;
  bytes: number;
  total?: number;
  error?: ErrorCode;
  createdAt: number;
  updatedAt: number;
  tabId: number;
  sessionId: string;
  attempt: number;
  batchId?: string;
  batchLabel?: string;
  destinationName?: string;
}
export interface Settings {
  language: 'auto' | 'ru' | 'en';
  theme: 'system' | 'light' | 'dark';
  keepHistory: boolean;
}
export const DEFAULT_SETTINGS: Settings = { language: 'auto', theme: 'system', keepHistory: true };
export const ACTIVE_STATES: JobState[] = ['queued', 'downloading', 'finalizing'];
