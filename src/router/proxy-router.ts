import type { ApiKeyRecord } from "../types/key.ts";
import type { ProxyConfig } from "../types/config.ts";
import type { KeyManager } from "../keys/key-manager.ts";
import type { GeminiClient } from "./gemini-client.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { activeRequestsGauge, requestCounter, requestDuration } from "../observability/metrics.ts";
import { errorResponse, jsonResponse } from "./responses.ts";
import { logger } from "../observability/logger.ts";

export interface ProxyRouterOptions {
  config: ProxyConfig;
  keyManager: KeyManager;
  gemini: GeminiClient;
  stateStore: StateStore;
}

const JSON_CONTENT_TYPE = /application\/json/i;
const MODEL_DETAIL_PATTERN = /^\/v1\/models\/([^/]+)$/;

const MOCK_API_KEY: ApiKeyRecord = {
  id: "mock-key",
  key: "mock-key",
  name: "mock-key",
  weight: 1,
  isActive: true,
  createdAt: new Date(),
  lastUsedAt: null,
  cooldownSeconds: 30,
};

export class ProxyRouter {
  private readonly config: ProxyConfig;
  private readonly keyManager: KeyManager;
  private readonly gemini: GeminiClient;
  private readonly stateStore: StateStore;

  constructor(options: ProxyRouterOptions) {
    this.config = options.config;
    this.keyManager = options.keyManager;
    this.gemini = options.gemini;
    this.stateStore = options.stateStore;
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/help") {
      return this.handleHelp();
    }

    if (url.pathname === "/info") {
      return this.handleInfo();
    }

    if (!url.pathname.startsWith("/v1")) {
      return errorResponse("Not found", 404, "not_found");
    }

    // Authentication check for /v1 endpoints
    // Skip authentication if no accessTokens configured
    if (this.config.accessTokens.length > 0 && this.config.requireAuth) {
      const authHeader = request.headers.get("authorization");
      if (!authHeader) {
        return errorResponse("Missing authorization header", 401, "authentication_error");
      }

      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (!this.config.accessTokens.includes(token)) {
        return errorResponse("Invalid access token", 401, "authentication_error");
      }
    }

    if ((url.pathname === "/v1/models" || url.pathname === "/v1/models/") && request.method === "GET") {
      return this.handleListModels(request);
    }

    const modelDetailMatch = url.pathname.match(MODEL_DETAIL_PATTERN);
    if (modelDetailMatch && request.method === "GET") {
      const modelId = modelDetailMatch[1];
      if (modelId) {
        return this.handleGetModel(request, modelId);
      }
    }

