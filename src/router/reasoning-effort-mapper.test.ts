import { test, expect } from "bun:test";
import {
  mapReasoningEffortToThinkingBudget,
  getThinkingConfig,
  isValidReasoningEffort,
} from "./reasoning-effort-mapper.ts";

test("mapReasoningEffortToThinkingBudget - valid levels", () => {
  expect(mapReasoningEffortToThinkingBudget("low")).toBe(1024);
  expect(mapReasoningEffortToThinkingBudget("medium")).toBe(8192);
  expect(mapReasoningEffortToThinkingBudget("high")).toBe(24576);
});

test("mapReasoningEffortToThinkingBudget - case insensitive", () => {
  expect(mapReasoningEffortToThinkingBudget("LOW")).toBe(1024);
  expect(mapReasoningEffortToThinkingBudget("Medium")).toBe(8192);
  expect(mapReasoningEffortToThinkingBudget("HIGH")).toBe(24576);
});

test("mapReasoningEffortToThinkingBudget - unknown values default to dynamic", () => {
  expect(mapReasoningEffortToThinkingBudget("unknown")).toBe(-1);
  expect(mapReasoningEffortToThinkingBudget("")).toBe(-1);
  expect(mapReasoningEffortToThinkingBudget("very-high")).toBe(-1);
});

test("getThinkingConfig - returns correct config", () => {
  const config = getThinkingConfig("medium");
  expect(config).toEqual({
    include_thoughts: true,
    thinking_budget: 8192,
  });
});

test("getThinkingConfig - always includes thoughts", () => {
  expect(getThinkingConfig("low").include_thoughts).toBe(true);
  expect(getThinkingConfig("high").include_thoughts).toBe(true);
  expect(getThinkingConfig("unknown").include_thoughts).toBe(true);
});

test("isValidReasoningEffort - valid values", () => {
  expect(isValidReasoningEffort("low")).toBe(true);
  expect(isValidReasoningEffort("medium")).toBe(true);
  expect(isValidReasoningEffort("high")).toBe(true);
});

test("isValidReasoningEffort - case insensitive", () => {
  expect(isValidReasoningEffort("LOW")).toBe(true);
  expect(isValidReasoningEffort("Medium")).toBe(true);
  expect(isValidReasoningEffort("HIGH")).toBe(true);
});

test("isValidReasoningEffort - invalid values", () => {
  expect(isValidReasoningEffort("unknown")).toBe(false);
  expect(isValidReasoningEffort("")).toBe(false);
  expect(isValidReasoningEffort(123)).toBe(false);
  expect(isValidReasoningEffort(null)).toBe(false);
  expect(isValidReasoningEffort(undefined)).toBe(false);
  expect(isValidReasoningEffort({})).toBe(false);
});
