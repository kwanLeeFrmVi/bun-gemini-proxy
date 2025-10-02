import { logger } from "../../observability/logger.ts";
import { upstreamDuration } from "../../observability/metrics.ts";
import type { UpstreamResult, HttpClientOptions } from "./types.ts";

/**
 * HttpClient handles low-level HTTP requests with timeout and abort support.
 * Centralizes fetch logic, error handling, and metrics tracking.
 */
export class HttpClient {
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(options: HttpClientOptions) {
    this.timeoutMs = options.timeoutMs;
    this.baseUrl = options.baseUrl;
  }

  /**
   * Execute a GET request with timeout.
   */
  async get(
    endpoint: string,
    headers: Record<string, string> = {},
  ): Promise<UpstreamResult<Record<string, unknown>>> {
    const url = new URL(endpoint, this.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const start = process.hrtime.bigint();

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      upstreamDuration.observe({ endpoint, result: String(response.status) }, diff);

      return await this.parseResponse(response);
    } catch (error) {
      clearTimeout(timeout);
      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      upstreamDuration.observe({ endpoint, result: "error" }, diff);
      logger.error({ error, url: url.toString() }, "HTTP GET request failed");
      return {
        ok: false,
        status: 502,
        error,
        headers: new Headers(),
      };
    }
  }

  /**
   * Execute a POST request with timeout.
   */
  async post(
    endpoint: string,
    body: string | Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<UpstreamResult<Record<string, unknown>>> {
    const url = new URL(endpoint, this.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const start = process.hrtime.bigint();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      upstreamDuration.observe({ endpoint, result: String(response.status) }, diff);

      return await this.parseResponse(response);
    } catch (error) {
      clearTimeout(timeout);
      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      upstreamDuration.observe({ endpoint, result: "error" }, diff);
      logger.error({ error, url: url.toString() }, "HTTP POST request failed");
      return {
        ok: false,
        status: 502,
        error,
        headers: new Headers(),
      };
    }
  }

  /**
   * Execute a POST request and return raw Response for streaming.
   */
  async postStreaming(
    endpoint: string,
    body: string | Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const url = new URL(endpoint, this.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response;
  }

  /**
   * Parse response and handle content types.
   */
  private async parseResponse(
    response: Response,
  ): Promise<UpstreamResult<Record<string, unknown>>> {
    const headers = response.headers;
    const contentType = headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body,
        body,
        headers,
      };
    }

    return {
      ok: true,
      status: response.status,
      body: body as Record<string, unknown>,
      headers,
    };
  }
}
