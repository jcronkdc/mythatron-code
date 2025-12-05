/**
 * Smart Debouncing System
 * 
 * Cursor can trigger requests on every keystroke, inflating costs.
 * This system intelligently debounces requests based on context,
 * typing patterns, and content analysis.
 */

interface DebouncerConfig {
  minDelay: number;
  maxDelay: number;
  idleThreshold: number;
  adaptiveEnabled: boolean;
}

interface TypingPattern {
  averageInterval: number;
  burstCount: number;
  lastKeyTime: number;
  intervals: number[];
}

type DebouncedFunction<T extends (...args: any[]) => any> = {
  (...args: Parameters<T>): Promise<ReturnType<T>>;
  cancel: () => void;
  flush: () => Promise<ReturnType<T> | undefined>;
  pending: () => boolean;
};

export class SmartDebouncer {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private pendingCalls: Map<string, { args: any[]; resolve: (value: any) => void; reject: (error: any) => void }> = new Map();
  private typingPatterns: Map<string, TypingPattern> = new Map();
  private configs: Map<string, DebouncerConfig> = new Map();

  private readonly DEFAULT_CONFIG: DebouncerConfig = {
    minDelay: 150,
    maxDelay: 1000,
    idleThreshold: 500,
    adaptiveEnabled: true,
  };

  // Content-aware delays
  private readonly CONTENT_DELAYS = {
    // Trigger immediately after certain characters
    immediateChars: new Set([".", "(", "{", "[", ",", ":", ";", "="]),
    // Short delay for code completion
    shortDelayPatterns: [
      /\.\w*$/, // Method/property access
      /import\s+.*$/, // Import statements
      /from\s+['"].*$/, // From clauses
    ],
    // Long delay for general typing
    longDelayPatterns: [
      /\/\/.*$/, // Comments
      /\/\*.*$/, // Block comments
      /^\s*$/, // Empty lines
    ],
  };

  /**
   * Create a debounced version of a function
   */
  debounce<T extends (...args: any[]) => Promise<any>>(
    key: string,
    fn: T,
    config?: Partial<DebouncerConfig>
  ): DebouncedFunction<T> {
    const effectiveConfig = { ...this.DEFAULT_CONFIG, ...config };
    this.configs.set(key, effectiveConfig);

    const debouncedFn = (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
      return new Promise((resolve, reject) => {
        // Cancel existing timer
        const existingTimer = this.timers.get(key);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        // Calculate adaptive delay
        const delay = this.calculateDelay(key, args, effectiveConfig);

        // Store pending call
        this.pendingCalls.set(key, { args, resolve, reject });

        // Set new timer
        const timer = setTimeout(async () => {
          const pending = this.pendingCalls.get(key);
          if (pending) {
            this.pendingCalls.delete(key);
            this.timers.delete(key);
            try {
              const result = await fn(...pending.args);
              pending.resolve(result);
            } catch (error) {
              pending.reject(error);
            }
          }
        }, delay);

        this.timers.set(key, timer);
      });
    }) as DebouncedFunction<T>;

    // Add control methods
    debouncedFn.cancel = () => {
      const timer = this.timers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(key);
      }
      this.pendingCalls.delete(key);
    };

    debouncedFn.flush = async () => {
      const pending = this.pendingCalls.get(key);
      if (pending) {
        const timer = this.timers.get(key);
        if (timer) {
          clearTimeout(timer);
          this.timers.delete(key);
        }
        this.pendingCalls.delete(key);
        return fn(...pending.args);
      }
      return undefined;
    };

    debouncedFn.pending = () => {
      return this.pendingCalls.has(key);
    };

