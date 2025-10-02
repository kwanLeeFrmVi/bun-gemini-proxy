import { startProxyServer, type ProxyServerContext } from "../../src/server/server.ts";

declare global {
  var __geminiProxyServerContext: ProxyServerContext | undefined;

  var __geminiProxyServerLoader: Promise<ProxyServerContext> | undefined;

  var __geminiProxyOriginalFetch: typeof fetch | undefined;
}

if (!globalThis.__geminiProxyServerLoader) {
  process.env.PROXY_ADMIN_TOKEN = "test-admin-token";
  process.env.GEMINI_PROXY_MODE = "mock";
  globalThis.__geminiProxyServerLoader = (async () => {
    const context = startProxyServer({ listen: false });
    globalThis.__geminiProxyServerContext = context;

    if (!globalThis.__geminiProxyOriginalFetch) {
      globalThis.__geminiProxyOriginalFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = (async (
        input: Request | string | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const originalFetch = globalThis.__geminiProxyOriginalFetch ?? fetch;
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.startsWith("http://localhost:4806")) {
          const request = input instanceof Request ? input : new Request(url, init);
          return context.fetch(request);
        }
        return originalFetch(input, init);
      }) as typeof fetch;
    }

    return context;
  })();
}

await globalThis.__geminiProxyServerLoader;
