export class ApiError extends Error {
  readonly status: number;
  readonly data?: unknown;
  readonly url?: string;

  constructor(status: number, message: string, data?: unknown, url?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.url = url;
  }
}

export class NetworkError extends Error {
  readonly url: string;
  readonly cause?: unknown;

  constructor(url: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
    this.url = url;
    this.cause = cause;
  }
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const url = err.url ? ` @ ${err.url}` : '';
    return `${err.message} (HTTP ${err.status})${url}`;
  }
  if (err instanceof NetworkError) {
    return `${err.message} @ ${err.url}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}