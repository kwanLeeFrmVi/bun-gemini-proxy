export interface ProxyConfig {
  host: string;
  port: number;
  maxPayloadSizeBytes: number;
  adminToken: string | null;
  requestTimeoutMs: number;
  upstreamBaseUrl: string;
  mode: "live" | "mock";
}

export interface ApiKeyConfig {
  name: string;
  key: string;
  weight?: number;
  cooldownSeconds?: number;
}

export interface MonitoringConfig {
  healthCheckIntervalSeconds: number;
  failureThreshold: number;
  recoveryTimeSeconds: number;
  windowSeconds: number;
}

export interface PersistedStateConfig {
  sqlitePath: string;
  fallbackJsonPath: string;
}

export interface ConfigDocument {
  proxy: Partial<ProxyConfig> | undefined;
  keys: ApiKeyConfig[] | undefined;
  monitoring: Partial<MonitoringConfig> | undefined;
  persistence?: Partial<PersistedStateConfig>;
}

export interface ResolvedConfig {
  proxy: ProxyConfig;
  keys: ApiKeyConfig[];
  monitoring: MonitoringConfig;
  persistence: PersistedStateConfig;
}
