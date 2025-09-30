import type { ProxyConfig } from "../../types/config.ts";
import { GeminiCLIClient } from "./gemini-cli-client.ts";
import { CLITransformer, type OpenAIChatRequest } from "./cli-transformer.ts";
import { errorResponse, jsonResponse } from "../responses.ts";
import { logger } from "../../observability/logger.ts";
import {
  requestCounter,
  requestDuration,
  activeRequestsGauge,
} from "../../observability/metrics.ts";

export interface GeminiCLIRouterOptions {
  config: ProxyConfig;
}

const JSON_CONTENT_TYPE = /application\/json/i;

export class GeminiCLIRouter {
  private readonly config: ProxyConfig;
  private readonly cliClient: GeminiCLIClient;
  private readonly transformer: CLITransformer;
  private readonly cliTimeoutMs: number = 60000; // CLI needs longer timeout (GEMINI.md loading + processing)

  constructor(options: GeminiCLIRouterOptions) {
    this.config = options.config;
    this.cliClient = new GeminiCLIClient();
    this.transformer = new CLITransformer();
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Strip /gemini-cli prefix to get the actual endpoint
    const endpoint = pathname.replace(/^\/gemini-cli/, "");

    // Route to appropriate handler
    if (endpoint === "/v1/chat/completions" && request.method === "POST") {
      return this.handleChatCompletions(request);
    }

    if (endpoint === "/v1/models" && request.method === "GET") {
      return this.handleListModels();
    }

    if (endpoint === "/v1/health" && request.method === "GET") {
      return this.handleHealth();
    }

    return errorResponse("Not found", 404, "not_found");
  }

  /**
   * Handle POST /gemini-cli/v1/chat/completions
   */
  private async handleChatCompletions(request: Request): Promise<Response> {
    const startMs = Date.now();
    const endpoint = "/gemini-cli/v1/chat/completions";
    const labels = { endpoint };

    activeRequestsGauge.inc(labels);

    try {
      // Validate content type
      const contentType = request.headers.get("content-type");
      if (!contentType || !JSON_CONTENT_TYPE.test(contentType)) {
        return errorResponse("Content-Type must be application/json", 400, "invalid_request_error");
      }

      // Parse request body
      const body = (await request.json()) as OpenAIChatRequest;

      // Validate required fields
      if (!body.model || !body.messages || !Array.isArray(body.messages)) {
        return errorResponse(
          "Request must include 'model' and 'messages' fields",
          400,
          "invalid_request_error",
        );
      }

      // Check streaming not supported
      if (body.stream === true) {
        return errorResponse(
          "Streaming is not supported by gemini CLI backend. Use stream=false.",
          400,
          "invalid_request_error",
        );
      }

      // Validate model
      if (!this.transformer.isModelSupported(body.model)) {
        return errorResponse(
          `Model '${body.model}' is not supported. Supported models: gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash-exp, gemini-exp-1206`,
          400,
          "invalid_request_error",
        );
      }

      // Convert messages to prompt
      const prompt = this.transformer.messagesToPrompt(body.messages);
      const normalizedModel = this.transformer.normalizeModel(body.model);

      logger.info(
        { model: normalizedModel, messageCount: body.messages.length },
        "Processing chat completion via CLI",
      );

      // Execute CLI command with extended timeout
      const cliResponse = await this.cliClient.execute({
        prompt,
        model: normalizedModel,
        timeoutMs: this.cliTimeoutMs,
      });

      // Transform to OpenAI format
      const openaiResponse = this.transformer.toOpenAIResponse(cliResponse, normalizedModel);

      // Record metrics
      const durationMs = Date.now() - startMs;
      requestCounter.inc({ ...labels, status: "200" });
      requestDuration.observe(labels, durationMs / 1000);

      logger.info(
        { model: normalizedModel, durationMs, tokens: openaiResponse.usage.total_tokens },
        "Chat completion successful",
      );

      return jsonResponse(openaiResponse);
    } catch (error) {
      const durationMs = Date.now() - startMs;
      requestCounter.inc({ ...labels, status: "500" });
      requestDuration.observe(labels, durationMs / 1000);

      logger.error(
        {
          error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        },
        "Chat completion failed",
      );

      return errorResponse(
        error instanceof Error ? error.message : "Internal server error",
        500,
        "internal_error",
      );
    } finally {
      activeRequestsGauge.dec(labels);
    }
  }

  /**
   * Handle GET /gemini-cli/v1/models
   */
  private async handleListModels(): Promise<Response> {
    try {
      const response = this.transformer.getModelsResponse();
      return jsonResponse(response);
    } catch (error) {
      logger.error({ error }, "Failed to list models");
      return errorResponse("Internal server error", 500, "internal_error");
    }
  }

  /**
   * Handle GET /gemini-cli/v1/health
   */
  private async handleHealth(): Promise<Response> {
    try {
      const isAvailable = await this.cliClient.isAvailable();
      const version = await this.cliClient.getVersion();

      if (!isAvailable) {
        return jsonResponse(
          { status: "unhealthy", error: "gemini CLI not found" },
          { status: 503 },
        );
      }

      return jsonResponse({
        status: "healthy",
        cli_available: true,
        cli_version: version,
      });
    } catch (error) {
      logger.error({ error }, "Health check failed");
      return jsonResponse({ status: "unhealthy", error: "Health check failed" }, { status: 503 });
    }
  }
}
