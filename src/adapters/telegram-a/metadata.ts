import { object, type JsonObject } from './model';

const mediaFields = [
  'id',
  'mediaType',
  'size',
  'fileName',
  'mimeType',
  'isRound',
  'isGif',
  'isLottie',
  'isVideo',
];
const mediaTypes = ['photo', 'video', 'audio', 'voice', 'document', 'sticker'];

export function removed(value: unknown): boolean {
  const data = object(value);
  return value === null || data?.__delete === true || data?.__deleteAllChildren === true;
}

function primitive(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value);
}

function selectFields(value: unknown, fields: string[]): JsonObject | undefined {
  const data = object(value);
  if (!data) return;
  if (data.__delete === true) return { __delete: true };
  if (data.__deleteAllChildren === true) return { __deleteAllChildren: true };
  const selected: JsonObject = {};
  for (const field of fields) {
    if (!(field in data)) continue;
    const item = data[field];
    if (primitive(item)) selected[field] = item;
    else if (removed(item)) selected[field] = { __delete: true };
  }
  return selected;
}

export function messageMetadata(value: unknown): JsonObject | undefined {
  const data = object(value);
  if (!data) return;
  const selected = selectFields(data, ['id', 'chatId'])!;
  if (removed(selected)) return selected;
  if (!('content' in data)) return selected;
  if (removed(data.content) || data.content === undefined) {
    selected.content = { __delete: true };
    return selected;
  }
  const content = object(data.content);
  if (!content) return selected;
  const selectedContent: JsonObject = {};
  if ('ttlSeconds' in content) {
    selectedContent.ttlSeconds = primitive(content.ttlSeconds)
      ? content.ttlSeconds
      : { __delete: true };
  }
  for (const type of mediaTypes) {
    if (!(type in content)) continue;
    selectedContent[type] = selectFields(content[type], mediaFields) ?? { __delete: true };
  }
  selected.content = selectedContent;
  return selected;
}

export function patchMetadata(previous: JsonObject | undefined, patch: JsonObject): JsonObject {
  const result: JsonObject = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    if (removed(value) || value === undefined) {
      delete result[key];
      continue;
    }
    const child = object(value);
    result[key] = child ? patchMetadata(object(result[key]), child) : value;
  }
  return result;
}
