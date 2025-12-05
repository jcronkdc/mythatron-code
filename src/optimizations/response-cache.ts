/**
 * Enhanced Response Cache with Semantic Similarity
 * 
 * Unlike Cursor's approach of charging for every request,
 * we cache responses and use fuzzy matching to serve
 * similar questions from cache.
 */

import * as crypto from "crypto";

interface CacheEntry {
  query: string;
  queryHash: string;
  queryTokens: Set<string>;
  response: string;
  toolCalls?: any[];
  timestamp: number;
  ttl: number;
  hitCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

interface CacheStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  totalSaved: number;
  tokensSaved: number;
}

export class ResponseCache {
  private cache: Map<string, CacheEntry> = new Map();
  private semanticIndex: Map<string, string[]> = new Map(); // token -> cache keys
  private stats: CacheStats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalSaved: 0,
    tokensSaved: 0,
  };

  // Default TTLs by query type
  private readonly TTL_CONFIG = {
    explain: 24 * 60 * 60 * 1000, // 24 hours - explanations rarely change
    documentation: 7 * 24 * 60 * 60 * 1000, // 7 days
    refactor: 1 * 60 * 60 * 1000, // 1 hour - code might change
    generate: 30 * 60 * 1000, // 30 mins - context dependent
    fix: 15 * 60 * 1000, // 15 mins - usually context specific
    default: 1 * 60 * 60 * 1000, // 1 hour default
  };

  private readonly SIMILARITY_THRESHOLD = 0.75; // 75% similarity for cache hit
  private readonly MAX_CACHE_SIZE = 1000;
  private readonly MAX_ENTRY_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days max

  /**
   * Create a hash of the query for exact matching
   */
  private hashQuery(query: string, context?: string): string {
    const normalized = this.normalizeQuery(query);
    const input = context ? `${normalized}::${context}` : normalized;
    return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
  }

  /**
   * Normalize a query for better matching
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\w\s]/g, "")
      .trim();
  }

  /**
   * Tokenize query for semantic matching
   */
  private tokenize(query: string): Set<string> {
    const normalized = this.normalizeQuery(query);
    const tokens = normalized.split(" ").filter((t) => t.length > 2);

    // Also add bigrams for better matching
    const bigrams: string[] = [];
    for (let i = 0; i < tokens.length - 1; i++) {
      bigrams.push(`${tokens[i]}_${tokens[i + 1]}`);
    }

    return new Set([...tokens, ...bigrams]);
  }

  /**
   * Calculate Jaccard similarity between two token sets
   */
  private calculateSimilarity(set1: Set<string>, set2: Set<string>): number {
    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
  }

  /**
   * Determine TTL based on query type
   */
  private getTTL(query: string): number {
    const lowerQuery = query.toLowerCase();

    if (
      lowerQuery.includes("explain") ||
      lowerQuery.includes("what is") ||
      lowerQuery.includes("how does")
    ) {
      return this.TTL_CONFIG.explain;
    }
    if (
      lowerQuery.includes("document") ||
      lowerQuery.includes("jsdoc") ||
      lowerQuery.includes("readme")
    ) {
      return this.TTL_CONFIG.documentation;
    }
    if (
      lowerQuery.includes("refactor") ||
      lowerQuery.includes("improve") ||
      lowerQuery.includes("optimize")
    ) {
      return this.TTL_CONFIG.refactor;
    }
    if (
      lowerQuery.includes("generate") ||
      lowerQuery.includes("create") ||
      lowerQuery.includes("write")
    ) {
      return this.TTL_CONFIG.generate;
    }
    if (
      lowerQuery.includes("fix") ||
      lowerQuery.includes("error") ||
      lowerQuery.includes("bug")
    ) {
      return this.TTL_CONFIG.fix;
    }

    return this.TTL_CONFIG.default;
  }

  /**
   * Find semantically similar cached entries
   */
  private findSimilarEntry(query: string): CacheEntry | null {
    const queryTokens = this.tokenize(query);
    let bestMatch: CacheEntry | null = null;
    let bestSimilarity = 0;

    // Get candidate entries from semantic index
    const candidates = new Set<string>();
    for (const token of queryTokens) {
      const keys = this.semanticIndex.get(token) || [];
      keys.forEach((k) => candidates.add(k));
    }

    // Check similarity for each candidate
    for (const key of candidates) {
      const entry = this.cache.get(key);
      if (!entry) continue;

      // Skip expired entries
      if (Date.now() - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        continue;
      }

      const similarity = this.calculateSimilarity(queryTokens, entry.queryTokens);
      if (similarity > bestSimilarity && similarity >= this.SIMILARITY_THRESHOLD) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    return bestMatch;
  }

  /**
   * Get cached response
   */
  get(
    query: string,
    context?: string
  ): { response: string; toolCalls?: any[]; fromCache: boolean } | null {
    this.stats.totalRequests++;

    // Try exact match first
    const hash = this.hashQuery(query, context);
    const exactMatch = this.cache.get(hash);

    if (exactMatch && Date.now() - exactMatch.timestamp <= exactMatch.ttl) {
      exactMatch.hitCount++;
      this.stats.cacheHits++;
      this.stats.tokensSaved += exactMatch.inputTokens + exactMatch.outputTokens;
      this.stats.totalSaved += exactMatch.estimatedCost;

      return {
        response: exactMatch.response,
        toolCalls: exactMatch.toolCalls,
        fromCache: true,
      };
    }

    // Try semantic match (only for queries without specific context)
    if (!context) {
      const similarEntry = this.findSimilarEntry(query);
      if (similarEntry) {
        similarEntry.hitCount++;
        this.stats.cacheHits++;
        this.stats.tokensSaved += similarEntry.inputTokens + similarEntry.outputTokens;
        this.stats.totalSaved += similarEntry.estimatedCost;

        return {
          response: similarEntry.response,
          toolCalls: similarEntry.toolCalls,
          fromCache: true,
        };
      }
    }

    this.stats.cacheMisses++;
    return null;
  }

  /**
   * Store response in cache
   */
  set(
    query: string,
    response: string,
    options: {
      context?: string;
      toolCalls?: any[];
      inputTokens?: number;
      outputTokens?: number;
      estimatedCost?: number;
    } = {}
  ): void {
    // Enforce cache size limit
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      this.evictOldest();
    }

    const hash = this.hashQuery(query, options.context);
    const queryTokens = this.tokenize(query);
    const ttl = this.getTTL(query);

    const entry: CacheEntry = {
      query,
      queryHash: hash,
      queryTokens,
      response,
      toolCalls: options.toolCalls,
      timestamp: Date.now(),
      ttl,
      hitCount: 0,
      inputTokens: options.inputTokens || 0,
      outputTokens: options.outputTokens || 0,
      estimatedCost: options.estimatedCost || 0,
    };

    this.cache.set(hash, entry);

    // Update semantic index
    for (const token of queryTokens) {
      const keys = this.semanticIndex.get(token) || [];
      if (!keys.includes(hash)) {
        keys.push(hash);
        this.semanticIndex.set(token, keys);
      }
    }
  }

  /**
   * Evict oldest/least used entries
   */
  private evictOldest(): void {
    const entries = Array.from(this.cache.entries());

    // Sort by score: older + fewer hits = lower score
    entries.sort((a, b) => {
      const scoreA = a[1].hitCount / (Date.now() - a[1].timestamp);
      const scoreB = b[1].hitCount / (Date.now() - b[1].timestamp);
      return scoreA - scoreB;
    });

    // Remove bottom 10%
    const toRemove = Math.ceil(entries.length * 0.1);
    for (let i = 0; i < toRemove; i++) {
      const [key, entry] = entries[i];
      this.cache.delete(key);

      // Clean up semantic index
      for (const token of entry.queryTokens) {
        const keys = this.semanticIndex.get(token) || [];
        const idx = keys.indexOf(key);
        if (idx !== -1) {
          keys.splice(idx, 1);
          if (keys.length === 0) {
            this.semanticIndex.delete(token);
          } else {
            this.semanticIndex.set(token, keys);
          }
        }
      }
    }
  }

  /**
   * Clear expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl || now - entry.timestamp > this.MAX_ENTRY_AGE) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & { hitRate: number; cacheSize: number } {
    return {
      ...this.stats,
      hitRate:
        this.stats.totalRequests > 0
          ? (this.stats.cacheHits / this.stats.totalRequests) * 100
          : 0,
      cacheSize: this.cache.size,
    };
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  invalidate(pattern: string | RegExp): number {
    let invalidated = 0;
    const regex = typeof pattern === "string" ? new RegExp(pattern, "i") : pattern;

    for (const [key, entry] of this.cache.entries()) {
      if (regex.test(entry.query)) {
        this.cache.delete(key);
        invalidated++;
      }
    }

    return invalidated;
  }

  /**
   * Export cache for persistence
   */
  export(): string {
    const data = {
      entries: Array.from(this.cache.entries()),
      stats: this.stats,
    };
    return JSON.stringify(data);
  }

  /**
   * Import cache from persistence
   */
  import(data: string): void {
    try {
      const parsed = JSON.parse(data);
      this.cache = new Map(parsed.entries);
      this.stats = parsed.stats || this.stats;

      // Rebuild semantic index
      this.semanticIndex.clear();
      for (const [key, entry] of this.cache.entries()) {
        for (const token of entry.queryTokens) {
          const keys = this.semanticIndex.get(token) || [];
          keys.push(key);
          this.semanticIndex.set(token, keys);
        }
      }

      // Clean up expired entries
      this.cleanup();
    } catch {
      // Invalid data, start fresh
      this.cache.clear();
      this.semanticIndex.clear();
    }
  }
}

// Singleton instance
let instance: ResponseCache | null = null;

export function getResponseCache(): ResponseCache {
  if (!instance) {
    instance = new ResponseCache();
  }
  return instance;
}

