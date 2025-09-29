import { describe, it, expect, mock } from "bun:test";
import { ResilientStateStore } from "../../src/persistence/resilient-store.ts";
import type { StateStore, PersistedState } from "../../src/persistence/state-store.ts";

const createMockStore = (name: string): StateStore => ({
  init: mock(() => console.log(`${name} init`)),
  load: mock(() => {
    console.log(`${name} load`);
    return { keys: [], health: [], circuits: [], metrics: [] };
  }),
  save: mock((_: PersistedState) => console.log(`${name} save`)),
  upsertKey: mock(() => console.log(`${name} upsertKey`)),
  recordRequestMetrics: mock(() => console.log(`${name} recordRequestMetrics`)),
});

describe("ResilientStateStore", () => {
  it("should use the primary store when it is healthy", () => {
    const primaryStore = createMockStore("primary");
    const fallbackStore = createMockStore("fallback");
    const resilientStore = new ResilientStateStore(primaryStore, fallbackStore);

    resilientStore.init();
    resilientStore.load();
    resilientStore.save({ keys: [], health: [], circuits: [], metrics: [] });

    expect(primaryStore.init).toHaveBeenCalledTimes(1);
    expect(primaryStore.load).toHaveBeenCalledTimes(1);
    expect(primaryStore.save).toHaveBeenCalledTimes(1);

    expect(fallbackStore.init).not.toHaveBeenCalled();
    expect(fallbackStore.load).not.toHaveBeenCalled();
    expect(fallbackStore.save).not.toHaveBeenCalled();
  });

  it("should fall back to the secondary store when the primary fails", () => {
    const primaryStore = {
      ...createMockStore("primary"),
      init: mock(() => {
        throw new Error("Primary store failed to initialize");
      }),
    };
    const fallbackStore = createMockStore("fallback");
    const resilientStore = new ResilientStateStore(primaryStore, fallbackStore);

    resilientStore.init();
    resilientStore.load();

    expect(primaryStore.init).toHaveBeenCalledTimes(1);
    expect(fallbackStore.init).toHaveBeenCalledTimes(1);
    expect(fallbackStore.load).toHaveBeenCalledTimes(1);
  });

  it("should switch to the fallback store for subsequent operations after a failure", () => {
    const primaryStore = {
      ...createMockStore("primary"),
      init: mock(() => {
        throw new Error("Primary store failed to initialize");
      }),
    };
    const fallbackStore = createMockStore("fallback");
    const resilientStore = new ResilientStateStore(primaryStore, fallbackStore);

    resilientStore.init(); // Primary fails here, switches to fallback
    resilientStore.save({ keys: [], health: [], circuits: [], metrics: [] });

    expect(fallbackStore.init).toHaveBeenCalledTimes(1);
    expect(fallbackStore.save).toHaveBeenCalledTimes(1);
    expect(primaryStore.save).not.toHaveBeenCalled();
  });
});