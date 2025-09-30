/**
 * State Store Module - Backward Compatibility Re-exports
 *
 * This file maintains backward compatibility by re-exporting types and
 * implementations from their new locations after refactoring.
 *
 * New code should import directly from:
 * - ./types.ts - Interfaces and type definitions
 * - ./sqlite-store.ts - SQLite implementation
 * - ./json-store.ts - JSON implementation
 * - ./stats-calculator.ts - Statistics utilities
 */

// Type definitions
export type { PersistedState, StateStore } from "./types.ts";
export type { UsageStats } from "./stats-calculator.ts";

// Implementations
export { SQLiteStateStore } from "./sqlite-store.ts";
export { JsonStateStore } from "./json-store.ts";
export { StatsCalculator } from "./stats-calculator.ts";