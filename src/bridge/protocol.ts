import { z } from 'zod';
import { DONATION_INTERVAL } from '../domain/donations';

export const CHANNEL = 'telegram-all-downloader:v1';
export const idSchema = z.string().min(1).max(128);
const byteCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const errorSchema = z.enum([
  'unsupported_client',
  'source_unavailable',
  'account_changed',
  'ambiguous_media',
  'invalid_response',
  'network_error',
  'timeout',
  'file_too_large',
  'disk_error',
  'cancelled',
  'destination_required',
]);
export const mediaSchema = z.object({
  identity: z.object({
    client: z.enum(['a', 'k']),
    accountId: idSchema,
    peerId: idSchema,
    messageId: idSchema,
    mediaId: idSchema,
    variant: idSchema.optional(),
  }),
  kind: z.enum([
    'photo',
    'video',
    'audio',
    'voice',
    'round-video',
    'animation',
    'document',
    'sticker',
  ]),
  filename: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(128),
  byteSize: byteCount.optional(),
  sourceUrl: z
    .string()
    .max(1024)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.origin === 'https://web.telegram.org' && /^\/(a|k)\//.test(url.pathname);
      } catch {
        return false;
      }
    })
    .optional(),
});
export const settingsSchema = z.object({
  language: z.enum(['auto', 'ru', 'en']),
  theme: z.enum(['system', 'light', 'dark']),
  keepHistory: z.boolean(),
  donationReminders: z.boolean().default(true),
});
const donationMilestoneSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .multipleOf(DONATION_INTERVAL);
export const donationStateSchema = z.object({
  completedDownloads: byteCount,
  dismissedMilestone: byteCount,
});
export const donationRequestSchema = z.discriminatedUnion('type', [
  z.object({
    scope: z.literal('tad-donation'),
    type: z.literal('dismiss_donation'),
    milestone: donationMilestoneSchema,
  }),
  z.object({ scope: z.literal('tad-donation'), type: z.literal('disable_donation_reminders') }),
]);
export const pagePayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), client: z.enum(['a', 'k']), ready: z.boolean() }),
  z.object({
    type: z.literal('enqueue'),
    jobId: idSchema,
    media: mediaSchema,
    batchId: idSchema.optional(),
    batchLabel: z.string().min(1).max(128).optional(),
  }),
  z.object({
    type: z.literal('progress'),
    jobId: idSchema,
    bytes: byteCount,
    total: byteCount.optional(),
    state: z.enum(['downloading', 'finalizing']),
    destinationName: z.string().min(1).max(512).optional(),
  }),
  z.object({
    type: z.literal('finish'),
    jobId: idSchema,
    bytes: byteCount,
    state: z.enum(['completed', 'failed', 'cancelled', 'skipped']),
    error: errorSchema.optional(),
  }),
]);
export const pageRequestSchema = z.object({
  channel: z.literal(CHANNEL),
  direction: z.literal('page-request'),
  requestId: idSchema,
  sessionId: idSchema,
  payload: pagePayloadSchema,
});
export const uiRequestSchema = z.discriminatedUnion('type', [
  z.object({ scope: z.literal('tad-ui'), type: z.literal('list') }),
  z.object({
    scope: z.literal('tad-ui'),
    type: z.literal('dismiss_donation'),
    milestone: donationMilestoneSchema,
  }),
  z.object({ scope: z.literal('tad-ui'), type: z.literal('disable_donation_reminders') }),
  z.object({
    scope: z.literal('tad-ui'),
    type: z.literal('open_batch'),
    tabId: z.number().int().nonnegative(),
  }),
  z.object({
    scope: z.literal('tad-ui'),
    type: z.literal('batch_action'),
    action: z.enum(['cancel', 'retry']),
    ids: z.array(idSchema).min(1).max(200),
  }),
  z.object({
    scope: z.literal('tad-ui'),
    type: z.enum(['cancel', 'retry', 'open_source']),
    id: idSchema,
  }),
  z.object({ scope: z.literal('tad-ui'), type: z.literal('clear_history') }),
  z.object({ scope: z.literal('tad-ui'), type: z.literal('settings'), settings: settingsSchema }),
]);
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open_batch') }),
  z.object({ type: z.literal('retry_batch'), jobIds: z.array(idSchema).min(1).max(200) }),
  z.object({ type: z.enum(['start', 'cancel', 'retry']), jobId: idSchema }),
  z.object({ type: z.literal('probe') }),
  z.object({ type: z.literal('settings'), settings: settingsSchema }),
]);
export const commandReplySchema = z.object({
  ok: z.boolean(),
  accepted: z.number().int().min(0).max(200).optional(),
  rejected: z.number().int().min(0).max(200).optional(),
  error: z.string().max(128).optional(),
  jobs: z
    .array(
      z
        .object({
          id: idSchema,
          state: z.enum([
            'queued',
            'downloading',
            'finalizing',
            'completed',
            'failed',
            'cancelled',
            'interrupted',
            'skipped',
          ]),
          bytes: byteCount.optional(),
          total: byteCount.optional(),
          error: errorSchema.optional(),
          destinationName: z.string().min(1).max(512).optional(),
        })
        .refine(
          (job) => job.total === undefined || job.bytes === undefined || job.bytes <= job.total,
        )
        .refine(
          (job) =>
            job.state !== 'completed' ||
            (job.bytes !== undefined && (job.total === undefined || job.bytes === job.total)),
        ),
    )
    .max(500)
    .optional(),
});
export type PagePayload = z.infer<typeof pagePayloadSchema>;
export type Command = z.infer<typeof commandSchema>;
export interface CommandReply {
  ok: boolean;
  accepted?: number;
  rejected?: number;
  jobs?: {
    id: string;
    state: string;
    bytes?: number;
    total?: number;
    error?: z.infer<typeof errorSchema>;
    destinationName?: string;
  }[];
  error?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
