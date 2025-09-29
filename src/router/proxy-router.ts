import type { ProxyConfig } from "../types/config.ts";
import type { KeyManager } from "../keys/key-manager.ts";
import type { GeminiClient } from "./gemini-client.ts";
import { activeRequestsGauge, requestCounter, requestDuration } from "../observability/metrics.ts";
import { errorResponse, jsonResponse } from "./responses.ts";
import { logger } from "../observability/logger.ts";

export interface ProxyRouterOptions {
  config: ProxyConfig;
  keyManager: KeyManager;
  gemini: GeminiClient;
}

const JSON_CONTENT_TYPE = /application\/json/i;

export class ProxyRouter {
  private readonly config: ProxyConfig;
  private readonly keyManager: KeyManager;
  private readonly gemini: GeminiClient;

  constructor(options: ProxyRouterOptions) {
    this.config = options.config;
    this.keyManager = options.keyManager;
    this.gemini = options.gemini;
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/v1")) {
      return errorResponse("Not found", 404, "not_found");
    }

    if (url.pathname === "/v1/models" && request.method === "GET") {
      return this.handleListModels(request);
    }

    if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
      return this.handleChatCompletions(request);
    }

    return errorResponse("Endpoint not yet implemented", 404, "not_implemented", {
      path: url.pathname,
      method: request.method,
    });
  }

  private async handleListModels(request: Request): Promise<Response> {
    const endTimer = this.startRequestTimer("/v1/models", request.method);
    activeRequestsGauge.inc({ endpoint: "/v1/models" });
    let resultLabel = "success";
    try {
      const key = this.keyManager.selectKey();
      const result = await this.gemini.listModels(key?.record ?? null);

      if (!result.ok) {
        requestCounter.inc({ endpoint: "/v1/models", method: request.method, status: result.status, result: "error" });
        resultLabel = "error";
        return errorResponse("Failed to fetch models", result.status, "upstream_error", {
          upstreamStatus: result.status,
        });
      }

      requestCounter.inc({ endpoint: "/v1/models", method: request.method, status: 200, result: "success" });
      return jsonResponse(result.body, { status: result.status });
    } finally {
      activeRequestsGauge.dec({ endpoint: "/v1/models" });
      endTimer(resultLabel);
    }
  }

  private async handleChatCompletions(request: Request): Promise<Response> {
    const endpoint = "/v1/chat/completions";
    const endTimer = this.startRequestTimer(endpoint, request.method);
    activeRequestsGauge.inc({ endpoint });
    let resultLabel = "success";
    try {
      const contentLengthHeader = request.headers.get("content-length");
      if (contentLengthHeader && Number(contentLengthHeader) > this.config.maxPayloadSizeBytes) {
        requestCounter.inc({ endpoint, method: request.method, status: 413, result: "rejected" });
        resultLabel = "rejected";
        return errorResponse("Payload too large", 413, "payload_too_large");
      }

      const contentType = request.headers.get("content-type") ?? "";
      if (!JSON_CONTENT_TYPE.test(contentType)) {
        requestCounter.inc({ endpoint, method: request.method, status: 415, result: "rejected" });
        resultLabel = "rejected";
        return errorResponse("Unsupported content type", 415, "unsupported_media_type");
      }

      const raw = await request.text();
      if (raw.length > this.config.maxPayloadSizeBytes) {
        requestCounter.inc({ endpoint, method: request.method, status: 413, result: "rejected" });
        resultLabel = "rejected";
        return errorResponse("Payload too large", 413, "payload_too_large");
      }

      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw);
      } catch {
        requestCounter.inc({ endpoint, method: request.method, status: 400, result: "rejected" });
        resultLabel = "rejected";
        return errorResponse("Malformed JSON payload", 400, "invalid_request_error");
      }

      if (!body.model || typeof body.model !== "string") {
        requestCounter.inc({ endpoint, method: request.method, status: 400, result: "rejected" });
        resultLabel = "rejected";
        return errorResponse("Missing required 'model' field", 400, "invalid_request_error");
      }

      if (!Array.isArray(body.messages)) {
        requestCounter.inc({ endpoint, method: request.method, status: 400, result: "rejected" });
        resultLabel = "rejected";
        return errorResponse("Missing required 'messages' array", 400, "invalid_request_error");
      }

      const maxAttempts = Math.max(1, this.keyManager.getActiveKeyCount() || 1);
      const attemptedKeys = new Set<string>();
      let lastFailure: Response | null = null;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const selection = this.keyManager.selectKey();
        if (!selection) {
          requestCounter.inc({ endpoint, method: request.method, status: 503, result: "failed" });
          resultLabel = "failed";
          return errorResponse("No healthy API keys available", 503, "service_unavailable");
        }
        if (attemptedKeys.has(selection.record.id)) {
          continue;
        }
        attemptedKeys.add(selection.record.id);

        const start = process.hrtime.bigint();
        const upstream = await this.gemini.chatCompletion(body, selection.record);
        const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000_000;

        if (upstream.ok) {
          this.keyManager.recordSuccess(selection.record.id, elapsed * 1000);
          requestCounter.inc({ endpoint, method: request.method, status: 200, result: "success" });
          resultLabel = "success";
          return jsonResponse(upstream.body, { status: upstream.status });
        }

        const isRateLimit = upstream.status === 429;
        this.keyManager.recordFailure(
          selection.record.id,
          `upstream_${upstream.status}`,
          isRateLimit,
          elapsed * 1000,
        );

        logger.warn(
          { keyId: selection.record.id, status: upstream.status },
          "Upstream failure; rotating to next key",
        );

        lastFailure = errorResponse("Gemini upstream error", upstream.status, "upstream_error", {
          upstreamStatus: upstream.status,
        });
      }

      if (lastFailure) {
        requestCounter.inc({ endpoint, method: request.method, status: lastFailure.status ?? 500, result: "failed" });
        resultLabel = "failed";
        return lastFailure;
      }

      requestCounter.inc({ endpoint, method: request.method, status: 503, result: "failed" });
      resultLabel = "failed";
      return errorResponse("All keys exhausted", 503, "service_unavailable");
    } finally {
      activeRequestsGauge.dec({ endpoint });
      endTimer(resultLabel);
    }
  }

  private startRequestTimer(endpoint: string, method: string): (result: string) => void {
    const start = process.hrtime.bigint();
    return (result: string) => {
      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      requestDuration.observe({ endpoint, method, result }, diff);
    };
  }
}
