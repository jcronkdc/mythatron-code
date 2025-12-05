/**
 * Request Batching
 * 
 * Cursor makes separate API calls for each small operation.
 * We batch related requests together to reduce overhead and cost.
 */

interface BatchedRequest<T> {
  id: string;
  request: T;
  resolve: (result: any) => void;
  reject: (error: any) => void;
  timestamp: number;
}

interface BatchConfig {
  maxBatchSize: number;
  maxWaitMs: number;
  enabled: boolean;
}

export class RequestBatcher<T, R> {
  private queue: BatchedRequest<T>[] = [];
  private timer: NodeJS.Timeout | null = null;
  private config: BatchConfig = {
    maxBatchSize: 5,
    maxWaitMs: 100,
    enabled: true,
  };

  private batchExecutor: (requests: T[]) => Promise<R[]>;

  constructor(executor: (requests: T[]) => Promise<R[]>) {
    this.batchExecutor = executor;
  }

  /**
   * Add request to batch
   */
  async add(request: T): Promise<R> {
    if (!this.config.enabled) {
      const results = await this.batchExecutor([request]);
      return results[0];
    }

    return new Promise((resolve, reject) => {
      const batchedRequest: BatchedRequest<T> = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        request,
        resolve,
        reject,
        timestamp: Date.now(),
      };

      this.queue.push(batchedRequest);

      // Execute immediately if batch is full
      if (this.queue.length >= this.config.maxBatchSize) {
        this.flush();
      } else if (!this.timer) {
        // Start timer for batch window
        this.timer = setTimeout(() => this.flush(), this.config.maxWaitMs);
      }
    });
  }

  /**
   * Execute batched requests
   */
  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.config.maxBatchSize);
    const requests = batch.map((b) => b.request);

    try {
      const results = await this.batchExecutor(requests);

      // Distribute results
      batch.forEach((item, index) => {
        if (results[index] !== undefined) {
          item.resolve(results[index]);
        } else {
          item.reject(new Error("No result for batched request"));
        }
      });
    } catch (error) {
      // Reject all in batch
      batch.forEach((item) => item.reject(error));
    }

    // Process remaining queue
    if (this.queue.length > 0) {
      this.timer = setTimeout(() => this.flush(), this.config.maxWaitMs);
    }
  }

  /**
   * Configure batcher
   */
  configure(config: Partial<BatchConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Clear queue
   */
  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue.forEach((item) => item.reject(new Error("Queue cleared")));
    this.queue = [];
  }
}

// Pre-configured batchers for common operations
export function createCompletionBatcher(
  executor: (prompts: string[]) => Promise<string[]>
): RequestBatcher<string, string> {
  return new RequestBatcher(executor);
}

export function createEmbeddingBatcher(
  executor: (texts: string[]) => Promise<number[][]>
): RequestBatcher<string, number[]> {
  return new RequestBatcher(executor);
}

