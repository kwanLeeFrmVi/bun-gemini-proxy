/**
 * Maps OpenAI's reasoning_effort parameter to Gemini's thinking_budget token counts.
 *
 * OpenAI reasoning_effort levels:
 * - low: Quick reasoning with minimal tokens
 * - medium: Balanced reasoning
 * - high: Deep reasoning with maximum tokens
 *
 * Gemini thinking_budget ranges by model:
 * - 2.5 Pro: 128 to 32768 tokens (cannot disable)
 * - 2.5 Flash: 0 to 24576 tokens
 * - 2.5 Flash Lite: 512 to 24576 tokens
 * - Special value -1: Dynamic thinking (model decides)
 */

export type ReasoningEffort = "low" | "medium" | "high";

const REASONING_EFFORT_MAP: Record<ReasoningEffort, number> = {
  low: 1024,
  medium: 8192,
  high: 24576,
};

/**
 * Convert OpenAI reasoning_effort to Gemini thinking_budget.
 *
 * @param reasoningEffort - OpenAI reasoning effort level
 * @returns Gemini thinking_budget token count, or -1 for dynamic thinking if unknown
 */
export function mapReasoningEffortToThinkingBudget(reasoningEffort: string): number {
  const normalized = reasoningEffort.toLowerCase() as ReasoningEffort;
  return REASONING_EFFORT_MAP[normalized] ?? -1; // Default to dynamic thinking
}

/**
 * Get thinking configuration for a given reasoning effort.
 *
 * @param reasoningEffort - OpenAI reasoning effort level
 * @returns Gemini thinking_config object
 */
export function getThinkingConfig(reasoningEffort: string): {
  include_thoughts: boolean;
  thinking_budget: number;
} {
  return {
    include_thoughts: true,
    thinking_budget: mapReasoningEffortToThinkingBudget(reasoningEffort),
  };
}

/**
 * Check if a reasoning effort value is valid.
 *
 * @param reasoningEffort - Value to check
 * @returns true if valid reasoning effort level
 */
export function isValidReasoningEffort(reasoningEffort: unknown): reasoningEffort is ReasoningEffort {
  if (typeof reasoningEffort !== "string") return false;
  const normalized = reasoningEffort.toLowerCase();
  return normalized === "low" || normalized === "medium" || normalized === "high";
}
