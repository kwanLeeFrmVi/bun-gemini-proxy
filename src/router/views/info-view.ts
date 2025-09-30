import type { ProxyConfig } from "../../types/config.ts";
import type { StateStore } from "../../persistence/state-store.ts";
import type { KeyManager } from "../../keys/key-manager.ts";
import { logger } from "../../observability/logger.ts";
import { errorResponse } from "../responses.ts";

export interface InfoViewOptions {
  config: ProxyConfig;
  keyManager: KeyManager;
  stateStore: StateStore;
}

/**
 * InfoView renders the server information page with key status and statistics.
 * Displays configuration, usage summary, and detailed key metrics.
 */
export class InfoView {
  private readonly config: ProxyConfig;
  private readonly keyManager: KeyManager;
  private readonly stateStore: StateStore;

  constructor(options: InfoViewOptions) {
    this.config = options.config;
    this.keyManager = options.keyManager;
    this.stateStore = options.stateStore;
  }

  /**
   * Render the info page with server statistics and key status.
   */
  async render(): Promise<Response> {
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
}