export type ErrorCode =
  | 'unsupported_client'
  | 'source_unavailable'
  | 'account_changed'
  | 'ambiguous_media'
  | 'invalid_response'
  | 'network_error'
  | 'timeout'
  | 'file_too_large'
  | 'disk_error'
  | 'cancelled'
  | 'destination_required';

export class DownloadError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string = code,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DownloadError('cancelled');
}

export function errorCode(error: unknown): ErrorCode {
  if (error instanceof DownloadError) return error.code;
  if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
  return 'source_unavailable';
}
