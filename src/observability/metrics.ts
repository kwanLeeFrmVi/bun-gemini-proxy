import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();

collectDefaultMetrics({ register: registry, prefix: "gemini_proxy_" });

export const requestCounter = new Counter({
  name: "gemini_proxy_requests_total",
  help: "Total requests handled by proxy",
  labelNames: ["endpoint", "method", "status", "result"],
  registers: [registry],
});

export const requestDuration = new Histogram({
  name: "gemini_proxy_request_duration_seconds",
  help: "Duration histogram for proxy requests",
  labelNames: ["endpoint", "method", "result"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const upstreamDuration = new Histogram({
  name: "gemini_proxy_upstream_duration_seconds",
  help: "Duration histogram for upstream Gemini calls",
  labelNames: ["endpoint", "result"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const keyHealthGauge = new Gauge({
  name: "gemini_proxy_key_health_score",
  help: "Health score per API key",
  labelNames: ["key_id", "key_name"],
  registers: [registry],
});

export const circuitStateGauge = new Gauge({
  name: "gemini_proxy_key_circuit_state",
  help: "Circuit breaker state per API key",
  labelNames: ["key_id", "key_name"],
  registers: [registry],
});

export const activeRequestsGauge = new Gauge({
  name: "gemini_proxy_active_requests",
  help: "Number of active in-flight requests",
  labelNames: ["endpoint"],
  registers: [registry],
});

export function observeKeyHealth(
  keyId: string,
  keyName: string,
  score: number,
  circuitState: number,
): void {
  keyHealthGauge.set({ key_id: keyId, key_name: keyName }, score);
  circuitStateGauge.set({ key_id: keyId, key_name: keyName }, circuitState);
}
