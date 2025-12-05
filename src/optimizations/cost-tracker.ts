/**
 * Transparent Cost Tracking Dashboard
 * 
 * Cursor hides the real costs. This system provides complete
 * transparency into every request, token usage, and cost.
 */

import * as vscode from "vscode";

interface RequestLog {
  id: string;
  timestamp: number;
  provider: string;
  model: string;
  query: string;
  queryTruncated: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  latencyMs: number;
  cached: boolean;
  deduplicated: boolean;
  category: string;
}

interface CostBreakdown {
  byProvider: Record<string, { requests: number; tokens: number; cost: number }>;
  byModel: Record<string, { requests: number; tokens: number; cost: number }>;
  byCategory: Record<string, { requests: number; tokens: number; cost: number }>;
  byHour: Record<string, { requests: number; tokens: number; cost: number }>;
}

interface SessionStats {
  startTime: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  averageLatency: number;
  cacheHits: number;
  deduplicatedRequests: number;
  estimatedSavings: number;
}

export class CostTracker {
  private requestLog: RequestLog[] = [];
  private sessionStats: SessionStats;
  private statusBarItem: vscode.StatusBarItem;
  private outputChannel: vscode.OutputChannel;
  private costLimit: number = Infinity;
  private onLimitReached?: () => void;

  // Model pricing (per 1M tokens)
  private readonly PRICING: Record<string, { input: number; output: number }> = {
    // Anthropic
    "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
    "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
    "claude-3-opus-20240229": { input: 15.0, output: 75.0 },
    "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
    // OpenAI
    "gpt-4o": { input: 2.5, output: 10.0 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4-turbo": { input: 10.0, output: 30.0 },
    "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
    // Groq (heavily discounted)
    "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
    "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
    "mixtral-8x7b-32768": { input: 0.24, output: 0.24 },
    // Ollama (free - local)
    "ollama:*": { input: 0, output: 0 },
  };

  constructor() {
    this.sessionStats = this.initSessionStats();
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.outputChannel = vscode.window.createOutputChannel("MythaTron Code Costs");
    this.statusBarItem.show();
    this.updateStatusBar();
  }

  private initSessionStats(): SessionStats {
    return {
      startTime: Date.now(),
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      averageLatency: 0,
      cacheHits: 0,
      deduplicatedRequests: 0,
      estimatedSavings: 0,
    };
  }

  /**
   * Log a request and calculate costs
   */
  logRequest(options: {
    provider: string;
    model: string;
    query: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    cached?: boolean;
    deduplicated?: boolean;
    category?: string;
  }): RequestLog {
    const cost = this.calculateCost(
      options.model,
      options.inputTokens,
      options.outputTokens
    );

    const log: RequestLog = {
      id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      provider: options.provider,
      model: options.model,
      query: options.query,
      queryTruncated:
        options.query.length > 100
          ? options.query.slice(0, 100) + "..."
          : options.query,
      inputTokens: options.inputTokens,
      outputTokens: options.outputTokens,
      totalTokens: options.inputTokens + options.outputTokens,
      cost,
      latencyMs: options.latencyMs,
      cached: options.cached || false,
      deduplicated: options.deduplicated || false,
      category: options.category || "general",
    };

    this.requestLog.push(log);

    // Update session stats
    this.sessionStats.totalRequests++;
    this.sessionStats.totalInputTokens += options.inputTokens;
    this.sessionStats.totalOutputTokens += options.outputTokens;
    this.sessionStats.totalCost += cost;
    this.sessionStats.averageLatency =
      (this.sessionStats.averageLatency * (this.sessionStats.totalRequests - 1) +
        options.latencyMs) /
      this.sessionStats.totalRequests;

    if (options.cached) {
      this.sessionStats.cacheHits++;
      this.sessionStats.estimatedSavings += cost;
    }
    if (options.deduplicated) {
      this.sessionStats.deduplicatedRequests++;
      this.sessionStats.estimatedSavings += cost;
    }

    // Check cost limit
    if (this.sessionStats.totalCost >= this.costLimit && this.onLimitReached) {
      this.onLimitReached();
    }

    // Update UI
    this.updateStatusBar();
    this.logToOutput(log);

    return log;
  }

  /**
   * Calculate cost for a request
   */
  private calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    // Find pricing (check for exact match or prefix match for ollama)
    let pricing = this.PRICING[model];
    if (!pricing) {
      // Check for ollama models
      if (model.startsWith("ollama:")) {
        pricing = this.PRICING["ollama:*"];
      } else {
        // Default to a conservative estimate
        pricing = { input: 5.0, output: 15.0 };
      }
    }

    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return inputCost + outputCost;
  }

