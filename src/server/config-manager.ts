import { EventEmitter } from "node:events";
import { existsSync, readFileSync, watch } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { logger } from "../observability/logger.ts";
import type {
  ApiKeyConfig,
  ConfigDocument,
  MonitoringConfig,
  PersistedStateConfig,
  ProxyConfig,
  ResolvedConfig,
} from "../types/config.ts";

const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  host: "0.0.0.0",
  port: 4806,
  maxPayloadSizeBytes: 10 * 1024 * 1024,
  adminToken: process.env.PROXY_ADMIN_TOKEN ?? "test-admin-token",
  requestTimeoutMs: 10_000,
  upstreamBaseUrl: process.env.GEMINI_UPSTREAM_BASE_URL ?? "https://generativelanguage.googleapis.com",
  mode: process.env.GEMINI_PROXY_MODE === "live" ? "live" : "mock",
  accessTokens: [],
  requireAuth: false,
};

const DEFAULT_MONITORING_CONFIG: MonitoringConfig = {
  healthCheckIntervalSeconds: 30,
  failureThreshold: 3,
  recoveryTimeSeconds: 300,
  windowSeconds: 300,
};

const DEFAULT_PERSISTENCE_CONFIG: PersistedStateConfig = {
  sqlitePath: resolve(".runtime/state.sqlite"),
  fallbackJsonPath: resolve(".runtime/state.json"),
};

export interface ConfigManagerOptions {
  proxyPath?: string;
  keysPath?: string;
}

export type ConfigUpdateHandler = (config: ResolvedConfig) => void;

export class ConfigManager {
  private readonly emitter = new EventEmitter();
  private readonly proxyPath: string;
  private readonly keysPath: string;
  private currentConfig: ResolvedConfig;

  constructor(options: ConfigManagerOptions = {}) {
    this.proxyPath = resolve(options.proxyPath ?? "config/proxy.yaml");
    this.keysPath = resolve(options.keysPath ?? "config/keys.yaml");
    this.currentConfig = this.load();
    this.watchFiles();
  }

  getConfig(): ResolvedConfig {
    return this.currentConfig;
  }

  subscribe(handler: ConfigUpdateHandler): void {
    this.emitter.on("update", handler);
  }

  forceReload(): ResolvedConfig {
    const config = this.load();
    this.currentConfig = config;
    this.emitter.emit("update", config);
    return config;
  }

  private watchFiles(): void {
    const targets = [this.proxyPath, this.keysPath];

    targets.forEach((path) => {
      const performReload = () => {
        try {
          const config = this.load();
          this.currentConfig = config;
          this.emitter.emit("update", config);
          logger.info({ path }, "Configuration reloaded");
        } catch (error) {
          logger.error({ error, path }, "Failed to reload configuration");
        }
      };

      if (existsSync(path)) {
        try {
          watch(path, { persistent: false }, performReload);
        } catch (error) {
          logger.error({ error, path }, "Failed to watch configuration file");
        }
      }

      const directory = resolve(path, "..");
      try {
        watch(directory, { persistent: false }, performReload);
      } catch (error) {
        logger.error({ error, directory }, "Failed to watch configuration directory");
      }
    });
  }

  private load(): ResolvedConfig {
    const proxyDoc = this.readDocument(this.proxyPath);
    const keysDoc = this.readKeysDocument(this.keysPath);

    const proxyConfig: ProxyConfig = {
      ...DEFAULT_PROXY_CONFIG,
      ...(proxyDoc.proxy ?? {}),
      adminToken: process.env.PROXY_ADMIN_TOKEN ?? proxyDoc.proxy?.adminToken ?? null,
      mode: proxyDoc.proxy?.mode === "live" ? "live" : DEFAULT_PROXY_CONFIG.mode,
    } satisfies ProxyConfig;

    const monitoringConfig: MonitoringConfig = {
      ...DEFAULT_MONITORING_CONFIG,
      ...(proxyDoc.monitoring ?? {}),
    } satisfies MonitoringConfig;

    const persistenceConfig: PersistedStateConfig = {
      ...DEFAULT_PERSISTENCE_CONFIG,
      ...(proxyDoc.persistence ?? {}),
    } satisfies PersistedStateConfig;

    let keys = keysDoc;
    if ((keys?.length ?? 0) === 0 && proxyConfig.mode === "mock") {
      keys = [
        {
          name: "mock-key",
          key: "mock-key",
          weight: 1,
          cooldownSeconds: 30,
        },
      ];
    }

    return {
      proxy: proxyConfig,
      monitoring: monitoringConfig,
      persistence: persistenceConfig,
      keys,
    } satisfies ResolvedConfig;
  }

  private readDocument(path: string): ConfigDocument {
    if (!existsSync(path)) {
      return { proxy: undefined, monitoring: undefined, keys: undefined };
    }
    const raw = readFileSync(path, "utf8");
    if (!raw.trim()) {
      return { proxy: undefined, monitoring: undefined, keys: undefined };
    }

    try {
      const parsed = YAML.parse(raw) as ConfigDocument;
      return parsed ?? { proxy: undefined, monitoring: undefined, keys: undefined };
    } catch (error) {
      logger.error({ error, path }, "Failed to parse configuration YAML; using defaults");
      return { proxy: undefined, monitoring: undefined, keys: undefined };
    }
  }

  private readKeysDocument(path: string): ApiKeyConfig[] {
    if (!existsSync(path)) {
      return [];
    }
    const raw = readFileSync(path, "utf8");
    if (!raw.trim()) {
      return [];
    }

    try {
      const parsed = YAML.parse(raw) as { keys?: ApiKeyConfig[] };
      const keys = parsed?.keys ?? [];
      return keys.map((key) => ({
        name: key.name,
        key: key.key,
        weight: key.weight ?? 1,
        cooldownSeconds: key.cooldownSeconds ?? 30,
      }));
    } catch (error) {
      logger.error({ error, path }, "Failed to parse keys configuration; returning empty list");
      return [];
    }
  }
}
