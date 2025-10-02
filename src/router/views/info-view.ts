import type { ProxyConfig } from "../../types/config.ts";
import type { StateStore } from "../../persistence/state-store.ts";
import type { KeyManager } from "../../keys/key-manager.ts";
import type { KeyStatusSummary } from "../../types/key.ts";
import { logger } from "../../observability/logger.ts";
import { errorResponse } from "../responses.ts";

export interface InfoViewOptions {
  config: ProxyConfig;
  keyManager: KeyManager;
  stateStore: StateStore;
}

interface UsageSummary {
  dailyRequests: number;
  weeklyRequests: number;
  dailyErrors: number;
  successRate: number;
  keysWithDailyUsage: number;
}

interface InfoPageKeyRow {
  id: string;
  name: string;
  status: KeyStatusSummary["status"];
  failureCount: number;
  lastUsed: Date | null;
  minuteRequests: number;
  dailyRequests: number;
  weeklyRequests: number;
  requestsPerHour: number;
  successRate: number;
  avgLatencyMs: number | null;
  weight: number;
  healthScore: number;
  nextRetry: Date | null;
  cooldownSeconds: number;
  isAvailableNow: boolean;
  cooldownEndsAt: Date | null;
}

interface InfoPageViewModel {
  baseUrl: string;
  totalKeys: number;
  availableKeys: number;
  usageSummary: UsageSummary;
  keyRows: InfoPageKeyRow[];
}

/**
 * InfoView renders the server information page with key status and statistics.
 * Displays configuration, usage summary, and detailed key metrics.
 */
export class InfoView {
  private readonly config: ProxyConfig;
  private readonly keyManager: KeyManager;
  private readonly stateStore: StateStore;
  private readonly integerFormatter = new Intl.NumberFormat("en-US");
  private readonly decimalFormatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  private readonly percentFormatter = new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  private readonly dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  private readonly statusLabels: Record<KeyStatusSummary["status"], string> = {
    active: "Active",
    disabled: "Disabled",
    circuit_open: "Circuit Open",
    circuit_half_open: "Circuit Half-Open",
  };
  private readonly statusClasses: Record<KeyStatusSummary["status"], string> = {
    active: "status-active",
    disabled: "status-disabled",
    circuit_open: "status-circuit_open",
    circuit_half_open: "status-circuit_half_open",
  };

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
      const model = this.buildViewModel();
      const html = this.renderHtml(model);

      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (error) {
      logger.error(
        {
          error,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        "Failed to load info page",
      );
      return errorResponse("Info page not available", 500, "internal_error");
    }
  }

  private buildViewModel(): InfoPageViewModel {
    const keys = this.keyManager.listKeys();
    const dailyStats = this.stateStore.getDailyUsageStats();
    const weeklyStats = this.stateStore.getWeeklyUsageStats();

    const dailyMap = new Map(dailyStats.map((stat) => [stat.keyId, stat]));
    const weeklyMap = new Map(weeklyStats.map((stat) => [stat.keyId, stat]));
    const now = Date.now();

    const keyRows: InfoPageKeyRow[] = keys
      .map((key) => {
        const daily = dailyMap.get(key.id);
        const weekly = weeklyMap.get(key.id);

        // Calculate cooldown status
        const cooldownMs = key.weight * 1000; // Assuming weight is cooldownSeconds for simplicity
        const timeSinceUse = key.lastUsed ? now - key.lastUsed.getTime() : Infinity;
        const cooldownRemaining = key.lastUsed && timeSinceUse < cooldownMs
          ? cooldownMs - timeSinceUse
          : 0;
        const cooldownEndsAt = cooldownRemaining > 0 && key.lastUsed
          ? new Date(key.lastUsed.getTime() + cooldownMs)
          : null;

        // Check availability
        const isAvailableNow =
          key.status === "active" &&
          cooldownRemaining === 0;

        // Calculate 1-minute requests (approximate from lastUsed)
        const minuteRequests = key.lastUsed && (now - key.lastUsed.getTime()) < 60000 ? 1 : 0;

        return {
          id: key.id,
          name: key.name,
          status: key.status,
          failureCount: key.failureCount,
          lastUsed: key.lastUsed,
          minuteRequests,
          dailyRequests: daily?.totalRequests ?? 0,
          weeklyRequests: weekly?.totalRequests ?? 0,
          requestsPerHour: daily ? daily.totalRequests / 24 : 0,
          successRate: daily?.successRate ?? 0,
          avgLatencyMs: daily ? daily.avgLatencyMs : null,
          weight: key.weight,
          healthScore: key.healthScore,
          nextRetry: key.nextRetry,
          cooldownSeconds: key.weight, // Using weight as cooldown for now
          isAvailableNow,
          cooldownEndsAt,
        } satisfies InfoPageKeyRow;
      })
      .sort((a, b) => {
        // Sort by availability first, then by daily requests
        if (a.isAvailableNow !== b.isAvailableNow) {
          return a.isAvailableNow ? -1 : 1;
        }
        return b.dailyRequests - a.dailyRequests || a.name.localeCompare(b.name);
      });

    const totalDailyRequests = dailyStats.reduce((sum, stat) => sum + stat.totalRequests, 0);
    const totalWeeklyRequests = weeklyStats.reduce((sum, stat) => sum + stat.totalRequests, 0);
    const totalDailySuccess = dailyStats.reduce((sum, stat) => sum + stat.successCount, 0);
    const totalDailyErrors = dailyStats.reduce((sum, stat) => sum + stat.errorCount, 0);
    const keysWithDailyUsage = keyRows.filter((row) => row.dailyRequests > 0).length;
    const availableKeys = keyRows.filter((row) => row.isAvailableNow).length;

    return {
      baseUrl: this.config.upstreamBaseUrl,
      totalKeys: keys.length,
      availableKeys,
      usageSummary: {
        dailyRequests: totalDailyRequests,
        weeklyRequests: totalWeeklyRequests,
        dailyErrors: totalDailyErrors,
        successRate: totalDailyRequests > 0 ? totalDailySuccess / totalDailyRequests : 0,
        keysWithDailyUsage,
      },
      keyRows,
    } satisfies InfoPageViewModel;
  }

