import type { ProxyConfig } from "../../types/config.ts";
import { CodexCLIClient } from "./codex-cli-client.ts";
import { CLITransformer, type OpenAIChatRequest } from "./cli-transformer.ts";
import { errorResponse, jsonResponse } from "../responses.ts";
import { logger } from "../../observability/logger.ts";
import {
  requestCounter,
  requestDuration,
  activeRequestsGauge,
} from "../../observability/metrics.ts";

export interface CodexCLIRouterOptions {
  config: ProxyConfig;
}

const JSON_CONTENT_TYPE = /application\/json/i;

/**
 * Router for Codex CLI-backed OpenAI-compatible endpoints
 * Routes: POST /codex-cli/v1/chat/completions, GET /codex-cli/v1/models, GET /codex-cli/v1/health
 */
export class CodexCLIRouter {
  private readonly config: ProxyConfig;
  private readonly cliClient: CodexCLIClient;
  private readonly transformer: CLITransformer;
  private readonly cliTimeoutMs: number = 120000; // 2 minutes for agent operations

  // Codex supports various Claude models
  private readonly supportedModels = [
    "claude-sonnet-4",
    "claude-sonnet-4-5",
    "claude-opus-4",
    "claude-haiku-4",
    "claude-3-5-sonnet-20241022",
    "claude-3-opus-20240229",
  ];

  constructor(options: CodexCLIRouterOptions) {
    this.config = options.config;
    this.cliClient = new CodexCLIClient();
    this.transformer = new CLITransformer();
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Strip /codex-cli prefix to get the actual endpoint
    const endpoint = pathname.replace(/^\/codex-cli/, "");

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
   * Handle POST /codex-cli/v1/chat/completions
   */
  private async handleChatCompletions(request: Request): Promise<Response> {
    const startMs = Date.now();
    const endpoint = "/codex-cli/v1/chat/completions";
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
          "Streaming is not supported by codex CLI backend. Use stream=false.",
          400,
          "invalid_request_error",
        );
      }

      // Validate model
      if (!this.isModelSupported(body.model)) {
        return errorResponse(
          `Model '${body.model}' is not supported. Supported models: ${this.supportedModels.join(", ")}`,
          400,
          "invalid_request_error",
        );
      }

      // Convert messages to prompt
      const prompt = this.transformer.messagesToPrompt(body.messages);
      const normalizedModel = body.model;

      logger.info(
        { model: normalizedModel, messageCount: body.messages.length },
        "Processing chat completion via Codex CLI",
      );

      // Execute CLI command with extended timeout
      const cliResponse = await this.cliClient.execute({
        prompt,
        model: normalizedModel,
        timeoutMs: this.cliTimeoutMs,
      });

      // Transform to OpenAI format
      // Create a mock CLI response format compatible with CLITransformer
      const mockGeminiResponse = {
        response: cliResponse.response,
        stats: {
          models: {
            [normalizedModel]: {
              api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 0 },
              tokens: {
                prompt: 0,
                candidates: 0,
                total: 0,
                cached: 0,
                thoughts: 0,
                tool: 0,
              },
            },
          },
          tools: {},
          files: {},
        },
      };

      const openaiResponse = this.transformer.toOpenAIResponse(
        mockGeminiResponse,
        normalizedModel,
      );

      // Record metrics
      const durationMs = Date.now() - startMs;
      requestCounter.inc({ ...labels, status: "200" });
      requestDuration.observe(labels, durationMs / 1000);

      logger.info(
        { model: normalizedModel, durationMs },
        "Codex chat completion successful",
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
        "Codex chat completion failed",
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
   * Handle GET /codex-cli/v1/models
   */
  private async handleListModels(): Promise<Response> {
    try {
      const created = Math.floor(Date.now() / 1000);

      const response = {
        object: "list",
        data: this.supportedModels.map((modelId) => ({
          id: modelId,
          object: "model" as const,
          created,
          owned_by: "anthropic",
        })),
      };

      return jsonResponse(response);
    } catch (error) {
      logger.error({ error }, "Failed to list models");
      return errorResponse("Internal server error", 500, "internal_error");
    }
  }

  /**
   * Handle GET /codex-cli/v1/health
   */
  private async handleHealth(): Promise<Response> {
    try {
      const isAvailable = await this.cliClient.isAvailable();
      const version = await this.cliClient.getVersion();

      if (!isAvailable) {
        return jsonResponse(
          { status: "unhealthy", error: "codex CLI not found" },
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

  /**
   * Check if model is supported
   */
  private isModelSupported(model: string): boolean {
    return this.supportedModels.includes(model);
  }
}