    return debouncedFn;
  }

  /**
   * Calculate adaptive delay based on context
   */
  private calculateDelay(key: string, args: any[], config: DebouncerConfig): number {
    if (!config.adaptiveEnabled) {
      return config.minDelay;
    }

    let delay = config.minDelay;

    // Check typing pattern
    const pattern = this.updateTypingPattern(key);
    if (pattern) {
      // Fast typing = longer delay (user is still typing)
      if (pattern.averageInterval < 100 && pattern.burstCount > 3) {
        delay = Math.min(delay * 2, config.maxDelay);
      }
      // Slow typing = shorter delay (user might be thinking)
      else if (pattern.averageInterval > config.idleThreshold) {
        delay = config.minDelay;
      }
    }

    // Content-aware delay
    const content = this.extractContent(args);
    if (content) {
      delay = this.adjustDelayForContent(content, delay, config);
    }

    return Math.min(Math.max(delay, config.minDelay), config.maxDelay);
  }

  /**
   * Update typing pattern tracking
   */
  private updateTypingPattern(key: string): TypingPattern | null {
    const now = Date.now();
    let pattern = this.typingPatterns.get(key);

    if (!pattern) {
      pattern = {
        averageInterval: 0,
        burstCount: 0,
        lastKeyTime: now,
        intervals: [],
      };
      this.typingPatterns.set(key, pattern);
      return pattern;
    }

    const interval = now - pattern.lastKeyTime;
    pattern.lastKeyTime = now;

    // Track intervals (keep last 10)
    pattern.intervals.push(interval);
    if (pattern.intervals.length > 10) {
      pattern.intervals.shift();
    }

    // Calculate average
    pattern.averageInterval =
      pattern.intervals.reduce((a, b) => a + b, 0) / pattern.intervals.length;

    // Track burst typing (consecutive fast keystrokes)
    if (interval < 150) {
      pattern.burstCount++;
    } else {
      pattern.burstCount = 0;
    }

    return pattern;
  }

  /**
   * Extract content from arguments for analysis
   */
  private extractContent(args: any[]): string | null {
    // Try to find a string argument that looks like code
    for (const arg of args) {
      if (typeof arg === "string" && arg.length > 0) {
        return arg;
      }
      if (typeof arg === "object" && arg !== null) {
        // Check common property names
        const props = ["content", "text", "code", "document", "value"];
        for (const prop of props) {
          if (typeof arg[prop] === "string") {
            return arg[prop];
          }
        }
      }
    }
    return null;
  }

  /**
   * Adjust delay based on content patterns
   */
  private adjustDelayForContent(
    content: string,
    baseDelay: number,
    config: DebouncerConfig
  ): number {
    const lastChar = content.slice(-1);
    const lastLine = content.split("\n").pop() || "";

    // Immediate trigger characters
    if (this.CONTENT_DELAYS.immediateChars.has(lastChar)) {
      return config.minDelay;
    }

    // Short delay patterns
    for (const pattern of this.CONTENT_DELAYS.shortDelayPatterns) {
      if (pattern.test(lastLine)) {
        return config.minDelay;
      }
    }

    // Long delay patterns
    for (const pattern of this.CONTENT_DELAYS.longDelayPatterns) {
      if (pattern.test(lastLine)) {
        return config.maxDelay;
      }
    }

    return baseDelay;
  }

  /**
   * Throttle a function (different from debounce - guarantees execution)
   */
  throttle<T extends (...args: any[]) => Promise<any>>(
    key: string,
    fn: T,
    intervalMs: number
  ): (...args: Parameters<T>) => Promise<ReturnType<T> | null> {
    let lastCall = 0;
    let pendingCall: Promise<ReturnType<T>> | null = null;

    return async (...args: Parameters<T>): Promise<ReturnType<T> | null> => {
      const now = Date.now();

      if (now - lastCall >= intervalMs) {
        lastCall = now;
        pendingCall = fn(...args);
        return pendingCall;
      }

      // Return the pending call's result if one is in progress
      if (pendingCall) {
        return pendingCall;
      }

      return null;
    };
  }

  /**
   * Clear all debounced calls
   */
  clearAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.pendingCalls.clear();
    this.typingPatterns.clear();
  }

  /**
   * Get statistics
   */
  getStats(): {
    activeDebouncers: number;
    pendingCalls: number;
    typingPatterns: Map<string, TypingPattern>;
  } {
    return {
      activeDebouncers: this.timers.size,
      pendingCalls: this.pendingCalls.size,
      typingPatterns: new Map(this.typingPatterns),
    };
  }
}

// Singleton instance
let instance: SmartDebouncer | null = null;

export function getSmartDebouncer(): SmartDebouncer {
  if (!instance) {
    instance = new SmartDebouncer();
  }
  return instance;
}

