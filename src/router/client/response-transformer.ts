interface ModelMetadata {
  context_length: number;
  max_completion_tokens?: number;
  supported_parameters: string[];
  capabilities?: {
    vision?: boolean;
    function_calling?: boolean;
    reasoning?: boolean;
  };
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

interface OpenRouterModel {
  id: string;
  context_length?: number;
  supported_parameters?: string[];
  top_provider?: {
    max_completion_tokens?: number;
  };
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  architecture?: {
    input_modalities?: string[];
  };
}

interface OpenRouterCache {
  data: Map<string, OpenRouterModel>;
  timestamp: number;
}

/**
 * ResponseTransformer converts Gemini API responses to OpenAI-compatible format.
 * Handles model listings and model details transformations.
 */
export class ResponseTransformer {
  private openRouterCache: OpenRouterCache | null = null;
  private readonly CACHE_TTL_MS = 3600000; // 1 hour
  private readonly OPENROUTER_API = "https://openrouter.ai/api/v1/models";

  private readonly modelMetadata: Map<string, ModelMetadata> = new Map([
    // Gemini 2.5 models - all support thinking/reasoning
    [
      "gemini-2.5-pro",
      {
        context_length: 1048576,
        max_completion_tokens: 65536,
        supported_parameters: [
          "include_reasoning",
          "max_tokens",
          "reasoning",
          "response_format",
          "seed",
          "stop",
          "temperature",
          "tool_choice",
          "tools",
          "top_p",
          "stream",
        ],
        capabilities: { vision: true, function_calling: true, reasoning: true },
      },
    ],
    [
      "gemini-2.5-flash",
      {
        context_length: 1048576,
        max_completion_tokens: 65536,
        supported_parameters: [
          "include_reasoning",
          "max_tokens",
          "reasoning",
          "response_format",
          "seed",
          "stop",
          "temperature",
          "tool_choice",
          "tools",
          "top_p",
          "stream",
        ],
        capabilities: { vision: true, function_calling: true, reasoning: true },
      },
    ],

    // Gemini 2.0 thinking models
    [
      "gemini-2.0-flash-thinking-exp",
      {
        context_length: 32768,
        max_completion_tokens: 8192,
        supported_parameters: [
          "include_reasoning",
          "max_tokens",
          "reasoning",
          "temperature",
          "top_p",
          "stream",
        ],
        capabilities: { reasoning: true },
      },
    ],
    [
      "gemini-2.0-flash-thinking-exp-01-21",
      {
        context_length: 32768,
        max_completion_tokens: 8192,
        supported_parameters: [
          "include_reasoning",
          "max_tokens",
          "reasoning",
          "temperature",
          "top_p",
          "stream",
        ],
        capabilities: { reasoning: true },
      },
    ],

    // Gemini 2.0 standard models
    [
      "gemini-2.0-flash-exp",
      {
        context_length: 1048576,
        max_completion_tokens: 8192,
        supported_parameters: [
          "max_tokens",
          "response_format",
          "seed",
          "stop",
          "temperature",
          "tool_choice",
          "tools",
          "top_p",
          "stream",
        ],
        capabilities: { vision: true, function_calling: true },
      },
    ],
    [
      "gemini-2.0-flash",
      {
        context_length: 1048576,
        max_completion_tokens: 8192,
        supported_parameters: [
          "max_tokens",
          "response_format",
          "seed",
          "stop",
          "temperature",
          "tool_choice",
          "tools",
          "top_p",
          "stream",
        ],
        capabilities: { vision: true, function_calling: true },
      },
    ],

    // Gemini 1.5 models
    [
      "gemini-1.5-pro",
      {
        context_length: 2097152,
        max_completion_tokens: 8192,
        supported_parameters: [
          "max_tokens",
          "response_format",
          "seed",
          "stop",
          "temperature",
          "tool_choice",
          "tools",
          "top_p",
          "stream",
        ],
        capabilities: { vision: true, function_calling: true },
      },
    ],
    [
      "gemini-1.5-flash",
      {
        context_length: 1048576,
        max_completion_tokens: 8192,
        supported_parameters: [
          "max_tokens",
          "response_format",
          "seed",
          "stop",
          "temperature",
          "tool_choice",
          "tools",
          "top_p",
          "stream",
        ],
        capabilities: { vision: true, function_calling: true },
      },
    ],
  ]);

  /**
   * Fetch model metadata from OpenRouter API
   */
  private async fetchOpenRouterMetadata(): Promise<void> {
    try {
      const response = await fetch(this.OPENROUTER_API, {
        headers: {
          "User-Agent": "bun-gemini-proxy/1.0",
        },
      });

      if (!response.ok) {
        console.warn(`Failed to fetch OpenRouter models: ${response.status}`);
        return;
      }

      const data = (await response.json()) as { data?: OpenRouterModel[] };
      if (!data.data) {
        return;
      }

      const cache = new Map<string, OpenRouterModel>();
      for (const model of data.data) {
        // Only cache Google/Gemini models
        if (model.id.startsWith("google/gemini")) {
          // Remove 'google/' prefix to match our model IDs
          const modelId = model.id.replace("google/", "");
          cache.set(modelId, model);
        }
      }

      this.openRouterCache = {
        data: cache,
        timestamp: Date.now(),
      };

      console.log(`Cached ${cache.size} Gemini models from OpenRouter`);
    } catch (error) {
      console.warn("Failed to fetch OpenRouter metadata:", error);
    }
  }

  /**
   * Get metadata for a model, with OpenRouter enrichment and pattern matching
   */
  private async getModelMetadata(modelId: string): Promise<ModelMetadata> {
    // Refresh OpenRouter cache if needed
    if (!this.openRouterCache || Date.now() - this.openRouterCache.timestamp > this.CACHE_TTL_MS) {
      await this.fetchOpenRouterMetadata();
    }

    // Try OpenRouter first
    const openRouterModel = this.openRouterCache?.data.get(modelId);

    // Try exact match in local metadata
    let localMetadata: ModelMetadata | undefined = this.modelMetadata.get(modelId);

    // Try pattern matching if no exact match
    if (!localMetadata) {
      for (const [pattern, metadata] of this.modelMetadata.entries()) {
        if (modelId.startsWith(pattern)) {
          localMetadata = metadata;
          break;
        }
      }
    }

    // Merge OpenRouter data with local metadata
    if (openRouterModel) {
      const hasVision = openRouterModel.architecture?.input_modalities?.includes("image") ?? false;
      const hasReasoning =
        openRouterModel.supported_parameters?.some(
          (p) => p === "include_reasoning" || p === "reasoning",
        ) ?? false;

      return {
        context_length: openRouterModel.context_length ?? localMetadata?.context_length ?? 32768,
        max_completion_tokens:
          openRouterModel.top_provider?.max_completion_tokens ??
          localMetadata?.max_completion_tokens ??
          8192,
        supported_parameters: openRouterModel.supported_parameters ??
          localMetadata?.supported_parameters ?? ["max_tokens", "temperature", "top_p", "stream"],
        capabilities: {
          vision: hasVision,
          function_calling: localMetadata?.capabilities?.function_calling ?? false,
          reasoning: hasReasoning,
        },
        pricing: openRouterModel.pricing,
      };
    }

    // Fall back to local metadata or defaults
    if (localMetadata) {
      return localMetadata;
    }

    return {
      context_length: 32768,
      max_completion_tokens: 8192,
      supported_parameters: ["max_tokens", "temperature", "top_p", "stream"],
    };
  }

  /**
   * Transform Gemini model list response to OpenAI format with enriched metadata.
   */
  async transformModelList(
    geminiResponse: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const models = (geminiResponse.models as Array<{ name: string }> | undefined) ?? [];

    const enrichedModels = await Promise.all(
      models.map(async (model) => {
        const modelId = model.name.replace("models/", "");
        const metadata = await this.getModelMetadata(modelId);

        return {
          id: modelId,
          object: "model",
          created: 0,
          owned_by: "google",
          context_length: metadata.context_length,
          max_completion_tokens: metadata.max_completion_tokens,
          supported_parameters: metadata.supported_parameters,
          capabilities: metadata.capabilities,
          pricing: metadata.pricing,
        };
      }),
    );

    return {
      object: "list",
      data: enrichedModels,
    };
  }

  /**
   * Transform Gemini model detail response to OpenAI format with enriched metadata.
   */
  async transformModel(geminiResponse: Record<string, unknown>): Promise<Record<string, unknown>> {
    const model = geminiResponse as { name: string };
    const modelId = model.name.replace("models/", "");
    const metadata = await this.getModelMetadata(modelId);

    return {
      id: modelId,
      object: "model",
      created: 0,
      owned_by: "google",
      context_length: metadata.context_length,
      max_completion_tokens: metadata.max_completion_tokens,
      supported_parameters: metadata.supported_parameters,
      capabilities: metadata.capabilities,
      pricing: metadata.pricing,
    };
  }

  /**
   * Check if a model ID looks like a valid Gemini model.
   * Simple heuristic for mock mode validation.
   */
  isValidGeminiModel(modelId: string): boolean {
    return modelId.startsWith("gemini-");
  }
}
