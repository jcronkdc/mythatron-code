/**
 * Offline Mode with Request Queuing
 * 
 * Cursor always requires internet. This system:
 * - Detects network connectivity
 * - Queues requests when offline
 * - Falls back to local models (Ollama)
 * - Syncs queued requests when back online
 */

import * as vscode from "vscode";
import * as https from "https";

interface QueuedRequest {
  id: string;
  timestamp: number;
  query: string;
  context?: string;
  priority: "high" | "medium" | "low";
  retryCount: number;
  maxRetries: number;
  callback: (result: any) => void;
  errorCallback: (error: Error) => void;
}

interface OfflineStats {
  totalQueuedRequests: number;
  processedFromQueue: number;
  localModelFallbacks: number;
  networkOutages: number;
  averageOutageDuration: number;
}

export class OfflineMode {
  private isOnline: boolean = true;
  private requestQueue: QueuedRequest[] = [];
  private stats: OfflineStats = {
    totalQueuedRequests: 0,
    processedFromQueue: 0,
    localModelFallbacks: 0,
    networkOutages: 0,
    averageOutageDuration: 0,
  };
  private checkInterval: NodeJS.Timeout | null = null;
  private outageStart: number | null = null;
  private outageDurations: number[] = [];
  private statusBarItem: vscode.StatusBarItem;
  private onStatusChange?: (online: boolean) => void;

