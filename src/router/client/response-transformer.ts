/**
 * ResponseTransformer converts Gemini API responses to OpenAI-compatible format.
 * Handles model listings and model details transformations.
 */
export class ResponseTransformer {
  /**
   * Transform Gemini model list response to OpenAI format.
   */
  transformModelList(geminiResponse: Record<string, unknown>): Record<string, unknown> {
    const models = (geminiResponse.models as Array<{ name: string }> | undefined) ?? [];

    return {
      object: "list",
      data: models.map((model) => ({
        id: model.name.replace("models/", ""),
        object: "model",
        created: 0,
        owned_by: "google",
      })),
    };
  }

  /**
   * Transform Gemini model detail response to OpenAI format.
   */
  transformModel(geminiResponse: Record<string, unknown>): Record<string, unknown> {
    const model = geminiResponse as { name: string };
    return {
      id: model.name.replace("models/", ""),
      object: "model",
      created: 0,
      owned_by: "google",
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