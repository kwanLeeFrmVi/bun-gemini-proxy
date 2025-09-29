import { setTimeout as sleep } from "node:timers/promises";
import { upstreamDuration } from "../observability/metrics.ts";
import { logger } from "../observability/logger.ts";
import type { ProxyConfig } from "../types/config.ts";
import type { ApiKeyRecord } from "../types/key.ts";

export interface UpstreamSuccess<T> {
  ok: true;
  status: number;
  body: T;
  headers: Headers;
}

export interface UpstreamFailure {
  ok: false;
  status: number;
  error: unknown;
  body?: unknown;
  headers: Headers;
}

export type UpstreamResult<T> = UpstreamSuccess<T> | UpstreamFailure;

const MOCK_RESPONSES = {
  chatCompletion: (requestBody: Record<string, unknown>) => ({
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: (requestBody.model as string) ?? "gemini-1.5-pro",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content:
            "This is a mock Gemini response. Configure GEMINI_PROXY_MODE=live with valid keys for real responses.",
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 32,
      total_tokens: 52,
    },
  }),
  modelList: () => ({
    object: "list",
    data: [
      {
        id: "gemini-1.5-pro",
        object: "model",
        created: Math.floor(Date.now() / 1000) - 3600,
        owned_by: "google",
      },
      {
        id: "gemini-1.5-flash",
        object: "model",
        created: Math.floor(Date.now() / 1000) - 7200,
        owned_by: "google",
      },
    ],
  }),
  model: (modelId: string) => ({
    id: modelId,
    object: "model",
    created: Math.floor(Date.now() / 1000) - 1800,
    owned_by: "google",
  }),
};

export class GeminiClient {
  constructor(private readonly config: ProxyConfig) {}

