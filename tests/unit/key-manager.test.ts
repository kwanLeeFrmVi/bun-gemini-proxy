import { describe, it, expect, beforeEach, mock, afterEach, setSystemTime } from "bun:test";
import { KeyManager } from "../../src/keys/key-manager.ts";
import type { StateStore, PersistedState } from "../../src/persistence/state-store.ts";
import type { ApiKeyConfig, MonitoringConfig } from "../../src/types/config.ts";

// A mock state store for testing
const createMockStateStore = (): StateStore => ({
  init: mock(() => {}),
  load: mock(() => ({ keys: [], health: [], circuits: [], metrics: [] })),
  save: mock(() => {}),
  upsertKey: mock(() => {}),
  recordRequestMetrics: mock(() => {}),
});

const defaultMonitoringConfig: MonitoringConfig = {
  failureThreshold: 3,
  recoveryTimeSeconds: 60,
  windowSeconds: 300,
  healthCheckIntervalSeconds: 15,
};

describe("KeyManager", () => {
  let keyManager: KeyManager;
  let mockStateStore: StateStore;

  beforeEach(() => {
    setSystemTime();
    mockStateStore = createMockStateStore();
    keyManager = new KeyManager({
      monitoring: defaultMonitoringConfig,
      persistence: mockStateStore,
    });
  });

  afterEach(() => {
    setSystemTime();
  });

  it("should bootstrap keys from configuration", () => {
    const configKeys: ApiKeyConfig[] = [
      { name: "key1", key: "key-value-1", weight: 100 },
      { name: "key2", key: "key-value-2" },
    ];
    const persistedState: PersistedState = { keys: [], health: [], circuits: [], metrics: [] };

    keyManager.bootstrap(configKeys, persistedState);

    const keys = keyManager.listKeys();
    expect(keys.length).toBe(2);
    const key1 = keys.find((k) => k.name === "key1");
    const key2 = keys.find((k) => k.name === "key2");
    expect(key1?.weight).toBe(100);
    expect(key2?.weight).toBe(1);
  });

  it("should select an active key", () => {
    const configKeys: ApiKeyConfig[] = [{ name: "key1", key: "key-value-1" }];
    keyManager.bootstrap(configKeys, { keys: [], health: [], circuits: [], metrics: [] });

    const selection = keyManager.selectKey();
    expect(selection).not.toBeNull();
    expect(selection?.record.name).toBe("key1");
  });

  it("should not select a disabled key", () => {
    const configKeys: ApiKeyConfig[] = [{ name: "key1", key: "key-value-1" }];
    keyManager.bootstrap(configKeys, { keys: [], health: [], circuits: [], metrics: [] });
    keyManager.disableKey("key1");

    const selection = keyManager.selectKey();
    expect(selection).toBeNull();
  });

  it("should open circuit after reaching failure threshold", () => {
    const configKeys: ApiKeyConfig[] = [{ name: "key1", key: "key-value-1" }];
    keyManager.bootstrap(configKeys, { keys: [], health: [], circuits: [], metrics: [] });

    for (let i = 0; i < defaultMonitoringConfig.failureThreshold; i++) {
      keyManager.recordFailure("key1", "test_failure", false, 100);
    }

    const keyStatus = keyManager.listKeys()[0];
    expect(keyStatus?.status).toBe("circuit_open");

    const selection = keyManager.selectKey();
    expect(selection).toBeNull();
  });

  it("should transition to half-open state after recovery time", () => {
    const configKeys: ApiKeyConfig[] = [{ name: "key1", key: "key-value-1" }];
    keyManager.bootstrap(configKeys, { keys: [], health: [], circuits: [], metrics: [] });

    for (let i = 0; i < defaultMonitoringConfig.failureThreshold; i++) {
      keyManager.recordFailure("key1", "test_failure", false, 100);
    }

    let keyStatus = keyManager.listKeys()[0];
    expect(keyStatus?.status).toBe("circuit_open");

    setSystemTime(new Date(Date.now() + (defaultMonitoringConfig.recoveryTimeSeconds + 1) * 1000));
    keyManager.evaluateCircuitState("key1");

    keyStatus = keyManager.listKeys()[0];
    expect(keyStatus?.status).toBe("circuit_half_open");

    const selection = keyManager.selectKey();
    expect(selection).not.toBeNull();
  });

  it("should close circuit after a success in half-open state", () => {
    const configKeys: ApiKeyConfig[] = [{ name: "key1", key: "key-value-1" }];
    keyManager.bootstrap(configKeys, { keys: [], health: [], circuits: [], metrics: [] });

    for (let i = 0; i < defaultMonitoringConfig.failureThreshold; i++) {
      keyManager.recordFailure("key1", "test_failure", false, 100);
    }

    setSystemTime(new Date(Date.now() + (defaultMonitoringConfig.recoveryTimeSeconds + 1) * 1000));
    keyManager.evaluateCircuitState("key1");

    let keyStatus = keyManager.listKeys()[0];
    expect(keyStatus?.status).toBe("circuit_half_open");

    keyManager.recordSuccess("key1", 100);

    keyStatus = keyManager.listKeys()[0];
    expect(keyStatus?.status).toBe("active");
    expect(keyStatus?.failureCount).toBe(0);
  });
});
