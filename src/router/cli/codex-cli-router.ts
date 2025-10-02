import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProxyConfig } from "../../types/config.ts";
import { CodexCLIClient } from "./codex-cli-client.ts";
import { CLITransformer, type OpenAIChatRequest } from "./cli-transformer.ts";
import { SSETransformer } from "./sse-transformer.ts";
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
const DATA_URL_REGEX = /^data:(.+?);base64,(.+)$/i;

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

interface ImageAttachments {
  paths: string[];
  cleanup: () => Promise<void>;
}

class InvalidImageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidImageInputError";
  }
}

/**
 * Router for Codex CLI-backed OpenAI-compatible endpoints
 * Routes: POST /codex-cli/v1/chat/completions, GET /codex-cli/v1/models, GET /codex-cli/v1/health
 */
export class CodexCLIRouter {
  private readonly config: ProxyConfig;
  private readonly cliClient: CodexCLIClient;
  private readonly transformer: CLITransformer;
  private readonly cliTimeoutMs: number = 120000; // 2 minutes for agent operations

  // Codex supports GPT-5 models (reasoning effort is passed via model_reasoning_effort parameter)
  private readonly supportedModels = ["gpt-5-codex", "gpt-5"];

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

      // Handle streaming vs non-streaming
      const isStreaming = body.stream === true;

      // Validate model
      if (!this.isModelSupported(body.model)) {
        return errorResponse(
          `Model '${body.model}' is not supported. Supported models: ${this.supportedModels.join(", ")}`,
          400,
          "invalid_request_error",
        );
      }

      // Convert messages to prompt and extract images
      const { prompt, images } = this.transformer.messagesToPrompt(body.messages);
      const normalizedModel = body.model;

      logger.info(
        {
          model: normalizedModel,
          messageCount: body.messages.length,
          reasoningEffort: body.reasoning_effort,
          imageCount: images.length,
          streaming: isStreaming,
        },
        "Processing chat completion via Codex CLI",
      );

      const imageAttachments =
        images.length > 0 ? await this.prepareImageAttachments(images) : null;

      // Handle streaming response
      if (isStreaming) {
        try {
          return this.handleStreamingResponse(
            prompt,
            normalizedModel,
            body.reasoning_effort,
            imageAttachments,
          );
        } catch (streamError) {
          await imageAttachments?.cleanup();
          throw streamError;
        }
      }

