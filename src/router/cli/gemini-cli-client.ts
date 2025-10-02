import { logger } from "../../observability/logger.ts";
import { $ } from "bun";

export interface CLIResponse {
  response: string;
  stats: {
    models: Record<
      string,
      {
        api: {
          totalRequests: number;
          totalErrors: number;
          totalLatencyMs: number;
        };
        tokens: {
          prompt: number;
          candidates: number;
          total: number;
          cached: number;
          thoughts: number;
          tool: number;
        };
      }
    >;
    tools: unknown;
    files: unknown;
  };
}

export interface CLIExecutionOptions {
  prompt: string;
  model?: string;
  timeoutMs?: number;
}

export class GeminiCLIClient {
  private readonly defaultModel: string = "gemini-2.5-pro";
  private readonly defaultTimeoutMs: number = 30000;

  /**
   * Execute gemini CLI command and parse JSON output
   */
  async execute(options: CLIExecutionOptions): Promise<CLIResponse> {
    const { prompt, model = this.defaultModel, timeoutMs = this.defaultTimeoutMs } = options;

    logger.info({ model, promptLength: prompt.length }, "Executing gemini CLI command");

    try {
      // Build command - suppress stderr to avoid DEBUG logs
      const command = model
        ? $`gemini ${prompt} -m ${model} --output-format json`.quiet()
        : $`gemini ${prompt} --output-format json`.quiet();

      // Execute with timeout
      const result = (await Promise.race([
        command.text(),
        this.createTimeout(timeoutMs),
      ])) as string;

      // Parse JSON response
      const parsed = this.parseOutput(result);

      logger.info({ model, responseLength: parsed.response.length }, "CLI execution successful");

      return parsed;
    } catch (error) {
      logger.error({ error, model }, "CLI execution failed");
      throw new Error(`Gemini CLI execution failed: ${error}`);
    }
  }

  /**
   * Check if gemini CLI is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await $`which gemini`.quiet();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get CLI version
   */
  async getVersion(): Promise<string | null> {
    try {
      const output = await $`gemini --version 2>&1`.text();
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Parse CLI output, handling DEBUG logs and GEMINI.md content
   */
  private parseOutput(output: string): CLIResponse {
    // The CLI outputs GEMINI.md content, then DEBUG logs, then JSON
    // We need to find the JSON object at the end

    // Find the last occurrence of { that starts a JSON object
    const jsonStartIndex = output.lastIndexOf("\n{");
    if (jsonStartIndex === -1) {
      logger.error({ output: output.slice(0, 500) }, "No JSON object found in output");
      throw new Error("Invalid JSON output from gemini CLI");
    }

    const jsonText = output.slice(jsonStartIndex + 1).trim();

    try {
      const parsed = JSON.parse(jsonText);

      // Validate required fields
      if (typeof parsed.response !== "string") {
        throw new Error("Missing or invalid 'response' field");
      }

      return parsed as CLIResponse;
    } catch (error) {
      logger.error({ error, jsonText: jsonText.slice(0, 500) }, "Failed to parse CLI JSON output");
      throw new Error("Invalid JSON output from gemini CLI");
    }
  }

  /**
   * Create timeout promise
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`CLI execution timeout after ${ms}ms`)), ms);
    });
  }
}
