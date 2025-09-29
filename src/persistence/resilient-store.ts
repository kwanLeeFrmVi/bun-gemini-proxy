import { logger } from "../observability/logger.ts";
import type {
  PersistedState,
  StateStore,
} from "./state-store.ts";

export class ResilientStateStore implements StateStore {
  constructor(private primary: StateStore, private fallback: StateStore) {}

  init(): void {
    try {
      this.primary.init();
    } catch (error) {
      logger.error({ error }, "Primary persistence init failed; falling back to JSON store");
      this.fallback.init();
      this.primary = this.fallback;
    }
  }

  load(): PersistedState {
    try {
      return this.primary.load();
    } catch (error) {
      logger.error({ error }, "Primary persistence load failed; using fallback state");
      return this.fallback.load();
    }
  }

  save(state: PersistedState): void {
    try {
      this.primary.save(state);
    } catch (error) {
      logger.error({ error }, "Primary persistence save failed; writing to fallback");
      this.fallback.save(state);
      this.primary = this.fallback;
    }
  }

  upsertKey(...args: Parameters<StateStore["upsertKey"]>): void {
    try {
      this.primary.upsertKey(...args);
    } catch (error) {
      logger.error({ error }, "Primary persistence upsert failed; delegating to fallback");
      this.fallback.upsertKey(...args);
      this.primary = this.fallback;
    }
  }

  recordRequestMetrics(...args: Parameters<StateStore["recordRequestMetrics"]>): void {
    try {
      this.primary.recordRequestMetrics(...args);
    } catch (error) {
      logger.error({ error }, "Primary persistence metrics write failed; delegating to fallback");
      this.fallback.recordRequestMetrics(...args);
      this.primary = this.fallback;
    }
  }

  getDailyUsageStats(): ReturnType<StateStore["getDailyUsageStats"]> {
    try {
      return this.primary.getDailyUsageStats();
    } catch (error) {
      logger.error({ error }, "Primary persistence daily stats failed; using fallback");
      return this.fallback.getDailyUsageStats();
    }
  }

  getWeeklyUsageStats(): ReturnType<StateStore["getWeeklyUsageStats"]> {
    try {
      return this.primary.getWeeklyUsageStats();
    } catch (error) {
      logger.error({ error }, "Primary persistence weekly stats failed; using fallback");
      return this.fallback.getWeeklyUsageStats();
    }
  }
}
