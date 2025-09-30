import { logger } from "../../observability/logger.ts";
import { $ } from "bun";

export interface CodexCLIResponse {
  response: string;
  // Codex may include additional metadata in structured output
  metadata?: Record<string, unknown>;
}

export interface CodexCLIExecutionOptions {
  prompt: string;
  model?: string;
  timeoutMs?: number;
  workingDir?: string;
}

/**
 * Client for executing Codex CLI commands (codex exec)
 * Supports OpenAI-style chat completions via CLI wrapper
 */
export class CodexCLIClient {
  private readonly defaultModel: string = "claude-sonnet-4";
  private readonly defaultTimeoutMs: number = 120000; // 2 minutes for agent operations

  /**
   * Execute codex CLI command and parse JSON output
   */
  async execute(options: CodexCLIExecutionOptions): Promise<CodexCLIResponse> {
    const {
      prompt,
      model = this.defaultModel,
      timeoutMs = this.defaultTimeoutMs,
      workingDir,
    } = options;

    logger.info({ model, promptLength: prompt.length }, "Executing codex CLI command");

    try {
      // Build command with experimental JSON output
      const args = ["exec", prompt, "--experimental-json"];

      // Only add model if not default (to avoid unsupported model errors)
      if (model && model !== this.defaultModel) {
        args.push("-m", model);
      }

      if (workingDir) {
        args.push("-C", workingDir);
      }

      // Execute with timeout
      const command = $`codex ${args}`.quiet();

      const result = await Promise.race([
        command.text(),
        this.createTimeout(timeoutMs),
      ]) as string;

      // Parse JSON response
      const parsed = this.parseOutput(result);

      logger.info(
        { model, responseLength: parsed.response.length },
        "Codex CLI execution successful",
      );

      return parsed;
    } catch (error) {
      logger.error({ error, model }, "Codex CLI execution failed");
      throw new Error(`Codex CLI execution failed: ${error}`);
    }
  }

  /**
   * Check if codex CLI is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await $`which codex`.quiet();
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
      const output = await $`codex --version 2>&1`.text();
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Parse CLI output, handling JSONL format from --experimental-json flag
   */
  private parseOutput(output: string): CodexCLIResponse {
    // Codex with --experimental-json outputs JSONL (JSON lines)
    // Format: {"type":"item.completed","item":{"id":"item_N","item_type":"assistant_message","text":"..."}}

    const lines = output.trim().split("\n");
    const assistantMessages: string[] = [];
    const metadata: Record<string, unknown> = {};

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);

        // Extract assistant messages
        if (parsed.type === "item.completed" && parsed.item) {
          if (parsed.item.item_type === "assistant_message" && parsed.item.text) {
            assistantMessages.push(parsed.item.text);
          }
        }

        // Collect session metadata
        if (parsed.type === "session.created" && parsed.session_id) {
          metadata.session_id = parsed.session_id;
        }
      } catch {
        // Skip non-JSON lines (ERROR logs, etc.)
        continue;
      }
    }

    if (assistantMessages.length === 0) {
      logger.error({ output: output.slice(0, 500) }, "No assistant messages found in codex output");
      throw new Error("Invalid output from codex CLI - no response found");
    }

    // Combine all assistant messages
    const finalResponse = assistantMessages.join("\n\n");

    return {
      response: finalResponse,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
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