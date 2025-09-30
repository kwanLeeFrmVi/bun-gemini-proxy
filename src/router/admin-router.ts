import type { Registry } from "prom-client";
import type { ConfigManager } from "../server/config-manager.ts";
import type { KeyManager } from "../keys/key-manager.ts";
import { jsonResponse, errorResponse } from "./responses.ts";
import { logger } from "../observability/logger.ts";

export interface AdminRouterOptions {
  adminToken: string | null;
  keyManager: KeyManager;
  configManager: ConfigManager;
  metricsRegistry: Registry;
  startedAt: Date;
}

export class AdminRouter {
  private adminToken: string | null;
  private readonly keyManager: KeyManager;
  private readonly configManager: ConfigManager;
  private readonly metricsRegistry: Registry;
  private readonly startedAt: Date;

  constructor(options: AdminRouterOptions) {
    this.adminToken = options.adminToken;
    this.keyManager = options.keyManager;
    this.configManager = options.configManager;
    this.metricsRegistry = options.metricsRegistry;
    this.startedAt = options.startedAt;
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/admin")) {
      return errorResponse("Not found", 404, "not_found");
    }

    if (!(await this.authorize(request))) {
      return errorResponse("Unauthorized", 401, "unauthorized");
    }

    if (url.pathname === "/admin/health" && request.method === "GET") {
      return this.health();
    }

    if (url.pathname === "/admin/keys" && request.method === "GET") {
      return this.listKeys();
    }

    if (url.pathname.startsWith("/admin/keys/") && request.method === "POST") {
      return this.toggleKey(url.pathname);
    }

    if (url.pathname === "/admin/metrics" && request.method === "GET") {
      return this.metrics();
    }

    if (url.pathname === "/admin/config/reload" && request.method === "POST") {
      return this.reloadConfig();
    }

    return errorResponse("Admin endpoint not found", 404, "not_found", {
      path: url.pathname,
    });
  }

  updateAdminToken(token: string | null): void {
    this.adminToken = token;
  }

  private async authorize(request: Request): Promise<boolean> {
    if (!this.adminToken) {
      return true;
    }
    const header = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${this.adminToken}`;
    return header === expected;
  }

  private health(): Response {
    const keys = this.keyManager.listKeys();
    const total = keys.length;
    const healthy = keys.filter((key) => key.status === "active").length;
    const disabled = keys.filter((key) => key.status === "disabled").length;
    const unhealthy = total - healthy - disabled;

    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (healthy === 0) {
      status = "unhealthy";
    } else if (unhealthy > 0) {
      status = "degraded";
    }

    return jsonResponse({
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startedAt.getTime()) / 1000),
      keys: {
        total,
        healthy,
        unhealthy,
        disabled,
      },
    });
  }

  private listKeys(): Response {
    const keys = this.keyManager.listKeys().map((key) => ({
      id: key.id,
      name: key.name,
      status: key.status,
      health_score: key.healthScore,
      last_used: key.lastUsed ? key.lastUsed.toISOString() : null,
      failure_count: key.failureCount,
      next_retry: key.nextRetry ? key.nextRetry.toISOString() : null,
      weight: key.weight,
    }));

    return jsonResponse({ keys });
  }

  private toggleKey(pathname: string): Response {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length < 4) {
      return errorResponse("Invalid key path", 400, "invalid_request_error");
    }

    const keyId = decodeURIComponent(segments[2] ?? "");
    const action = segments[3];

    if (!keyId) {
      return errorResponse("Missing key identifier", 400, "invalid_request_error");
    }

    if (action === "enable") {
      const success = this.keyManager.enableKey(keyId);
      if (!success) {
        return errorResponse("Key not found", 404, "not_found");
      }
      return jsonResponse({ success: true, message: "Key enabled", key_id: keyId });
    }

    if (action === "disable") {
      const success = this.keyManager.disableKey(keyId);
      if (!success) {
        return errorResponse("Key not found", 404, "not_found");
      }
      return jsonResponse({ success: true, message: "Key disabled", key_id: keyId });
    }

    return errorResponse("Unsupported action", 400, "invalid_request_error", { action });
  }

  private async metrics(): Promise<Response> {
    const payload = await this.metricsRegistry.metrics();
    return new Response(payload, {
      status: 200,
      headers: {
        "content-type": "text/plain; version=0.0.4",
        "cache-control": "no-cache",
      },
    });
  }

  private reloadConfig(): Response {
    const before = this.configManager.getConfig();
    const beforeIdSet = new Set(before.keys.map((key) => key.name));

    const updated = this.configManager.forceReload();
    const afterIdSet = new Set(updated.keys.map((key) => key.name));

    const keysAdded = [...afterIdSet].filter((id) => !beforeIdSet.has(id)).length;
    const keysRemoved = [...beforeIdSet].filter((id) => !afterIdSet.has(id)).length;
    const keysUpdated = [...afterIdSet].filter((id) => beforeIdSet.has(id)).length;

    logger.info({ keysAdded, keysRemoved, keysUpdated }, "Configuration reloaded via admin endpoint");

    return jsonResponse({
      success: true,
      timestamp: new Date().toISOString(),
      changes: {
        keys_added: keysAdded,
        keys_removed: keysRemoved,
        keys_updated: Math.max(0, keysUpdated),
      },
    });
  }
}
