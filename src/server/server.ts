const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 4806;

export interface ServerOptions {
  host: string;
  port: number;
}

export type ProxyServer = ReturnType<typeof Bun.serve>;

/**
 * Stub Bun server entrypoint. This will be expanded as bootstrap modules
 * (persistence, routing, observability) are implemented.
 */
export function startProxyServer(overrides: Partial<ServerOptions> = {}): ProxyServer {
  const { host, port } = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    ...overrides,
  } satisfies ServerOptions;

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch() {
      // TODO: Replace with router pipeline once implemented.
      return new Response(
        JSON.stringify({
          status: "pending",
          message: "Gemini proxy wiring not yet implemented.",
        }),
        {
          status: 501,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    },
  });

  console.info(
    `[bootstrap] Gemini proxy server stub listening on http://${server.hostname}:${server.port}`,
  );

  return server;
}

if (import.meta.main) {
  try {
    startProxyServer();
  } catch (error) {
    console.error("[bootstrap] Failed to start proxy server stub", error);
    process.exit(1);
  }
}
