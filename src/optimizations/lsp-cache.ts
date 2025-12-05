/**
 * Code Intelligence Caching (LSP Cache)
 * 
 * Cursor re-analyzes the same code repeatedly, wasting resources.
 * This system caches LSP results and intelligently invalidates
 * only what's changed.
 */

import * as vscode from "vscode";
import * as crypto from "crypto";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  contentHash: string;
  hitCount: number;
}

interface DiagnosticsCache {
  diagnostics: vscode.Diagnostic[];
  contentHash: string;
  timestamp: number;
}

interface SymbolCache {
  symbols: vscode.DocumentSymbol[];
  contentHash: string;
  timestamp: number;
}

interface ReferenceCache {
  references: vscode.Location[];
  symbolHash: string;
  timestamp: number;
}

interface CompletionCache {
  items: vscode.CompletionItem[];
  triggerContext: string;
  timestamp: number;
}

interface CacheStats {
  diagnosticsHits: number;
  diagnosticsMisses: number;
  symbolsHits: number;
  symbolsMisses: number;
  referencesHits: number;
  referencesMisses: number;
  completionsHits: number;
  completionsMisses: number;
  invalidations: number;
}

export class LSPCache {
  // Per-file caches
  private diagnosticsCache: Map<string, DiagnosticsCache> = new Map();
  private symbolsCache: Map<string, SymbolCache> = new Map();
  private referencesCache: Map<string, ReferenceCache> = new Map();
  private completionsCache: Map<string, CompletionCache> = new Map();

  // Global caches
  private definitionCache: Map<string, CacheEntry<vscode.Location[]>> = new Map();
  private hoverCache: Map<string, CacheEntry<vscode.Hover>> = new Map();
  private typeDefinitionCache: Map<string, CacheEntry<vscode.Location[]>> = new Map();

  private stats: CacheStats = {
    diagnosticsHits: 0,
    diagnosticsMisses: 0,
    symbolsHits: 0,
    symbolsMisses: 0,
    referencesHits: 0,
    referencesMisses: 0,
    completionsHits: 0,
    completionsMisses: 0,
    invalidations: 0,
  };

  private fileWatcher: vscode.FileSystemWatcher;
  private documentChangeDisposable: vscode.Disposable;

  // TTLs (milliseconds)
  private readonly TTL = {
    diagnostics: 30000, // 30 seconds
    symbols: 60000, // 1 minute
    references: 120000, // 2 minutes
    completions: 5000, // 5 seconds (context-sensitive)
    definitions: 300000, // 5 minutes
    hover: 60000, // 1 minute
  };

