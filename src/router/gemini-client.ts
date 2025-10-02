import type { ProxyConfig } from "../types/config.ts";
import type { ApiKeyRecord } from "../types/key.ts";
import { logger } from "../observability/logger.ts";
import { upstreamDuration } from "../observability/metrics.ts";
import type { UpstreamResult } from "./client/types.ts";
import { HttpClient } from "./client/http-client.ts";
import { ResponseTransformer } from "./client/response-transformer.ts";

/**
 * GeminiClient orchestrates communication with the Gemini API.
 * Delegates to specialized components:
 * - HttpClient: HTTP requests with timeout/abort
 * - ResponseTransformer: Gemini → OpenAI format conversion
 */
export class GeminiClient {
  private readonly httpClient: HttpClient;
  private readonly transformer: ResponseTransformer;

  constructor(config: ProxyConfig) {
    this.httpClient = new HttpClient({
      timeoutMs: config.requestTimeoutMs,
      baseUrl: config.upstreamBaseUrl,
    });
    this.transformer = new ResponseTransformer();
  }

  /**
   * Execute a chat completion request.
   * Returns either a parsed response or a raw Response for streaming.
   */
  async chatCompletion(
    requestBody: Record<string, unknown>,
    key: ApiKeyRecord,
  ): Promise<UpstreamResult<Record<string, unknown>> | Response> {
    const isStreaming = requestBody.stream === true;
    const endpoint = "/v1beta/openai/chat/completions";
    const start = process.hrtime.bigint();

    try {
      if (isStreaming) {
        const response = await this.httpClient.postStreaming(endpoint, requestBody, {
          Authorization: `Bearer ${key.key}`,
        });

        const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
        upstreamDuration.observe({ endpoint, result: String(response.status) }, diff);

        if (!response.ok) {
          const contentType = response.headers.get("content-type") ?? "";
          const body = contentType.includes("application/json")
            ? await response.json()
            : await response.text();
          return {
            ok: false,
            status: response.status,
            error: body,
            body,
            headers: response.headers,
          };
        }

        return response;
      }

      // Non-streaming request
      return await this.httpClient.post(endpoint, requestBody, {
        Authorization: `Bearer ${key.key}`,
      });
    } catch (error) {
      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      upstreamDuration.observe({ endpoint, result: "error" }, diff);
      logger.error({ error }, "Failed to reach Gemini upstream");
      return {
        ok: false,
        status: 502,
        error,
        headers: new Headers(),
      };
    }
  }

  /**
   * List available models from Gemini.
   */
  async listModels(key: ApiKeyRecord): Promise<UpstreamResult<Record<string, unknown>>> {
    const endpoint = "/v1beta/models";
    const headers = { "x-goog-api-key": key.key };
    const result = await this.httpClient.get(endpoint, headers);

    if (result.ok) {
      result.body = await this.transformer.transformModelList(result.body);
    }

    return result;
  }

  /**
   * Get details for a specific model.
   */
  async getModel(
    modelId: string,
    key: ApiKeyRecord,
  ): Promise<UpstreamResult<Record<string, unknown>>> {
    const endpoint = `/v1beta/models/${modelId}`;
    const headers = { "x-goog-api-key": key.key };
    const result = await this.httpClient.get(endpoint, headers);

    if (result.ok) {
      result.body = await this.transformer.transformModel(result.body);
    }

    return result;
  }

  /**
   * Forward a generic request to Gemini.
   * Used for endpoints like embeddings and image generation.
   */
  async forward(
    url: string,
    requestBody: string,
    key: ApiKeyRecord,
  ): Promise<UpstreamResult<Record<string, unknown>>> {
    const endpoint = new URL(url).pathname;
    return this.httpClient.post(endpoint, requestBody, {
      Authorization: `Bearer ${key.key}`,
    });
  }
}