  /**
   * Update status bar with current costs
   */
  private updateStatusBar(): void {
    const { totalCost, totalRequests, estimatedSavings } = this.sessionStats;
    const savingsPercent =
      totalCost > 0 ? ((estimatedSavings / (totalCost + estimatedSavings)) * 100).toFixed(0) : 0;

    this.statusBarItem.text = `$(pulse) $${totalCost.toFixed(4)} | ${totalRequests} reqs | ${savingsPercent}% saved`;
    this.statusBarItem.tooltip = this.getTooltip();
    this.statusBarItem.command = "claudecode.showCostDashboard";
  }

  /**
   * Get detailed tooltip
   */
  private getTooltip(): string {
    const stats = this.sessionStats;
    const duration = Math.round((Date.now() - stats.startTime) / 1000 / 60);

    return [
      `💰 Session Cost: $${stats.totalCost.toFixed(4)}`,
      `📊 Requests: ${stats.totalRequests}`,
      `🔤 Input Tokens: ${stats.totalInputTokens.toLocaleString()}`,
      `📝 Output Tokens: ${stats.totalOutputTokens.toLocaleString()}`,
      `⚡ Avg Latency: ${Math.round(stats.averageLatency)}ms`,
      `💾 Cache Hits: ${stats.cacheHits}`,
      `🔁 Deduplicated: ${stats.deduplicatedRequests}`,
      `💵 Est. Savings: $${stats.estimatedSavings.toFixed(4)}`,
      `⏱️ Session: ${duration} min`,
      "",
      "Click for detailed dashboard",
    ].join("\n");
  }

  /**
   * Log to output channel
   */
  private logToOutput(log: RequestLog): void {
    const flags = [];
    if (log.cached) flags.push("CACHED");
    if (log.deduplicated) flags.push("DEDUP");
    const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";

    this.outputChannel.appendLine(
      `[${new Date(log.timestamp).toLocaleTimeString()}] ` +
        `${log.provider}/${log.model} | ` +
        `${log.inputTokens}+${log.outputTokens} tokens | ` +
        `$${log.cost.toFixed(6)} | ` +
        `${log.latencyMs}ms${flagStr}`
    );
    this.outputChannel.appendLine(`  Query: ${log.queryTruncated}`);
    this.outputChannel.appendLine("");
  }

  /**
   * Get cost breakdown
   */
  getCostBreakdown(): CostBreakdown {
    const breakdown: CostBreakdown = {
      byProvider: {},
      byModel: {},
      byCategory: {},
      byHour: {},
    };

    for (const log of this.requestLog) {
      // By provider
      if (!breakdown.byProvider[log.provider]) {
        breakdown.byProvider[log.provider] = { requests: 0, tokens: 0, cost: 0 };
      }
      breakdown.byProvider[log.provider].requests++;
      breakdown.byProvider[log.provider].tokens += log.totalTokens;
      breakdown.byProvider[log.provider].cost += log.cost;

      // By model
      if (!breakdown.byModel[log.model]) {
        breakdown.byModel[log.model] = { requests: 0, tokens: 0, cost: 0 };
      }
      breakdown.byModel[log.model].requests++;
      breakdown.byModel[log.model].tokens += log.totalTokens;
      breakdown.byModel[log.model].cost += log.cost;

      // By category
      if (!breakdown.byCategory[log.category]) {
        breakdown.byCategory[log.category] = { requests: 0, tokens: 0, cost: 0 };
      }
      breakdown.byCategory[log.category].requests++;
      breakdown.byCategory[log.category].tokens += log.totalTokens;
      breakdown.byCategory[log.category].cost += log.cost;

      // By hour
      const hour = new Date(log.timestamp).toISOString().slice(0, 13);
      if (!breakdown.byHour[hour]) {
        breakdown.byHour[hour] = { requests: 0, tokens: 0, cost: 0 };
      }
      breakdown.byHour[hour].requests++;
      breakdown.byHour[hour].tokens += log.totalTokens;
      breakdown.byHour[hour].cost += log.cost;
    }

    return breakdown;
  }

  /**
   * Get session statistics
   */
  getSessionStats(): SessionStats {
    return { ...this.sessionStats };
  }

  /**
   * Get recent requests
   */
  getRecentRequests(limit: number = 50): RequestLog[] {
    return this.requestLog.slice(-limit);
  }

  /**
   * Set cost limit with callback
   */
  setCostLimit(limit: number, onLimitReached: () => void): void {
    this.costLimit = limit;
    this.onLimitReached = onLimitReached;
  }

