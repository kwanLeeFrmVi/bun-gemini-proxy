import type { Server } from "bun";
import { logger } from "../observability/logger.ts";
import { registry } from "../observability/metrics.ts";
import { ConfigManager } from "./config-manager.ts";
import { KeyManager } from "../keys/key-manager.ts";
import { GeminiClient } from "../router/gemini-client.ts";
import { ProxyRouter } from "../router/proxy-router.ts";
import { AdminRouter } from "../router/admin-router.ts";
import { GeminiCLIRouter } from "../router/cli/gemini-cli-router.ts";
import { CodexCLIRouter } from "../router/cli/codex-cli-router.ts";
import {
  JsonStateStore,
  SQLiteStateStore,
} from "../persistence/state-store.ts";
import { ResilientStateStore } from "../persistence/resilient-store.ts";
import { errorResponse } from "../router/responses.ts";

export interface ServerOptions {
  host?: string;
  port?: number;
  listen?: boolean;
}

export interface ProxyServerContext {
  server: Server | null;
  configManager: ConfigManager;
  keyManager: KeyManager;
  fetch(request: Request): Promise<Response>;
  stop(): Promise<void>;
}

export function startProxyServer(overrides: ServerOptions = {}): ProxyServerContext {
  const startedAt = new Date();
  const configManager = new ConfigManager();
  const resolvedConfig = configManager.getConfig();

  const proxyConfig = { ...resolvedConfig.proxy };
  const monitoringConfig = { ...resolvedConfig.monitoring };

  const sqliteStore = new SQLiteStateStore(resolvedConfig.persistence.sqlitePath);
  const jsonStore = new JsonStateStore(resolvedConfig.persistence.fallbackJsonPath);
  const stateStore = new ResilientStateStore(sqliteStore, jsonStore);
  stateStore.init();
  const persisted = stateStore.load();

  const keyManager = new KeyManager({ monitoring: monitoringConfig, persistence: stateStore });
  keyManager.bootstrap(resolvedConfig.keys, persisted);

  const geminiClient = new GeminiClient(proxyConfig);
  const proxyRouter = new ProxyRouter({ config: proxyConfig, keyManager, gemini: geminiClient, stateStore });
  const cliRouter = new GeminiCLIRouter({ config: proxyConfig });
  const codexRouter = new CodexCLIRouter({ config: proxyConfig });
  const adminRouter = new AdminRouter({
    adminToken: proxyConfig.adminToken,
    keyManager,
    configManager,
    metricsRegistry: registry,
    startedAt,
  });

  configManager.subscribe((updated) => {
    const previousHost = proxyConfig.host;
    const previousPort = proxyConfig.port;

    Object.assign(proxyConfig, updated.proxy);
    Object.assign(monitoringConfig, updated.monitoring);

    keyManager.updateMonitoringConfig(monitoringConfig);
    keyManager.applyConfigUpdate(updated.keys);
    adminRouter.updateAdminToken(proxyConfig.adminToken);

    if (previousHost !== proxyConfig.host || previousPort !== proxyConfig.port) {
      logger.warn(
        {
          previousHost,
          previousPort,
          nextHost: proxyConfig.host,
          nextPort: proxyConfig.port,
        },
        "Host/port changes require process restart",
      );
    }
  });

  const host = overrides.host ?? proxyConfig.host;
  const port = overrides.port ?? proxyConfig.port;

  const handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/admin")) {
        return await adminRouter.handle(request);
      }

      if (url.pathname.startsWith("/gemini-cli/v1")) {
        return await cliRouter.handle(request);
      }

      if (url.pathname.startsWith("/codex-cli/v1")) {
        return await codexRouter.handle(request);
      }

      if (url.pathname === "/help" || url.pathname === "/info") {
        return await proxyRouter.handle(request);
      }

      if (url.pathname.startsWith("/v1")) {
        return await proxyRouter.handle(request);
      }

      if (url.pathname === "/healthz") {
        const keys = keyManager.listKeys();
        const unhealthy = keys.filter((key) => key.status !== "active").length;
        const status = unhealthy === 0 ? "ok" : "degraded";
        return new Response(status, { status: unhealthy === 0 ? 200 : 503 });
      }

      return errorResponse("Not found", 404, "not_found");
    } catch (error) {
      logger.error({ error }, "Unhandled error during request handling");
      return errorResponse("Internal server error", 500, "internal_error");
    }
  };

  let server: Server | null = null;
  let handleSignal: ((signal: string) => void) | null = null;

  if (overrides.listen !== false) {
    server = Bun.serve({
      hostname: host,
      port,
      fetch: handler,
      error(error) {
        logger.error({ error }, "Bun server error");
        return errorResponse("Internal server error", 500, "internal_error");
      },
    });

    logger.info({ host: server.hostname, port: server.port }, "Gemini proxy server started");

    const shutdown = async () => {
      logger.info("Shutting down Gemini proxy server");
      server?.stop(true);
    };

    handleSignal = (signal: string) => {
      logger.info({ signal }, "Received shutdown signal");
      shutdown().finally(() => process.exit(0));
    };

    process.on("SIGTERM", handleSignal);
    process.on("SIGINT", handleSignal);
  } else {
    logger.info({ host, port }, "Gemini proxy server initialized (listener disabled)");
  }

  return {
    server,
    configManager,
    keyManager,
    fetch: handler,
    async stop() {
      if (handleSignal) {
        process.off("SIGTERM", handleSignal);
        process.off("SIGINT", handleSignal);
      }
      if (server) {
        logger.info("Shutting down Gemini proxy server");
        server.stop(true);
      }
    },
  } satisfies ProxyServerContext;
}

if (import.meta.main) {
  try {
    startProxyServer();
  } catch (error) {
    logger.error({ error }, "Failed to start proxy server");
    process.exit(1);
  }
}
