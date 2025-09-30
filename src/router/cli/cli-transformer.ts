import type { CLIResponse } from "./gemini-cli-client.ts";

/**
 * OpenAI chat completion request format
 */
export interface OpenAIChatRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

/**
 * OpenAI chat completion response format
 */
export interface OpenAIChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: "stop" | "length" | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI models list response format
 */
export interface OpenAIModelsResponse {
  object: "list";
  data: Array<{
    id: string;
    object: "model";
    created: number;
    owned_by: string;
  }>;
}

export class CLITransformer {
  private readonly supportedModels = [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash-exp",
    "gemini-exp-1206",
  ];

  /**
   * Convert OpenAI messages array to single prompt string
   */
  messagesToPrompt(messages: OpenAIChatRequest["messages"]): string {
    return messages
      .map(msg => {
        const rolePrefix = msg.role === "system"
          ? "System: "
          : msg.role === "user"
          ? "User: "
          : "Assistant: ";
        return `${rolePrefix}${msg.content}`;
      })
      .join("\n\n");
  }

  /**
   * Normalize model name (strip "models/" prefix if present)
   */
  normalizeModel(model: string): string {
    return model.startsWith("models/") ? model.slice(7) : model;
  }

  /**
   * Validate model is supported
   */
  isModelSupported(model: string): boolean {
    const normalized = this.normalizeModel(model);
    return this.supportedModels.includes(normalized);
  }

  /**
   * Convert CLI response to OpenAI chat completion format
   */
  toOpenAIResponse(cliResponse: CLIResponse, model: string): OpenAIChatResponse {
    const normalizedModel = this.normalizeModel(model);
    const modelStats = cliResponse.stats.models[normalizedModel] ||
                      cliResponse.stats.models[`models/${normalizedModel}`] ||
                      Object.values(cliResponse.stats.models)[0];

    // Generate unique ID and timestamp
    const id = `chatcmpl-${this.generateId()}`;
    const created = Math.floor(Date.now() / 1000);

    // Extract token usage
    const usage = modelStats?.tokens
      ? {
          prompt_tokens: modelStats.tokens.prompt || 0,
          completion_tokens: modelStats.tokens.candidates || 0,
          total_tokens: modelStats.tokens.total || 0,
        }
      : {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        };

    return {
      id,
      object: "chat.completion",
      created,
      model: normalizedModel,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: cliResponse.response,
          },
          finish_reason: "stop",
        },
      ],
      usage,
    };
  }

  /**
   * Get list of supported models in OpenAI format
   */
  getModelsResponse(): OpenAIModelsResponse {
    const created = Math.floor(Date.now() / 1000);

    return {
      object: "list",
      data: this.supportedModels.map(modelId => ({
        id: modelId,
        object: "model" as const,
        created,
        owned_by: "google",
      })),
    };
  }

  /**
   * Generate random ID for responses
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }
}