  /**
   * Export logs to CSV
   */
  exportToCSV(): string {
    const headers = [
      "Timestamp",
      "Provider",
      "Model",
      "Category",
      "Input Tokens",
      "Output Tokens",
      "Cost",
      "Latency",
      "Cached",
      "Deduplicated",
      "Query",
    ];

    const rows = this.requestLog.map((log) => [
      new Date(log.timestamp).toISOString(),
      log.provider,
      log.model,
      log.category,
      log.inputTokens,
      log.outputTokens,
      log.cost.toFixed(6),
      log.latencyMs,
      log.cached,
      log.deduplicated,
      `"${log.queryTruncated.replace(/"/g, '""')}"`,
    ]);

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  /**
   * Show cost dashboard in webview
   */
  async showDashboard(): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      "costDashboard",
      "MythaTron Code Cost Dashboard",
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    const stats = this.getSessionStats();
    const breakdown = this.getCostBreakdown();
    const recentRequests = this.getRecentRequests(20);

    panel.webview.html = this.getDashboardHTML(stats, breakdown, recentRequests);
  }

  /**
   * Generate dashboard HTML
   */
  private getDashboardHTML(
    stats: SessionStats,
    breakdown: CostBreakdown,
    recentRequests: RequestLog[]
  ): string {
    const duration = Math.round((Date.now() - stats.startTime) / 1000 / 60);

    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .dashboard {
      max-width: 1200px;
      margin: 0 auto;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: var(--vscode-input-background);
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value {
      font-size: 2em;
      font-weight: bold;
      color: var(--vscode-charts-blue);
    }
    .stat-label {
      font-size: 0.9em;
      opacity: 0.7;
      margin-top: 5px;
    }
    .savings {
      color: var(--vscode-charts-green);
    }
    .section {
      margin-bottom: 30px;
    }
    .section-title {
      font-size: 1.2em;
      margin-bottom: 15px;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    th {
      background: var(--vscode-input-background);
    }
    .tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.8em;
      margin-left: 5px;
    }
    .tag-cached {
      background: var(--vscode-charts-green);
      color: white;
    }
    .tag-dedup {
      background: var(--vscode-charts-purple);
      color: white;
    }
  </style>
</head>
<body>
  <div class="dashboard">
    <h1>💰 Cost Dashboard</h1>
    <p>Session Duration: ${duration} minutes</p>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">$${stats.totalCost.toFixed(4)}</div>
        <div class="stat-label">Total Cost</div>
      </div>
      <div class="stat-card">
        <div class="stat-value savings">$${stats.estimatedSavings.toFixed(4)}</div>
        <div class="stat-label">Estimated Savings</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.totalRequests}</div>
        <div class="stat-label">Total Requests</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${(stats.totalInputTokens + stats.totalOutputTokens).toLocaleString()}</div>
        <div class="stat-label">Total Tokens</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.cacheHits}</div>
        <div class="stat-label">Cache Hits</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${Math.round(stats.averageLatency)}ms</div>
        <div class="stat-label">Avg Latency</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Cost by Provider</div>
      <table>
        <tr><th>Provider</th><th>Requests</th><th>Tokens</th><th>Cost</th></tr>
        ${Object.entries(breakdown.byProvider)
          .map(
            ([provider, data]) =>
              `<tr><td>${provider}</td><td>${data.requests}</td><td>${data.tokens.toLocaleString()}</td><td>$${data.cost.toFixed(4)}</td></tr>`
          )
          .join("")}
      </table>
    </div>

    <div class="section">
      <div class="section-title">Cost by Model</div>
      <table>
        <tr><th>Model</th><th>Requests</th><th>Tokens</th><th>Cost</th></tr>
        ${Object.entries(breakdown.byModel)
          .map(
            ([model, data]) =>
              `<tr><td>${model}</td><td>${data.requests}</td><td>${data.tokens.toLocaleString()}</td><td>$${data.cost.toFixed(4)}</td></tr>`
          )
          .join("")}
      </table>
    </div>

    <div class="section">
      <div class="section-title">Recent Requests</div>
      <table>
        <tr><th>Time</th><th>Model</th><th>Tokens</th><th>Cost</th><th>Query</th></tr>
        ${recentRequests
          .reverse()
          .map(
            (log) =>
              `<tr>
                <td>${new Date(log.timestamp).toLocaleTimeString()}</td>
                <td>${log.model}</td>
                <td>${log.totalTokens}</td>
                <td>$${log.cost.toFixed(6)}</td>
                <td>
                  ${log.queryTruncated}
                  ${log.cached ? '<span class="tag tag-cached">CACHED</span>' : ""}
                  ${log.deduplicated ? '<span class="tag tag-dedup">DEDUP</span>' : ""}
                </td>
              </tr>`
          )
          .join("")}
      </table>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Reset session
   */
  resetSession(): void {
    this.requestLog = [];
    this.sessionStats = this.initSessionStats();
    this.updateStatusBar();
    this.outputChannel.clear();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.statusBarItem.dispose();
    this.outputChannel.dispose();
  }
}

// Singleton instance
let instance: CostTracker | null = null;

export function getCostTracker(): CostTracker {
  if (!instance) {
    instance = new CostTracker();
  }
  return instance;
}