  async chatCompletion(
    requestBody: Record<string, unknown>,
    key: ApiKeyRecord,
  ): Promise<UpstreamResult<Record<string, unknown>> | Response> {
    if (this.config.mode === "mock") {
      await sleep(25);
      return {
        ok: true,
        status: 200,
        body: MOCK_RESPONSES.chatCompletion(requestBody),
        headers: new Headers({ "content-type": "application/json" }),
      } satisfies UpstreamSuccess<Record<string, unknown>>;
    }

    const isStreaming = requestBody.stream === true;
    const start = process.hrtime.bigint();

    // Use OpenAI-compatible endpoint for proper streaming support
    const url = new URL("/v1beta/openai/chat/completions", this.config.upstreamBaseUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key.key}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      upstreamDuration.observe({ endpoint: "/v1/chat/completions", result: String(response.status) }, diff);

      if (!response.ok) {
        const headers = response.headers;
        const contentType = headers.get("content-type") ?? "";
        const body = contentType.includes("application/json") ? await response.json() : await response.text();
        return {
          ok: false,
          status: response.status,
          error: body,
          body,
          headers,
        } satisfies UpstreamFailure;
      }

      // For streaming, return the Response directly for the router to handle
      if (isStreaming) {
        return response;
      }

      // For non-streaming, parse and return the body
      const headers = response.headers;
      const contentType = headers.get("content-type") ?? "";
      const body = contentType.includes("application/json") ? await response.json() : await response.text();

      return {
        ok: true,
        status: response.status,
        body: body as Record<string, unknown>,
        headers,
      } satisfies UpstreamSuccess<Record<string, unknown>>;
    } catch (error) {
      clearTimeout(timeout);
      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      upstreamDuration.observe({ endpoint: "/v1/chat/completions", result: "error" }, diff);
      logger.error({ error }, "Failed to reach Gemini upstream");
      return {
        ok: false,
        status: 502,
        error,
        headers: new Headers(),
      } satisfies UpstreamFailure;
    }
  }

  async listModels(key: ApiKeyRecord | null): Promise<UpstreamResult<Record<string, unknown>>> {
    if (this.config.mode === "mock") {
      await sleep(10);
      return {
        ok: true,
        status: 200,
        body: MOCK_RESPONSES.modelList(),
        headers: new Headers({ "content-type": "application/json" }),
      } satisfies UpstreamSuccess<Record<string, unknown>>;
    }

    const start = process.hrtime.bigint();
    const url = new URL("/v1beta/models", this.config.upstreamBaseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: key ? { "x-goog-api-key": key.key } : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      upstreamDuration.observe({ endpoint: "/v1/models", result: String(response.status) }, diff);

      const headers = response.headers;
      const contentType = headers.get("content-type") ?? "";
      const body = contentType.includes("application/json") ? await response.json() : await response.text();

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: body,
          body,
          headers,
        } satisfies UpstreamFailure;
      }

      const transformedBody = {
        object: "list",
        data: ((body as { models?: Array<{ name: string }> }).models ?? []).map((model) => ({
          id: model.name.replace("models/", ""),
          object: "model",
          created: 0,
          owned_by: "google",
        })),
      };

      return {
        ok: true,
        status: response.status,
        body: transformedBody,
        headers,
      } satisfies UpstreamSuccess<Record<string, unknown>>;
    } catch (error) {
      clearTimeout(timeout);
      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      upstreamDuration.observe({ endpoint: "/v1/models", result: "error" }, diff);
      logger.error({ error }, "Failed to fetch models from upstream");
      return {
        ok: false,
        status: 502,
        error,
        headers: new Headers(),
      } satisfies UpstreamFailure;
    }
  }

  async forward(
    url: string,
    requestBody: string,
    key: ApiKeyRecord,
  ): Promise<UpstreamResult<Record<string, unknown>>> {
    if (this.config.mode === "mock") {
      await sleep(25);
      return {
        ok: true,
        status: 200,
        body: { mock: true, message: "This is a mock response for a forwarded request." },
        headers: new Headers({ "content-type": "application/json" }),
      };
    }

    const start = process.hrtime.bigint();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      // Use Authorization Bearer header for OpenAI-compatible endpoints
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key.key}`,
        },
        body: requestBody,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      upstreamDuration.observe({ endpoint: new URL(url).pathname, result: String(response.status) }, diff);

      const headers = response.headers;
      const contentType = headers.get("content-type") ?? "";
      const body = contentType.includes("application/json") ? await response.json() : await response.text();

      if (!response.ok) {
        return { ok: false, status: response.status, error: body, body, headers };
      }

      return { ok: true, status: response.status, body: body as Record<string, unknown>, headers };
    } catch (error) {
      clearTimeout(timeout);
      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      upstreamDuration.observe({ endpoint: new URL(url).pathname, result: "error" }, diff);
      logger.error({ error, url }, "Failed to forward request to upstream");
      return { ok: false, status: 502, error, headers: new Headers() };
    }
  }

  async getModel(
    modelId: string,
    key: ApiKeyRecord | null,
  ): Promise<UpstreamResult<Record<string, unknown>>> {
    if (this.config.mode === "mock") {
      await sleep(10);
      if (!modelId.startsWith("gemini-")) {
        return {
          ok: false,
          status: 404,
          error: "Model not found",
          body: { error: "Model not found" },
          headers: new Headers({ "content-type": "application/json" }),
        };
      }
      return {
        ok: true,
        status: 200,
        body: MOCK_RESPONSES.model(modelId),
        headers: new Headers({ "content-type": "application/json" }),
      } satisfies UpstreamSuccess<Record<string, unknown>>;
    }

    const start = process.hrtime.bigint();
    const endpoint = `/v1/models/${modelId}`;
    const url = new URL(`/v1beta/models/${modelId}`, this.config.upstreamBaseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: key ? { "x-goog-api-key": key.key } : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      upstreamDuration.observe({ endpoint, result: String(response.status) }, diff);

      const headers = response.headers;
      const contentType = headers.get("content-type") ?? "";
      const body = contentType.includes("application/json") ? await response.json() : await response.text();

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: body,
          body,
          headers,
        } satisfies UpstreamFailure;
      }

      const model = body as { name: string };
      const transformedBody = {
        id: model.name.replace("models/", ""),
        object: "model",
        created: 0,
        owned_by: "google",
      };

      return {
        ok: true,
        status: response.status,
        body: transformedBody,
        headers,
      } satisfies UpstreamSuccess<Record<string, unknown>>;
    } catch (error) {
      clearTimeout(timeout);
      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      upstreamDuration.observe({ endpoint, result: "error" }, diff);
      logger.error({ error, modelId }, "Failed to fetch model from upstream");
      return {
        ok: false,
        status: 502,
        error,
        headers: new Headers(),
      } satisfies UpstreamFailure;
    }
  }
}