  constructor() {
    // Watch for file changes
    this.fileWatcher = vscode.workspace.createFileSystemWatcher("**/*");
    this.fileWatcher.onDidChange((uri) => this.invalidateFile(uri.fsPath));
    this.fileWatcher.onDidDelete((uri) => this.invalidateFile(uri.fsPath));

    // Watch for document changes
    this.documentChangeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
      this.invalidateFile(e.document.uri.fsPath);
    });
  }

  /**
   * Calculate content hash for cache invalidation
   */
  private hashContent(content: string): string {
    return crypto.createHash("md5").update(content).digest("hex").slice(0, 16);
  }

  /**
   * Create a cache key from position
   */
  private positionKey(uri: string, position: vscode.Position): string {
    return `${uri}:${position.line}:${position.character}`;
  }

  /**
   * Get or compute diagnostics
   */
  async getDiagnostics(
    document: vscode.TextDocument,
    compute: () => Promise<vscode.Diagnostic[]>
  ): Promise<{ diagnostics: vscode.Diagnostic[]; cached: boolean }> {
    const key = document.uri.fsPath;
    const contentHash = this.hashContent(document.getText());
    const cached = this.diagnosticsCache.get(key);

    if (
      cached &&
      cached.contentHash === contentHash &&
      Date.now() - cached.timestamp < this.TTL.diagnostics
    ) {
      this.stats.diagnosticsHits++;
      return { diagnostics: cached.diagnostics, cached: true };
    }

    this.stats.diagnosticsMisses++;
    const diagnostics = await compute();

    this.diagnosticsCache.set(key, {
      diagnostics,
      contentHash,
      timestamp: Date.now(),
    });

    return { diagnostics, cached: false };
  }

  /**
   * Get or compute document symbols
   */
  async getSymbols(
    document: vscode.TextDocument,
    compute: () => Promise<vscode.DocumentSymbol[]>
  ): Promise<{ symbols: vscode.DocumentSymbol[]; cached: boolean }> {
    const key = document.uri.fsPath;
    const contentHash = this.hashContent(document.getText());
    const cached = this.symbolsCache.get(key);

    if (
      cached &&
      cached.contentHash === contentHash &&
      Date.now() - cached.timestamp < this.TTL.symbols
    ) {
      this.stats.symbolsHits++;
      return { symbols: cached.symbols, cached: true };
    }

    this.stats.symbolsMisses++;
    const symbols = await compute();

    this.symbolsCache.set(key, {
      symbols,
      contentHash,
      timestamp: Date.now(),
    });

    return { symbols, cached: false };
  }

  /**
   * Get or compute references
   */
  async getReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    compute: () => Promise<vscode.Location[]>
  ): Promise<{ references: vscode.Location[]; cached: boolean }> {
    const wordRange = document.getWordRangeAtPosition(position);
    const word = wordRange ? document.getText(wordRange) : "";
    const symbolHash = this.hashContent(`${document.uri.fsPath}:${word}`);
    const key = this.positionKey(document.uri.fsPath, position);

    const cached = this.referencesCache.get(key);

    if (
      cached &&
      cached.symbolHash === symbolHash &&
      Date.now() - cached.timestamp < this.TTL.references
    ) {
      this.stats.referencesHits++;
      return { references: cached.references, cached: true };
    }

    this.stats.referencesMisses++;
    const references = await compute();

    this.referencesCache.set(key, {
      references,
      symbolHash,
      timestamp: Date.now(),
    });

    return { references, cached: false };
  }

  /**
   * Get or compute completions
   */
  async getCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
    compute: () => Promise<vscode.CompletionItem[]>
  ): Promise<{ items: vscode.CompletionItem[]; cached: boolean }> {
    // Create context-aware key
    const lineText = document.lineAt(position.line).text;
    const prefix = lineText.substring(0, position.character);
    const triggerContext = this.hashContent(
      `${document.uri.fsPath}:${position.line}:${prefix}`
    );
    const key = `${document.uri.fsPath}:${position.line}`;

    const cached = this.completionsCache.get(key);

    if (
      cached &&
      cached.triggerContext === triggerContext &&
      Date.now() - cached.timestamp < this.TTL.completions
    ) {
      this.stats.completionsHits++;
      return { items: cached.items, cached: true };
    }

    this.stats.completionsMisses++;
    const items = await compute();

    this.completionsCache.set(key, {
      items,
      triggerContext,
      timestamp: Date.now(),
    });

    return { items, cached: false };
  }

  /**
   * Get or compute definition
   */
  async getDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    compute: () => Promise<vscode.Location[]>
  ): Promise<{ locations: vscode.Location[]; cached: boolean }> {
    const key = this.positionKey(document.uri.fsPath, position);
    const wordRange = document.getWordRangeAtPosition(position);
    const word = wordRange ? document.getText(wordRange) : "";
    const contentHash = this.hashContent(`${document.uri.fsPath}:${word}`);

    const cached = this.definitionCache.get(key);

    if (
      cached &&
      cached.contentHash === contentHash &&
      Date.now() - cached.timestamp < this.TTL.definitions
    ) {
      return { locations: cached.data, cached: true };
    }

    const locations = await compute();

    this.definitionCache.set(key, {
      data: locations,
      timestamp: Date.now(),
      contentHash,
      hitCount: 0,
    });

    return { locations, cached: false };
  }

  /**
   * Get or compute hover info
   */
  async getHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    compute: () => Promise<vscode.Hover | null>
  ): Promise<{ hover: vscode.Hover | null; cached: boolean }> {
    const key = this.positionKey(document.uri.fsPath, position);
    const wordRange = document.getWordRangeAtPosition(position);
    const word = wordRange ? document.getText(wordRange) : "";
    const contentHash = this.hashContent(`${document.uri.fsPath}:${word}`);

    const cached = this.hoverCache.get(key);

    if (
      cached &&
      cached.contentHash === contentHash &&
      Date.now() - cached.timestamp < this.TTL.hover
    ) {
      return { hover: cached.data, cached: true };
    }

    const hover = await compute();

    if (hover) {
      this.hoverCache.set(key, {
        data: hover,
        timestamp: Date.now(),
        contentHash,
        hitCount: 0,
      });
    }

    return { hover, cached: false };
  }

  /**
   * Invalidate all caches for a file
   */
  invalidateFile(filePath: string): void {
    this.stats.invalidations++;

    // Clear file-specific caches
    this.diagnosticsCache.delete(filePath);
    this.symbolsCache.delete(filePath);

    // Clear position-based caches for this file
    for (const key of this.referencesCache.keys()) {
      if (key.startsWith(filePath)) {
        this.referencesCache.delete(key);
      }
    }

    for (const key of this.completionsCache.keys()) {
      if (key.startsWith(filePath)) {
        this.completionsCache.delete(key);
      }
    }

    for (const key of this.definitionCache.keys()) {
      if (key.startsWith(filePath)) {
        this.definitionCache.delete(key);
      }
    }

    for (const key of this.hoverCache.keys()) {
      if (key.startsWith(filePath)) {
        this.hoverCache.delete(key);
      }
    }

    // Also invalidate files that reference this file
    this.invalidateDependents(filePath);
  }

  /**
   * Invalidate caches of files that depend on a changed file
   */
  private invalidateDependents(changedFile: string): void {
    // Check references cache for cross-file dependencies
    for (const [key, cache] of this.referencesCache.entries()) {
      const hasReference = cache.references.some(
        (ref) => ref.uri.fsPath === changedFile
      );
      if (hasReference) {
        this.referencesCache.delete(key);
      }
    }
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.diagnosticsCache.clear();
    this.symbolsCache.clear();
    this.referencesCache.clear();
    this.completionsCache.clear();
    this.definitionCache.clear();
    this.hoverCache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & { hitRates: Record<string, number> } {
    const calcRate = (hits: number, misses: number) =>
      hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0;

    return {
      ...this.stats,
      hitRates: {
        diagnostics: calcRate(this.stats.diagnosticsHits, this.stats.diagnosticsMisses),
        symbols: calcRate(this.stats.symbolsHits, this.stats.symbolsMisses),
        references: calcRate(this.stats.referencesHits, this.stats.referencesMisses),
        completions: calcRate(this.stats.completionsHits, this.stats.completionsMisses),
      },
    };
  }

  /**
   * Get cache sizes
   */
  getCacheSizes(): Record<string, number> {
    return {
      diagnostics: this.diagnosticsCache.size,
      symbols: this.symbolsCache.size,
      references: this.referencesCache.size,
      completions: this.completionsCache.size,
      definitions: this.definitionCache.size,
      hover: this.hoverCache.size,
    };
  }

  /**
   * Prefetch common data for open files
   */
  async prefetch(): Promise<void> {
    const openDocs = vscode.workspace.textDocuments.filter(
      (doc) => doc.uri.scheme === "file"
    );

    for (const doc of openDocs.slice(0, 10)) {
      // Prefetch symbols
      try {
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          "vscode.executeDocumentSymbolProvider",
          doc.uri
        );
        if (symbols) {
          this.symbolsCache.set(doc.uri.fsPath, {
            symbols,
            contentHash: this.hashContent(doc.getText()),
            timestamp: Date.now(),
          });
        }
      } catch {
        // Ignore errors during prefetch
      }
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.fileWatcher.dispose();
    this.documentChangeDisposable.dispose();
    this.clearAll();
  }
}

// Singleton instance
let instance: LSPCache | null = null;

export function getLSPCache(): LSPCache {
  if (!instance) {
    instance = new LSPCache();
  }
  return instance;
}