  private readonly CHECK_INTERVAL = 10000; // Check every 10 seconds
  private readonly QUEUE_PROCESS_DELAY = 1000; // Delay between processing queued items
  private readonly MAX_QUEUE_SIZE = 100;
  private readonly MAX_QUEUE_AGE = 30 * 60 * 1000; // 30 minutes

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      99
    );
    this.startConnectivityMonitor();
    this.updateStatusBar();
  }

  /**
   * Start monitoring network connectivity
   */
  private startConnectivityMonitor(): void {
    // Initial check
    this.checkConnectivity();

    // Periodic checks
    this.checkInterval = setInterval(() => {
      this.checkConnectivity();
    }, this.CHECK_INTERVAL);
  }

  /**
   * Check network connectivity
   */
  private async checkConnectivity(): Promise<boolean> {
    const wasOnline = this.isOnline;

    try {
      // Try multiple endpoints for reliability
      const online = await Promise.race([
        this.pingEndpoint("https://api.anthropic.com"),
        this.pingEndpoint("https://api.openai.com"),
        this.pingEndpoint("https://www.google.com"),
      ]);

      this.isOnline = online;
    } catch {
      this.isOnline = false;
    }

    // Handle state change
    if (wasOnline !== this.isOnline) {
      this.handleConnectivityChange(wasOnline, this.isOnline);
    }

    return this.isOnline;
  }

  /**
   * Ping an endpoint to check connectivity
   */
  private pingEndpoint(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, 5000);

      https
        .get(url, { timeout: 5000 }, (res) => {
          clearTimeout(timeout);
          resolve(res.statusCode !== undefined);
        })
        .on("error", () => {
          clearTimeout(timeout);
          resolve(false);
        });
    });
  }

  /**
   * Handle connectivity state change
   */
  private handleConnectivityChange(wasOnline: boolean, isOnline: boolean): void {
    if (!isOnline && wasOnline) {
      // Went offline
      this.outageStart = Date.now();
      this.stats.networkOutages++;
      vscode.window.showWarningMessage(
        "MythaTron Code: Network offline. Requests will be queued or routed to local models."
      );
    } else if (isOnline && !wasOnline) {
      // Came back online
      if (this.outageStart) {
        const duration = Date.now() - this.outageStart;
        this.outageDurations.push(duration);
        this.stats.averageOutageDuration =
          this.outageDurations.reduce((a, b) => a + b, 0) / this.outageDurations.length;
        this.outageStart = null;
      }
      vscode.window.showInformationMessage(
        `MythaTron Code: Back online. Processing ${this.requestQueue.length} queued requests.`
      );
      this.processQueue();
    }

    this.updateStatusBar();
    this.onStatusChange?.(isOnline);
  }

  /**
   * Update status bar
   */
  private updateStatusBar(): void {
    if (this.isOnline) {
      this.statusBarItem.text = "$(cloud) Online";
      this.statusBarItem.backgroundColor = undefined;
    } else {
      this.statusBarItem.text = `$(cloud-offline) Offline (${this.requestQueue.length} queued)`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
    }
    this.statusBarItem.tooltip = this.getTooltip();
    this.statusBarItem.show();
  }

  /**
   * Get tooltip text
   */
  private getTooltip(): string {
    const status = this.isOnline ? "🟢 Online" : "🔴 Offline";
    const lines = [
      status,
      `Queued: ${this.requestQueue.length}`,
      `Local Fallbacks: ${this.stats.localModelFallbacks}`,
      `Outages: ${this.stats.networkOutages}`,
    ];

    if (this.outageStart) {
      const duration = Math.round((Date.now() - this.outageStart) / 1000);
      lines.push(`Current outage: ${duration}s`);
    }

    if (this.stats.averageOutageDuration > 0) {
      lines.push(`Avg outage: ${Math.round(this.stats.averageOutageDuration / 1000)}s`);
    }

    return lines.join("\n");
  }

  /**
   * Execute a request with offline handling
   */
  async execute<T>(
    query: string,
    executor: () => Promise<T>,
    options: {
      context?: string;
      priority?: "high" | "medium" | "low";
      fallbackToLocal?: boolean;
      localExecutor?: () => Promise<T>;
      queueIfOffline?: boolean;
    } = {}
  ): Promise<T> {
    const priority = options.priority || "medium";
    const fallbackToLocal = options.fallbackToLocal ?? true;
    const queueIfOffline = options.queueIfOffline ?? true;

    // If online, execute normally
    if (this.isOnline) {
      try {
        return await executor();
      } catch (error: any) {
        // Network error during execution
        if (this.isNetworkError(error)) {
          this.isOnline = false;
          this.handleConnectivityChange(true, false);
          // Fall through to offline handling
        } else {
          throw error;
        }
      }
    }

    // Offline handling

    // Try local model fallback first
    if (fallbackToLocal && options.localExecutor) {
      try {
        this.stats.localModelFallbacks++;
        return await options.localExecutor();
      } catch {
        // Local model also failed, continue to queuing
      }
    }

    // Queue the request
    if (queueIfOffline) {
      return new Promise((resolve, reject) => {
        this.queueRequest({
          query,
          context: options.context,
          priority,
          callback: (result) => resolve(result),
          errorCallback: reject,
        });
      });
    }

    throw new Error("Network offline and queueing disabled");
  }

  /**
   * Check if an error is a network error
   */
  private isNetworkError(error: any): boolean {
    const networkCodes = [
      "ENOTFOUND",
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "ENETUNREACH",
    ];
    return (
      networkCodes.includes(error.code) ||
      error.message?.includes("network") ||
      error.message?.includes("fetch")
    );
  }

  /**
   * Queue a request for later execution
   */
  private queueRequest(options: {
    query: string;
    context?: string;
    priority: "high" | "medium" | "low";
    callback: (result: any) => void;
    errorCallback: (error: Error) => void;
  }): void {
    // Enforce queue size limit
    if (this.requestQueue.length >= this.MAX_QUEUE_SIZE) {
      // Remove oldest low-priority request
      const lowPriorityIdx = this.requestQueue.findIndex((r) => r.priority === "low");
      if (lowPriorityIdx !== -1) {
        const removed = this.requestQueue.splice(lowPriorityIdx, 1)[0];
        removed.errorCallback(new Error("Request dropped due to queue overflow"));
      } else {
        options.errorCallback(new Error("Request queue full"));
        return;
      }
    }

    const request: QueuedRequest = {
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      query: options.query,
      context: options.context,
      priority: options.priority,
      retryCount: 0,
      maxRetries: 3,
      callback: options.callback,
      errorCallback: options.errorCallback,
    };

    // Insert based on priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const insertIdx = this.requestQueue.findIndex(
      (r) => priorityOrder[r.priority] > priorityOrder[request.priority]
    );

    if (insertIdx === -1) {
      this.requestQueue.push(request);
    } else {
      this.requestQueue.splice(insertIdx, 0, request);
    }

    this.stats.totalQueuedRequests++;
    this.updateStatusBar();
  }

  /**
   * Process queued requests
   */
  private async processQueue(): Promise<void> {
    if (!this.isOnline || this.requestQueue.length === 0) {
      return;
    }

    // Clean up expired requests first
    this.cleanupExpiredRequests();

    // Process requests one by one
    while (this.requestQueue.length > 0 && this.isOnline) {
      const request = this.requestQueue.shift()!;

      try {
        // Re-execute the request
        // Note: In real implementation, you'd need to store the executor function
        // For now, we just notify that the request can be retried
        this.stats.processedFromQueue++;
        request.callback({ status: "ready_to_retry", query: request.query });
      } catch (error: any) {
        if (this.isNetworkError(error) && request.retryCount < request.maxRetries) {
          // Put back in queue for retry
          request.retryCount++;
          this.requestQueue.unshift(request);
          break; // Stop processing, we're offline again
        } else {
          request.errorCallback(error);
        }
      }

      // Delay between requests to avoid overwhelming the API
      await new Promise((resolve) => setTimeout(resolve, this.QUEUE_PROCESS_DELAY));
    }

    this.updateStatusBar();
  }

  /**
   * Clean up expired requests
   */
  private cleanupExpiredRequests(): void {
    const now = Date.now();
    const expired: QueuedRequest[] = [];

    this.requestQueue = this.requestQueue.filter((request) => {
      if (now - request.timestamp > this.MAX_QUEUE_AGE) {
        expired.push(request);
        return false;
      }
      return true;
    });

    // Notify expired requests
    for (const request of expired) {
      request.errorCallback(new Error("Request expired in queue"));
    }
  }

  /**
   * Check if currently online
   */
  getStatus(): { online: boolean; queueSize: number } {
    return {
      online: this.isOnline,
      queueSize: this.requestQueue.length,
    };
  }

  /**
   * Get statistics
   */
  getStats(): OfflineStats {
    return { ...this.stats };
  }

  /**
   * Force a connectivity check
   */
  async forceCheck(): Promise<boolean> {
    return this.checkConnectivity();
  }

  /**
   * Set status change callback
   */
  onStatusChangeCallback(callback: (online: boolean) => void): void {
    this.onStatusChange = callback;
  }

  /**
   * Clear the request queue
   */
  clearQueue(): void {
    for (const request of this.requestQueue) {
      request.errorCallback(new Error("Queue cleared"));
    }
    this.requestQueue = [];
    this.updateStatusBar();
  }

  /**
   * Get queue contents
   */
  getQueue(): Array<{ id: string; query: string; priority: string; age: number }> {
    const now = Date.now();
    return this.requestQueue.map((r) => ({
      id: r.id,
      query: r.query.slice(0, 50) + (r.query.length > 50 ? "..." : ""),
      priority: r.priority,
      age: Math.round((now - r.timestamp) / 1000),
    }));
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    this.statusBarItem.dispose();
    this.clearQueue();
  }
}

// Singleton instance
let instance: OfflineMode | null = null;

export function getOfflineMode(): OfflineMode {
  if (!instance) {
    instance = new OfflineMode();
  }
  return instance;
}

