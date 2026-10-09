import { mediaIdFromUrl } from './model';

export function observeMediaCache(onBlob: (blob: Blob, mediaId: string) => void): () => void {
  if (typeof Cache === 'undefined') return () => undefined;
  const originalMatch = Cache.prototype.match;
  const wrapper: Cache['match'] = function (this: Cache, request, options) {
    const url =
      typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    let mediaId: string | undefined;
    try {
      const parsed = new URL(url, location.href);
      if (parsed.origin === location.origin) mediaId = mediaIdFromUrl(parsed.pathname);
    } catch {
      /* Ignore non-media cache keys. */
    }
    const result = originalMatch.call(this, request, options);
    if (!mediaId) return result;
    return result.then((response) => {
      if (!response) return response;
      const blob = response.blob;
      response.blob = async function () {
        const value = await blob.call(this);
        onBlob(value, mediaId!);
        return value;
      };
      return response;
    });
  };
  Cache.prototype.match = wrapper;
  return () => {
    if (Cache.prototype.match === wrapper) Cache.prototype.match = originalMatch;
  };
}
