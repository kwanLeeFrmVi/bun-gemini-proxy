/**
 * SSE (Server-Sent Events) transformer for OpenAI streaming format
 * Converts text chunks into OpenAI-compatible SSE events
 */

export interface OpenAIStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string;
      role?: "assistant";
    };
    finish_reason: "stop" | "length" | null;
  }>;
}

export class SSETransformer {
  private readonly completionId: string;
  private readonly created: number;

  constructor(_model: string) {
    this.completionId = `chatcmpl-${this.generateId()}`;
    this.created = Math.floor(Date.now() / 1000);
  }

  /**
   * Create the initial chunk with role
   */
  createInitialChunk(model: string): string {
    const chunk: OpenAIStreamChunk = {
      id: this.completionId,
      object: "chat.completion.chunk",
      created: this.created,
      model,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
          },
          finish_reason: null,
        },
      ],
    };

    return `data: ${JSON.stringify(chunk)}\n\n`;
  }

  /**
   * Create a content chunk
   */
  createContentChunk(model: string, content: string): string {
    const chunk: OpenAIStreamChunk = {
      id: this.completionId,
      object: "chat.completion.chunk",
      created: this.created,
      model,
      choices: [
        {
          index: 0,
          delta: {
            content,
          },
          finish_reason: null,
        },
      ],
    };

    return `data: ${JSON.stringify(chunk)}\n\n`;
  }

  /**
   * Create the final chunk with finish_reason
   */
  createFinalChunk(model: string): string {
    const chunk: OpenAIStreamChunk = {
      id: this.completionId,
      object: "chat.completion.chunk",
      created: this.created,
      model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "stop",
        },
      ],
    };

    return `data: ${JSON.stringify(chunk)}\n\n`;
  }

  /**
   * Create the [DONE] message
   */
  createDoneMessage(): string {
    return "data: [DONE]\n\n";
  }

  /**
   * Generate random ID for completion
   */
  private generateId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }
}