      // Execute CLI command with extended timeout (non-streaming)
      try {
        const cliResponse = await this.cliClient.execute({
          prompt,
          model: normalizedModel,
          reasoningEffort: body.reasoning_effort,
          images:
            imageAttachments && imageAttachments.paths.length > 0
              ? imageAttachments.paths
              : undefined,
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

        logger.info({ model: normalizedModel, durationMs }, "Codex chat completion successful");

        return jsonResponse(openaiResponse);
      } finally {
        await imageAttachments?.cleanup();
      }
    } catch (error) {
      const durationMs = Date.now() - startMs;
      const statusCode = error instanceof InvalidImageInputError ? "400" : "500";
      requestCounter.inc({ ...labels, status: statusCode });
      requestDuration.observe(labels, durationMs / 1000);

      if (error instanceof InvalidImageInputError) {
        logger.warn({ errorMessage: error.message }, "Invalid Codex chat completion request");
        return errorResponse(error.message, 400, "invalid_request_error");
      }

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
          owned_by: "openai",
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
        return jsonResponse({ status: "unhealthy", error: "codex CLI not found" }, { status: 503 });
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
   * Handle streaming response from Codex CLI
   */
  private handleStreamingResponse(
    prompt: string,
    model: string,
    reasoningEffort?: "minimal" | "low" | "medium" | "high",
    imageAttachments?: ImageAttachments | null,
  ): Response {
    const transformer = new SSETransformer(model);
    const cliClient = new CodexCLIClient();

    const cleanup = imageAttachments?.cleanup;
    let cleanedUp = false;
    const runCleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (!cleanup) return;

      try {
        await cleanup();
      } catch (error) {
        logger.warn({ error }, "Failed to cleanup temporary image attachments");
      }
    };

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial chunk with role
          controller.enqueue(new TextEncoder().encode(transformer.createInitialChunk(model)));

          // Stream content chunks as they arrive from codex CLI
          for await (const content of cliClient.executeStreaming({
            prompt,
            model,
            reasoningEffort,
            images:
              imageAttachments && imageAttachments.paths.length > 0
                ? imageAttachments.paths
                : undefined,
          })) {
            controller.enqueue(
              new TextEncoder().encode(transformer.createContentChunk(model, content)),
            );
          }

          // Send final chunk and done message
          controller.enqueue(new TextEncoder().encode(transformer.createFinalChunk(model)));
          controller.enqueue(new TextEncoder().encode(transformer.createDoneMessage()));

          await runCleanup();
          controller.close();
        } catch (error) {
          logger.error({ error }, "Streaming error");
          await runCleanup();
          controller.error(error);
        }
      },
      async cancel() {
        await runCleanup();
        logger.info("Client disconnected from stream");
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // Disable nginx buffering
      },
    });
  }

  /**
   * Check if model is supported
   */
  private isModelSupported(model: string): boolean {
    return this.supportedModels.includes(model);
  }

  /**
   * Prepare image inputs by materializing remote and data URI images to temporary files
   */
  private async prepareImageAttachments(imageUrls: string[]): Promise<ImageAttachments> {
    const preparedPaths: string[] = [];
    const tempFiles: string[] = [];

    try {
      for (const imageUrl of imageUrls) {
        if (!imageUrl) continue;

        if (imageUrl.startsWith("data:")) {
          const { buffer, extension } = this.decodeDataUri(imageUrl);
          const tempFile = await this.writeTempImage(buffer, extension);
          tempFiles.push(tempFile);
          preparedPaths.push(tempFile);
          continue;
        }

        if (/^https?:\/\//i.test(imageUrl)) {
          const tempFile = await this.downloadImageToTempFile(imageUrl);
          tempFiles.push(tempFile);
          preparedPaths.push(tempFile);
          continue;
        }

        if (imageUrl.startsWith("file://")) {
          try {
            preparedPaths.push(fileURLToPath(imageUrl));
          } catch {
            throw new InvalidImageInputError(`Invalid file URL for image input: ${imageUrl}`);
          }
          continue;
        }

        preparedPaths.push(imageUrl);
      }
    } catch (error) {
      await this.cleanupTempFiles(tempFiles);
      throw error;
    }

    return {
      paths: preparedPaths,
      cleanup: async () => {
        await this.cleanupTempFiles(tempFiles);
      },
    };
  }

  /**
   * Decode a data URI image to a buffer and extension
   */
  private decodeDataUri(dataUri: string): { buffer: Buffer; extension: string } {
    const match = DATA_URL_REGEX.exec(dataUri);
    if (!match) {
      throw new InvalidImageInputError("Image data URI is malformed");
    }

    const mimeType = match[1]?.toLowerCase();
    const base64Data = match[2];

    try {
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length === 0) {
        throw new InvalidImageInputError("Image data URI contains no data");
      }

      const extension = this.resolveImageExtension(mimeType);
      return { buffer, extension };
    } catch (error) {
      if (error instanceof InvalidImageInputError) {
        throw error;
      }
      throw new InvalidImageInputError("Failed to decode base64 image data");
    }
  }

  /**
   * Download remote image and persist it as a temporary file
   */
  private async downloadImageToTempFile(imageUrl: string): Promise<string> {
    let response: Response;

    try {
      response = await fetch(imageUrl);
    } catch (error) {
      throw new InvalidImageInputError(
        `Failed to fetch image from URL '${imageUrl}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      throw new InvalidImageInputError(
        `Failed to fetch image from URL '${imageUrl}': HTTP ${response.status}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new InvalidImageInputError(`Fetched image from URL '${imageUrl}' was empty`);
    }

    const contentType = response.headers.get("content-type");
    const extension = this.resolveImageExtension(
      contentType?.split(";")[0]?.toLowerCase(),
      imageUrl,
    );

    return this.writeTempImage(buffer, extension);
  }

  /**
   * Write image buffer to a unique temporary file
   */
  private async writeTempImage(buffer: Buffer, extension: string): Promise<string> {
    const normalizedExtension = extension?.startsWith(".")
      ? extension
      : extension
        ? `.${extension}`
        : ".bin";
    const filePath = join(tmpdir(), `codex-image-${randomUUID()}${normalizedExtension}`);
    await fs.writeFile(filePath, buffer);
    return filePath;
  }

  /**
   * Determine file extension from mime type or URL
   */
  private resolveImageExtension(mimeType?: string, imageUrl?: string): string {
    if (mimeType && MIME_EXTENSION_MAP[mimeType]) {
      return MIME_EXTENSION_MAP[mimeType];
    }

    if (imageUrl) {
      try {
        const parsed = new URL(imageUrl);
        const extensionFromUrl = extname(parsed.pathname);
        if (extensionFromUrl) {
          return extensionFromUrl;
        }
      } catch {
        const extensionFromUrl = extname(imageUrl);
        if (extensionFromUrl) {
          return extensionFromUrl;
        }
      }
    }

    return ".bin";
  }

  /**
   * Cleanup temporary files generated for image attachments
   */
  private async cleanupTempFiles(tempFiles: string[]): Promise<void> {
    if (tempFiles.length === 0) {
      return;
    }

    await Promise.allSettled(
      tempFiles.map(async (filePath) => {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          logger.warn({ filePath, error }, "Failed to delete temporary image file");
        }
      }),
    );
  }
}
