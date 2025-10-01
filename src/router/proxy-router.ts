import type { ProxyConfig } from "../types/config.ts";
import type { KeyManager } from "../keys/key-manager.ts";
import type { GeminiClient } from "./gemini-client.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { activeRequestsGauge, requestCounter, requestDuration } from "../observability/metrics.ts";
import { errorResponse, jsonResponse } from "./responses.ts";
import { logger } from "../observability/logger.ts";
import { HelpView } from "./views/help-view.ts";
import { InfoView } from "./views/info-view.ts";
import { getThinkingConfig } from "./reasoning-effort-mapper.ts";

export interface ProxyRouterOptions {
  config: ProxyConfig;
  keyManager: KeyManager;
  gemini: GeminiClient;
  stateStore: StateStore;
}

const JSON_CONTENT_TYPE = /application\/json/i;
const MODEL_DETAIL_PATTERN = /^\/v1\/models\/([^/]+)$/;

export class ProxyRouter {
  private readonly config: ProxyConfig;
  private readonly keyManager: KeyManager;
  private readonly gemini: GeminiClient;
  private readonly stateStore: StateStore;
  private readonly helpView: HelpView;
  private readonly infoView: InfoView;

  constructor(options: ProxyRouterOptions) {
    this.config = options.config;
    this.keyManager = options.keyManager;
    this.gemini = options.gemini;
    this.stateStore = options.stateStore;
    this.helpView = new HelpView();
    this.infoView = new InfoView({
      config: this.config,
      keyManager: this.keyManager,
      stateStore: this.stateStore,
    });
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/help") {
      return this.handleHelp();
    }

    if (url.pathname === "/info") {
      return this.handleInfo();
    }

    if (!url.pathname.startsWith("/v1")) {
      return errorResponse("Not found", 404, "not_found");
    }

    // Authentication check for /v1 endpoints
    // Skip authentication if no accessTokens configured
    if (this.config.accessTokens.length > 0 && this.config.requireAuth) {
      const authHeader = request.headers.get("authorization");
      if (!authHeader) {
        return errorResponse("Missing authorization header", 401, "authentication_error");
      }

      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (!this.config.accessTokens.includes(token)) {
        return errorResponse("Invalid access token", 401, "authentication_error");
      }
    }

    if (
      (url.pathname === "/v1/models" || url.pathname === "/v1/models/") &&
      request.method === "GET"
    ) {
      return this.handleListModels(request);
    }

    const modelDetailMatch = url.pathname.match(MODEL_DETAIL_PATTERN);
    if (modelDetailMatch && request.method === "GET") {
      const modelId = modelDetailMatch[1];
      if (modelId) {
        return this.handleGetModel(request, modelId);
      }
    }

