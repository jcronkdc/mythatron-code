/**
 * Request Deduplication System
 * 
 * Cursor charges for identical requests made within short timeframes.
 * This system detects and deduplicates requests, preventing double-charging.
 */

import * as crypto from "crypto";

interface PendingRequest {
  hash: string;
  query: string;
  timestamp: number;
  resolvers: Array<{
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }>;
  result?: any;
  error?: any;
  completed: boolean;
}

interface DedupeStats {
  totalRequests: number;
  deduplicatedRequests: number;
  savedRequests: number;
  estimatedSavings: number;
}

export class RequestDeduplicator {
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private recentRequests: Map<string, { result: any; timestamp: number }> = new Map();
  private stats: DedupeStats = {
    totalRequests: 0,
    deduplicatedRequests: 0,
    savedRequests: 0,
    estimatedSavings: 0,
  };

  // Time window for deduplication (ms)
  private readonly DEDUPE_WINDOW = 5000; // 5 seconds
  private readonly RECENT_CACHE_WINDOW = 30000; // 30 seconds

  /**
   * Create a hash of the request for deduplication
   */
  private hashRequest(query: string, context?: string): string {
    const normalized = query.toLowerCase().trim();
    const input = context ? `${normalized}::${context}` : normalized;
    return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
  }

  /**
   * Execute a request with deduplication
   */
  async execute<T>(
    query: string,
    executor: () => Promise<T>,
    options: {
      context?: string;
      forceNew?: boolean;
      estimatedCost?: number;
    } = {}
  ): Promise<T> {
    this.stats.totalRequests++;

    // Force new request if specified
    if (options.forceNew) {
      return executor();
    }

    const hash = this.hashRequest(query, options.context);

    // Check if identical request is already pending
    const pending = this.pendingRequests.get(hash);
    if (pending && !pending.completed && Date.now() - pending.timestamp < this.DEDUPE_WINDOW) {
      this.stats.deduplicatedRequests++;
      this.stats.savedRequests++;
      this.stats.estimatedSavings += options.estimatedCost || 0.01;

      // Wait for the pending request to complete
      return new Promise((resolve, reject) => {
        pending.resolvers.push({ resolve, reject });
      });
    }

    // Check recent cache
    const recent = this.recentRequests.get(hash);
    if (recent && Date.now() - recent.timestamp < this.RECENT_CACHE_WINDOW) {
      this.stats.deduplicatedRequests++;
      this.stats.savedRequests++;
      this.stats.estimatedSavings += options.estimatedCost || 0.01;
      return recent.result;
    }

    // Create new pending request
    const newPending: PendingRequest = {
      hash,
      query,
      timestamp: Date.now(),
      resolvers: [],
      completed: false,
    };
    this.pendingRequests.set(hash, newPending);

    try {
      // Execute the request
      const result = await executor();

      // Store result
      newPending.result = result;
      newPending.completed = true;

      // Cache for recent requests
      this.recentRequests.set(hash, {
        result,
        timestamp: Date.now(),
      });

      // Resolve all waiting requests
      for (const { resolve } of newPending.resolvers) {
        resolve(result);
      }

      return result;
    } catch (error) {
      // Propagate error to all waiting requests
      newPending.error = error;
      newPending.completed = true;

      for (const { reject } of newPending.resolvers) {
        reject(error);
      }

      throw error;
    } finally {
      // Clean up after a delay
      setTimeout(() => {
        this.pendingRequests.delete(hash);
      }, this.DEDUPE_WINDOW);
    }
  }

  /**
   * Batch multiple requests into one
   */
  async batch<T>(
    requests: Array<{ query: string; context?: string }>,
    batchExecutor: (queries: string[]) => Promise<T[]>
  ): Promise<T[]> {
    // Deduplicate within the batch
    const uniqueRequests = new Map<string, { query: string; indices: number[] }>();

    requests.forEach((req, index) => {
      const hash = this.hashRequest(req.query, req.context);
      const existing = uniqueRequests.get(hash);
      if (existing) {
        existing.indices.push(index);
        this.stats.deduplicatedRequests++;
        this.stats.savedRequests++;
      } else {
        uniqueRequests.set(hash, { query: req.query, indices: [index] });
      }
    });

    // Execute batch with unique queries
    const uniqueQueries = Array.from(uniqueRequests.values()).map((v) => v.query);
    const results = await batchExecutor(uniqueQueries);

    // Map results back to original indices
    const mappedResults: T[] = new Array(requests.length);
    let resultIndex = 0;

    for (const { indices } of uniqueRequests.values()) {
      const result = results[resultIndex++];
      for (const index of indices) {
        mappedResults[index] = result;
      }
    }

    return mappedResults;
  }

  /**
   * Clean up old entries
   */
  cleanup(): void {
    const now = Date.now();

    // Clean pending requests
    for (const [hash, pending] of this.pendingRequests.entries()) {
      if (now - pending.timestamp > this.DEDUPE_WINDOW) {
        this.pendingRequests.delete(hash);
      }
    }

    // Clean recent cache
    for (const [hash, recent] of this.recentRequests.entries()) {
      if (now - recent.timestamp > this.RECENT_CACHE_WINDOW) {
        this.recentRequests.delete(hash);
      }
    }
  }

  /**
   * Get deduplication statistics
   */
  getStats(): DedupeStats & { deduplicationRate: number } {
    return {
      ...this.stats,
      deduplicationRate:
        this.stats.totalRequests > 0
          ? (this.stats.deduplicatedRequests / this.stats.totalRequests) * 100
          : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      deduplicatedRequests: 0,
      savedRequests: 0,
      estimatedSavings: 0,
    };
  }
}

// Singleton instance
let instance: RequestDeduplicator | null = null;

export function getRequestDeduplicator(): RequestDeduplicator {
  if (!instance) {
    instance = new RequestDeduplicator();
  }
  return instance;
}