    if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
      return this.handleChatCompletions(request);
    }

    if (url.pathname === "/v1/embeddings" && request.method === "POST") {
      return this.handleGenericProxy(
        request,
        "/v1/embeddings",
        "https://generativelanguage.googleapis.com/v1beta/openai/embeddings",
      );
    }

    if (url.pathname === "/v1/images/generations" && request.method === "POST") {
      return this.handleGenericProxy(
        request,
        "/v1/images/generations",
        "https://generativelanguage.googleapis.com/v1beta/openai/images/generations",
      );
    }

    return errorResponse("Endpoint not yet implemented", 404, "not_implemented", {
      path: url.pathname,
      method: request.method,
    });
  }

  private async handleListModels(request: Request): Promise<Response> {
    const endTimer = this.startRequestTimer("/v1/models", request.method);
    activeRequestsGauge.inc({ endpoint: "/v1/models" });
    let resultLabel = "success";
    try {
      const key = this.config.mode === "mock" ? MOCK_API_KEY : this.keyManager.selectKey()?.record;
      const result = await this.gemini.listModels(key ?? null);

      if (!result.ok) {
        requestCounter.inc({ endpoint: "/v1/models", method: request.method, status: result.status, result: "error" });
        resultLabel = "error";
        return errorResponse("Failed to fetch models", result.status, "upstream_error", {
          upstreamStatus: result.status,
        });
      }

      requestCounter.inc({ endpoint: "/v1/models", method: request.method, status: 200, result: "success" });
      return jsonResponse(result.body, { status: result.status });
    } finally {
      activeRequestsGauge.dec({ endpoint: "/v1/models" });
      endTimer(resultLabel);
    }
  }

  private async handleChatCompletions(request: Request): Promise<Response> {
    const endpoint = "/v1/chat/completions";
    const endTimer = this.startRequestTimer(endpoint, request.method);
    activeRequestsGauge.inc({ endpoint });
    let resultLabel = "success";
    try {
      const contentLengthHeader = request.headers.get("content-length");
      if (contentLengthHeader && Number(contentLengthHeader) > this.config.maxPayloadSizeBytes) {
        requestCounter.inc({ endpoint, method: request.method, status: 413, result: "rejected" });
        resultLabel = "rejected";
        return errorResponse("Payload too large", 413, "payload_too_large");
      }

      const contentType = request.headers.get("content-type") ?? "";
      if (!JSON_CONTENT_TYPE.test(contentType)) {
        requestCounter.inc({ endpoint, method: request.method, status: 415, result: "rejected" });
        resultLabel = "rejected";
        return errorResponse("Unsupported content type", 415, "unsupported_media_type");
      }

      const raw = await request.text();
      if (raw.length > this.config.maxPayloadSizeBytes) {
        requestCounter.inc({ endpoint, method: request.method, status: 413, result: "rejected" });
        resultLabel = "rejected";
        return errorResponse("Payload too large", 413, "payload_too_large");
      }

      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw);
      } catch {
        requestCounter.inc({ endpoint, method: request.method, status: 400, result: "rejected" });
        resultLabel = "rejected";
        return errorResponse("Malformed JSON payload", 400, "invalid_request_error");
      }

      if (!body.model || typeof body.model !== "string") {
        requestCounter.inc({ endpoint, method: request.method, status: 400, result: "rejected" });
        resultLabel = "rejected";
        return errorResponse("Missing required 'model' field", 400, "invalid_request_error");
      }

      if (!Array.isArray(body.messages)) {
        requestCounter.inc({ endpoint, method: request.method, status: 400, result: "rejected" });
        resultLabel = "rejected";
        return errorResponse("Missing required 'messages' array", 400, "invalid_request_error");
      }

      const maxAttempts = Math.max(1, this.keyManager.getActiveKeyCount() || 1);
      const attemptedKeys = new Set<string>();
      let lastFailure: Response | null = null;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const selection = this.config.mode === "mock" ? { record: MOCK_API_KEY } : this.keyManager.selectKey();
        if (!selection) {
          requestCounter.inc({ endpoint, method: request.method, status: 503, result: "failed" });
          resultLabel = "failed";
          return errorResponse("No healthy API keys available", 503, "service_unavailable");
        }
        if (attemptedKeys.has(selection.record.id)) {
          continue;
        }
        attemptedKeys.add(selection.record.id);

        const start = process.hrtime.bigint();
        const upstream = await this.gemini.chatCompletion(body, selection.record);
        const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000_000;

        // Handle streaming response (Response object)
        if (upstream instanceof Response) {
          this.keyManager.recordSuccess(selection.record.id, elapsed * 1000);
          requestCounter.inc({ endpoint, method: request.method, status: 200, result: "success" });
          resultLabel = "success";

          // Remove compression headers to ensure OpenAI clients can read the stream
          const headers = new Headers(upstream.headers);
          headers.delete('content-encoding');
          headers.delete('content-length');

          return new Response(upstream.body, {
            status: upstream.status,
            headers,
          });
        }

        // Handle non-streaming response (UpstreamResult)
        if (upstream.ok) {
          this.keyManager.recordSuccess(selection.record.id, elapsed * 1000);
          requestCounter.inc({ endpoint, method: request.method, status: 200, result: "success" });
          resultLabel = "success";
          return jsonResponse(upstream.body, { status: upstream.status });
        }

        const isRateLimit = upstream.status === 429;
        this.keyManager.recordFailure(
          selection.record.id,
          `upstream_${upstream.status}`,
          isRateLimit,
          elapsed * 1000,
        );

        logger.warn(
          { keyId: selection.record.id, status: upstream.status },
          "Upstream failure; rotating to next key",
        );

        lastFailure = errorResponse("Gemini upstream error", upstream.status, "upstream_error", {
          upstreamStatus: upstream.status,
        });
      }

      if (lastFailure) {
        requestCounter.inc({ endpoint, method: request.method, status: lastFailure.status ?? 500, result: "failed" });
        resultLabel = "failed";
        return lastFailure;
      }

      requestCounter.inc({ endpoint, method: request.method, status: 503, result: "failed" });
      resultLabel = "failed";
      return errorResponse("All keys exhausted", 503, "service_unavailable");
    } finally {
      activeRequestsGauge.dec({ endpoint });
      endTimer(resultLabel);
    }
  }

  private async handleGenericProxy(request: Request, endpoint: string, upstreamUrl: string): Promise<Response> {
    const endTimer = this.startRequestTimer(endpoint, request.method);
    activeRequestsGauge.inc({ endpoint });
    let resultLabel = "success";
    try {
      const key = this.config.mode === "mock" ? MOCK_API_KEY : this.keyManager.selectKey()?.record;
      if (!key) {
        requestCounter.inc({ endpoint, method: request.method, status: 503, result: "failed" });
        resultLabel = "failed";
        return errorResponse("No healthy API keys available", 503, "service_unavailable");
      }

      const body = await request.text();
      const upstream = await this.gemini.forward(upstreamUrl, body, key);

      if (!upstream.ok) {
        requestCounter.inc({ endpoint, method: request.method, status: upstream.status, result: "error" });
        resultLabel = "error";
        return errorResponse("Failed to forward request", upstream.status, "upstream_error", {
          upstreamStatus: upstream.status,
        });
      }

      requestCounter.inc({ endpoint, method: request.method, status: 200, result: "success" });
      return jsonResponse(upstream.body, { status: upstream.status });
    } finally {
      activeRequestsGauge.dec({ endpoint });
      endTimer(resultLabel);
    }
  }

  private async handleGetModel(request: Request, modelId: string): Promise<Response> {
    const endpoint = `/v1/models/${modelId}`;
    const endTimer = this.startRequestTimer(endpoint, request.method);
    activeRequestsGauge.inc({ endpoint });
    let resultLabel = "success";
    try {
      const key = this.config.mode === "mock" ? MOCK_API_KEY : this.keyManager.selectKey()?.record;
      const result = await this.gemini.getModel(modelId, key ?? null);

      if (!result.ok) {
        const status = result.status === 404 ? 404 : 500;
        requestCounter.inc({ endpoint, method: request.method, status, result: "error" });
        resultLabel = "error";
        return errorResponse("Failed to fetch model", status, "upstream_error", {
          upstreamStatus: result.status,
        });
      }

      requestCounter.inc({ endpoint, method: request.method, status: 200, result: "success" });
      return jsonResponse(result.body, { status: result.status });
    } finally {
      activeRequestsGauge.dec({ endpoint });
      endTimer(resultLabel);
    }
  }

  private async handleInfo(): Promise<Response> {
    try {
      const keys = this.keyManager.listKeys();
      const dailyStats = this.stateStore.getDailyUsageStats();
      const weeklyStats = this.stateStore.getWeeklyUsageStats();

      // Create map for quick lookup
      const dailyMap = new Map(dailyStats.map((s) => [s.keyId, s]));
      const weeklyMap = new Map(weeklyStats.map((s) => [s.keyId, s]));

      const keyRows = keys
        .map((key) => {
          const daily = dailyMap.get(key.id);
          const weekly = weeklyMap.get(key.id);
          const requestsPerHour = daily ? (daily.totalRequests / 24).toFixed(1) : "0.0";

          return `
        <tr>
          <td><strong>${key.name}</strong></td>
          <td><span class="status-badge status-${key.status}">${key.status.replace("_", " ")}</span></td>
          <td>${daily ? daily.totalRequests.toLocaleString() : "0"} / ${weekly ? weekly.totalRequests.toLocaleString() : "0"}</td>
          <td>${key.failureCount}</td>
          <td>${key.lastUsed ? new Date(key.lastUsed).toLocaleString() : "Never"}</td>
          <td>${requestsPerHour} req/h</td>
          <td>${daily ? (daily.successRate * 100).toFixed(1) : "0.0"}%</td>
        </tr>`;
        })
        .join("");

      const totalDailyRequests = dailyStats.reduce((sum, s) => sum + s.totalRequests, 0);
      const totalWeeklyRequests = weeklyStats.reduce((sum, s) => sum + s.totalRequests, 0);
      const totalDailySuccess = dailyStats.reduce((sum, s) => sum + s.successCount, 0);
      const totalDailyErrors = dailyStats.reduce((sum, s) => sum + s.errorCount, 0);
      const overallSuccessRate =
        totalDailyRequests > 0 ? ((totalDailySuccess / totalDailyRequests) * 100).toFixed(1) : "0.0";

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gemini Proxy - Server Info</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h1 {
      color: #2563eb;
      font-size: 2.5em;
      margin-bottom: 0.5em;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 10px;
    }
    h2 {
      color: #1e40af;
      font-size: 1.5em;
      margin-top: 1.5em;
      margin-bottom: 0.8em;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin: 20px 0;
    }
    .info-card {
      background: #f8fafc;
      padding: 20px;
      border-radius: 6px;
      border-left: 4px solid #2563eb;
    }
    .info-card h3 {
      color: #64748b;
      font-size: 0.9em;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }
    .info-card .value {
      font-size: 2em;
      font-weight: bold;
      color: #1e293b;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    th {
      background: #1e293b;
      color: white;
      padding: 12px;
      text-align: left;
      font-weight: 600;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #e2e8f0;
    }
    tr:hover {
      background: #f8fafc;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85em;
      font-weight: 600;
    }
    .status-active {
      background: #dcfce7;
      color: #166534;
    }
    .status-disabled {
      background: #fee2e2;
      color: #991b1b;
    }
    .status-circuit_open {
      background: #fef3c7;
      color: #92400e;
    }
    .status-circuit_half_open {
      background: #dbeafe;
      color: #1e40af;
    }
    .back-link {
      display: inline-block;
      margin-bottom: 20px;
      padding: 8px 16px;
      background: #2563eb;
      color: white;
      border-radius: 4px;
      text-decoration: none;
    }
    .back-link:hover {
      background: #1e40af;
      text-decoration: none;
    }
    code {
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 0.9em;
      color: #dc2626;
    }
  </style>
</head>
<body>
  <div class="container">
    <a href="/" class="back-link">← Back to API</a>
    <h1>🔧 Gemini Proxy Server Info</h1>

    <h2>📊 Server Configuration</h2>
    <div class="info-grid">
      <div class="info-card">
        <h3>Base URL</h3>
        <div class="value" style="font-size: 1.2em; word-break: break-all;">${this.config.upstreamBaseUrl}</div>
      </div>
      <div class="info-card">
        <h3>Mode</h3>
        <div class="value">${this.config.mode}</div>
      </div>
      <div class="info-card">
        <h3>Total Keys</h3>
        <div class="value">${keys.length}</div>
      </div>
    </div>

    <h2>📈 Usage Summary</h2>
    <div class="info-grid">
      <div class="info-card">
        <h3>Daily Requests</h3>
        <div class="value">${totalDailyRequests.toLocaleString()}</div>
      </div>
      <div class="info-card">
        <h3>Weekly Requests</h3>
        <div class="value">${totalWeeklyRequests.toLocaleString()}</div>
      </div>
      <div class="info-card">
        <h3>Success Rate (24h)</h3>
        <div class="value">${overallSuccessRate}%</div>
      </div>
      <div class="info-card">
        <h3>Errors (24h)</h3>
        <div class="value">${totalDailyErrors.toLocaleString()}</div>
      </div>
    </div>

    <h2>🔑 API Key Status</h2>
    <table>
      <thead>
        <tr>
          <th>Key Name</th>
          <th>Status</th>
          <th>Usage (24h / 7d)</th>
          <th>Failed Count</th>
          <th>Last Used</th>
          <th>Requests/Hour</th>
          <th>Success Rate</th>
        </tr>
      </thead>
      <tbody>
        ${keyRows}
      </tbody>
    </table>

    <p style="margin-top: 30px; color: #64748b; font-size: 0.9em;">
      <strong>Note:</strong> Usage statistics are calculated from recorded metrics.
      Requests/hour is based on the last 24 hours of activity.
    </p>
  </div>
</body>
</html>`;

      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (error) {
      logger.error({ error, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }, "Failed to load info page");
      return errorResponse("Info page not available", 500, "internal_error");
    }
  }

  private async handleHelp(): Promise<Response> {
    try {
      const mdxPath = new URL("../../docs/user-guide.mdx", import.meta.url).pathname;
      const mdxContent = await Bun.file(mdxPath).text();

      // Compile MDX to validate syntax (optional)
      const { compile } = await import("@mdx-js/mdx");
      await compile(mdxContent, {
        outputFormat: "program",
        development: false,
      });

      // Convert to HTML for rendering
      const htmlContent = this.mdxToHtml(mdxContent);

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gemini Proxy - User Guide</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h1 { color: #2563eb; font-size: 2.5em; margin-bottom: 0.5em; border-bottom: 3px solid #2563eb; padding-bottom: 10px; }
    h2 { color: #1e40af; font-size: 1.8em; margin-top: 1.5em; margin-bottom: 0.5em; }
    h3 { color: #1e3a8a; font-size: 1.3em; margin-top: 1.2em; margin-bottom: 0.4em; }
    h4 { color: #1e293b; font-size: 1.1em; margin-top: 1em; margin-bottom: 0.3em; }
    p { margin-bottom: 1em; }
    code {
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 0.9em;
      color: #dc2626;
    }
    pre {
      background: #1e293b;
      color: #e2e8f0;
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 1em 0;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 0.85em;
      line-height: 1.5;
    }
    pre code {
      background: none;
      color: inherit;
      padding: 0;
      font-size: inherit;
    }
    ul, ol { margin-left: 2em; margin-bottom: 1em; }
    li { margin-bottom: 0.5em; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    strong { color: #1e293b; font-weight: 600; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 2em 0; }
    .back-link {
      display: inline-block;
      margin-bottom: 20px;
      padding: 8px 16px;
      background: #2563eb;
      color: white;
      border-radius: 4px;
      text-decoration: none;
    }
    .back-link:hover { background: #1e40af; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <a href="/" class="back-link">← Back to API</a>
    ${htmlContent}
  </div>
</body>
</html>`;

      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (error) {
      logger.error({ error }, "Failed to load help page");
      return errorResponse("Help page not available", 500, "internal_error");
    }
  }

  private mdxToHtml(mdx: string): string {
    // Simple markdown to HTML conversion
    let html = mdx
      // Headers
      .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Code blocks
      .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Line breaks
      .replace(/\n\n/g, '</p><p>')
      // Horizontal rules
      .replace(/^---$/gm, '<hr>');

    return `<p>${html}</p>`.replace(/<\/p><p><h/g, '</p><h').replace(/<\/h(\d)><\/p>/g, '</h$1>');
  }

  private startRequestTimer(endpoint: string, method: string): (result: string) => void {
    const start = process.hrtime.bigint();
    return (result: string) => {
      const diff = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      requestDuration.observe({ endpoint, method, result }, diff);
    };
  }
}