    if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
      return this.handleChatCompletions(request);
    }

    if (url.pathname === "/v1/embeddings" && request.method === "POST") {
      return this.handleGenericProxy(
        request,
        "/v1/embeddings",
        "https://generativelanguage.googleapis.com/v1beta/openai/embeddings",
      );
    }

    if (url.pathname === "/v1/images/generations" && request.method === "POST") {
      return this.handleGenericProxy(
        request,
        "/v1/images/generations",
        "https://generativelanguage.googleapis.com/v1beta/openai/images/generations",
      );
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
      const selection = this.keyManager.selectKey();
      if (!selection) {
        requestCounter.inc({
          endpoint: "/v1/models",
          method: request.method,
          status: 503,
          result: "failed",
        });
        resultLabel = "failed";
        return errorResponse("No healthy API keys available", 503, "service_unavailable");
      }

      const result = await this.gemini.listModels(selection.record);

      if (!result.ok) {
        requestCounter.inc({
          endpoint: "/v1/models",
          method: request.method,
          status: result.status,
          result: "error",
        });
        resultLabel = "error";
        return errorResponse("Failed to fetch models", result.status, "upstream_error", {
          upstreamStatus: result.status,
        });
      }

      requestCounter.inc({
        endpoint: "/v1/models",
        method: request.method,
        status: 200,
        result: "success",
      });
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

      // Convert OpenAI's reasoning_effort to Gemini's thinking_budget
      // Note: reasoning_effort and thinking_budget overlap, so we convert between them
      if (body.reasoning_effort !== undefined) {
        const thinkingConfig = getThinkingConfig(body.reasoning_effort as string);

        body.extra_body = body.extra_body || {};
        const extraBody = body.extra_body as Record<string, unknown>;
        extraBody.google = extraBody.google || {};
        const google = extraBody.google as Record<string, unknown>;

        // Set thinking_config if not already present
        if (!google.thinking_config) {
          google.thinking_config = thinkingConfig;
          logger.debug(
            { model: body.model, reasoning_effort: body.reasoning_effort, thinking_budget: thinkingConfig.thinking_budget },
            "Converted reasoning_effort to thinking_budget"
          );
        }

        // Remove reasoning_effort before sending to Gemini (it doesn't support this parameter)
        delete body.reasoning_effort;
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

        // Handle streaming response (Response object)
        if (upstream instanceof Response) {
          this.keyManager.recordSuccess(selection.record.id, elapsed * 1000);
          requestCounter.inc({ endpoint, method: request.method, status: 200, result: "success" });
          resultLabel = "success";

          // Remove compression headers to ensure OpenAI clients can read the stream
          const headers = new Headers(upstream.headers);
          headers.delete("content-encoding");
          headers.delete("content-length");

          // Transform Gemini's <thought> tags to OpenAI's <think> tags
          const transformedStream = upstream.body!.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                const text = new TextDecoder().decode(chunk);
                // Replace Gemini's <thought> tags with OpenAI's <think> tags
                const transformed = text
                  .replace(/<thought>/g, "<think>")
                  .replace(/<\/thought>/g, "</think>");
                controller.enqueue(new TextEncoder().encode(transformed));
              },
            })
          );

          return new Response(transformedStream, {
            status: upstream.status,
            headers,
          });
        }

        // Handle non-streaming response (UpstreamResult)
        if (upstream.ok) {
          this.keyManager.recordSuccess(selection.record.id, elapsed * 1000);
          requestCounter.inc({ endpoint, method: request.method, status: 200, result: "success" });
          resultLabel = "success";

          // Transform <thought> to <think> in non-streaming responses
          const transformedBody = this.transformThinkingTags(upstream.body);
          return jsonResponse(transformedBody, { status: upstream.status });
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
        requestCounter.inc({
          endpoint,
          method: request.method,
          status: lastFailure.status ?? 500,
          result: "failed",
        });
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

  private async handleGenericProxy(
    request: Request,
    endpoint: string,
    upstreamUrl: string,
  ): Promise<Response> {
    const endTimer = this.startRequestTimer(endpoint, request.method);
    activeRequestsGauge.inc({ endpoint });
    let resultLabel = "success";
    try {
      const selection = this.keyManager.selectKey();
      if (!selection) {
        requestCounter.inc({ endpoint, method: request.method, status: 503, result: "failed" });
        resultLabel = "failed";
        return errorResponse("No healthy API keys available", 503, "service_unavailable");
      }

      const body = await request.text();
      const upstream = await this.gemini.forward(upstreamUrl, body, selection.record);

      if (!upstream.ok) {
        requestCounter.inc({
          endpoint,
          method: request.method,
          status: upstream.status,
          result: "error",
        });
        resultLabel = "error";
        return errorResponse("Failed to forward request", upstream.status, "upstream_error", {
          upstreamStatus: upstream.status,
        });
      }

      requestCounter.inc({ endpoint, method: request.method, status: 200, result: "success" });
      return jsonResponse(upstream.body, { status: upstream.status });
    } finally {
      activeRequestsGauge.dec({ endpoint });
      endTimer(resultLabel);
    }
  }

  private async handleGetModel(request: Request, modelId: string): Promise<Response> {
    const endpoint = `/v1/models/${modelId}`;
    const endTimer = this.startRequestTimer(endpoint, request.method);
    activeRequestsGauge.inc({ endpoint });
    let resultLabel = "success";
    try {
      const selection = this.keyManager.selectKey();
      if (!selection) {
        requestCounter.inc({ endpoint, method: request.method, status: 503, result: "failed" });
        resultLabel = "failed";
        return errorResponse("No healthy API keys available", 503, "service_unavailable");
      }

      const result = await this.gemini.getModel(modelId, selection.record);

      if (!result.ok) {
        const status = result.status === 404 ? 404 : 500;
        requestCounter.inc({ endpoint, method: request.method, status, result: "error" });
        resultLabel = "error";
        return errorResponse("Failed to fetch model", status, "upstream_error", {
          upstreamStatus: result.status,
        });
      }

      requestCounter.inc({ endpoint, method: request.method, status: 200, result: "success" });
      return jsonResponse(result.body, { status: result.status });
    } finally {
      activeRequestsGauge.dec({ endpoint });
      endTimer(resultLabel);
    }
  }

  private async handleInfo(): Promise<Response> {
    return this.infoView.render();
  }

  private async handleHelp(): Promise<Response> {
    return this.helpView.render();
  }

  private startRequestTimer(endpoint: string, method: string): (result: string) => void {
    const start = process.hrtime.bigint();
    return (result: string) => {
      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      requestDuration.observe({ endpoint, method, result }, diff);
    };
  }

  /**
   * Transform Gemini's <thought> tags to OpenAI's <think> tags in response body
   */
  private transformThinkingTags(body: Record<string, unknown>): Record<string, unknown> {
    const bodyStr = JSON.stringify(body);
    const transformed = bodyStr
      .replace(/<thought>/g, "<think>")
      .replace(/<\/thought>/g, "</think>");
    return JSON.parse(transformed);
  }
}