  private renderHtml(model: InfoPageViewModel): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gemini Proxy - Server Info</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", sans-serif;
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
    .value {
      font-size: 2em;
      font-weight: bold;
      color: #1e293b;
    }
    .value--small {
      font-size: 1.2em;
      word-break: break-all;
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
    .table-note {
      margin-top: 30px;
      color: #64748b;
      font-size: 0.9em;
    }
    .empty-state {
      text-align: center;
      color: #64748b;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="container">
    <a href="/" class="back-link">← Back to API</a>
    <h1>🔧 Gemini Proxy Server Info</h1>
    ${this.renderOverviewSection(model)}
    ${this.renderUsageSection(model.usageSummary)}
    ${this.renderKeyTable(model.keyRows)}
  </div>
</body>
</html>`;
  }

  private renderOverviewSection(model: InfoPageViewModel): string {
    const availabilityPercent = model.totalKeys > 0
      ? model.availableKeys / model.totalKeys
      : 0;

    return `<h2>📊 Server Configuration</h2>
    <div class="info-grid">
      <div class="info-card">
        <h3>Base URL</h3>
        <div class="value value--small">${this.escapeHtml(model.baseUrl)}</div>
      </div>
      <div class="info-card">
        <h3>Total Keys</h3>
        <div class="value">${this.formatInteger(model.totalKeys)}</div>
      </div>
      <div class="info-card">
        <h3>Available Now</h3>
        <div class="value" style="color: ${model.availableKeys > 0 ? '#16a34a' : '#dc2626'};">
          ${this.formatInteger(model.availableKeys)} / ${this.formatInteger(model.totalKeys)}
        </div>
        <div style="font-size: 0.9em; color: #64748b; margin-top: 5px;">
          ${this.formatPercent(availabilityPercent)} ready
        </div>
      </div>
      <div class="info-card">
        <h3>Keys With Traffic (24h)</h3>
        <div class="value">${this.formatInteger(model.usageSummary.keysWithDailyUsage)}</div>
      </div>
    </div>`;
  }

  private renderUsageSection(summary: UsageSummary): string {
    return `<h2>📈 Usage Summary</h2>
    <div class="info-grid">
      <div class="info-card">
        <h3>Daily Requests</h3>
        <div class="value">${this.formatInteger(summary.dailyRequests)}</div>
      </div>
      <div class="info-card">
        <h3>Weekly Requests</h3>
        <div class="value">${this.formatInteger(summary.weeklyRequests)}</div>
      </div>
      <div class="info-card">
        <h3>Success Rate (24h)</h3>
        <div class="value">${this.formatPercent(summary.successRate)}</div>
      </div>
      <div class="info-card">
        <h3>Errors (24h)</h3>
        <div class="value">${this.formatInteger(summary.dailyErrors)}</div>
      </div>
    </div>`;
  }

  private renderKeyTable(keyRows: InfoPageKeyRow[]): string {
    return `<h2>🔑 API Key Status</h2>
    <table>
      <thead>
        <tr>
          <th>Key Name</th>
          <th>Status</th>
          <th>Availability</th>
          <th>Health Score</th>
          <th>Usage (1m / 24h / 7d)</th>
          <th>RPH</th>
          <th>Success Rate</th>
          <th>Avg Latency</th>
          <th>Weight/Cooldown</th>
        </tr>
      </thead>
      <tbody>
        ${this.renderKeyRows(keyRows)}
      </tbody>
    </table>
    <p class="table-note">
      <strong>Note:</strong> Usage statistics based on last 24h.
      <strong>Availability:</strong> ✅ Ready to use | ⏳ In cooldown | ⚠️ Circuit open/disabled.
      <strong>RPH:</strong> Requests per hour.
    </p>`;
  }

  private renderKeyRows(keyRows: InfoPageKeyRow[]): string {
    if (keyRows.length === 0) {
      return `<tr>
          <td class="empty-state" colspan="9">No API keys configured yet.</td>
        </tr>`;
    }

    return keyRows
      .map(
        (row) => `<tr style="${row.isAvailableNow ? '' : 'opacity: 0.7;'}">
          <td><strong>${this.escapeHtml(row.name)}</strong></td>
          <td><span class="status-badge ${this.statusClasses[row.status]}">${this.escapeHtml(this.formatStatus(row.status))}</span></td>
          <td>${this.formatAvailability(row)}</td>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="flex: 1; background: #e2e8f0; border-radius: 4px; height: 8px; overflow: hidden;">
                <div style="width: ${row.healthScore * 100}%; height: 100%; background: ${this.getHealthColor(row.healthScore)};"></div>
              </div>
              <span style="font-size: 0.9em; color: #64748b;">${this.formatPercent(row.healthScore)}</span>
            </div>
          </td>
          <td>${this.formatInteger(row.minuteRequests)} / ${this.formatInteger(row.dailyRequests)} / ${this.formatInteger(row.weeklyRequests)}</td>
          <td>${this.formatDecimal(row.requestsPerHour)}</td>
          <td>${this.formatPercent(row.successRate)}</td>
          <td>${this.formatLatency(row.avgLatencyMs)}</td>
          <td style="font-size: 0.85em;">
            <div><strong>W:</strong> ${row.weight}</div>
            <div style="color: #64748b;"><strong>CD:</strong> ${row.cooldownSeconds}s</div>
          </td>
        </tr>`,
      )
      .join("");
  }

  private formatInteger(value: number): string {
    return this.integerFormatter.format(Math.round(value));
  }

  private formatDecimal(value: number): string {
    return this.decimalFormatter.format(Number.isFinite(value) ? value : 0);
  }

  private formatPercent(value: number): string {
    const clamped = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
    return this.percentFormatter.format(clamped);
  }

  private formatLatency(value: number | null): string {
    if (value === null) {
      return "—";
    }
    return `${this.formatDecimal(value)} ms`;
  }

  private formatDateTime(value: Date | null): string {
    if (!value) {
      return "Never";
    }
    try {
      return this.dateTimeFormatter.format(value);
    } catch {
      return value.toISOString();
    }
  }

  private formatStatus(status: KeyStatusSummary["status"]): string {
    return this.statusLabels[status] ?? status;
  }

  private formatAvailability(row: InfoPageKeyRow): string {
    if (row.status === "disabled") {
      return `<span style="font-size: 1.2em;" title="Key disabled">⚠️ Disabled</span>`;
    }

    if (row.status === "circuit_open") {
      const retryTime = row.nextRetry ? this.formatDateTime(row.nextRetry) : "Unknown";
      return `<span style="font-size: 1.2em;" title="Circuit open, retry at ${retryTime}">⚠️ Open</span>`;
    }

    if (row.status === "circuit_half_open") {
      return `<span style="font-size: 1.2em;" title="Circuit half-open, testing">🔄 Testing</span>`;
    }

    if (row.isAvailableNow) {
      return `<span style="font-size: 1.2em; color: #16a34a;" title="Ready to accept requests">✅ Ready</span>`;
    }

    if (row.cooldownEndsAt) {
      const remaining = Math.ceil((row.cooldownEndsAt.getTime() - Date.now()) / 1000);
      return `<span style="font-size: 1.2em;" title="Cooldown ends at ${this.formatDateTime(row.cooldownEndsAt)}">⏳ ${remaining}s</span>`;
    }

    return `<span style="font-size: 1.2em;">—</span>`;
  }

  private getHealthColor(score: number): string {
    if (score >= 0.9) return "#16a34a"; // green
    if (score >= 0.7) return "#eab308"; // yellow
    if (score >= 0.5) return "#f97316"; // orange
    return "#dc2626"; // red
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case "\"":
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return char;
      }
    });
  }
}
