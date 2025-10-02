/**
 * UpstreamSuccess represents a successful response from upstream.
 */
export interface UpstreamSuccess<T> {
  ok: true;
  status: number;
  body: T;
  headers: Headers;
}

/**
 * UpstreamFailure represents a failed response from upstream.
 */
export interface UpstreamFailure {
  ok: false;
  status: number;
  error: unknown;
  body?: unknown;
  headers: Headers;
}

/**
 * UpstreamResult is a discriminated union for upstream responses.
 */
export type UpstreamResult<T> = UpstreamSuccess<T> | UpstreamFailure;

/**
 * HttpClientOptions configures the HTTP client behavior.
 */
export interface HttpClientOptions {
  timeoutMs: number;
  baseUrl: string;
}
