/**
 * Smart Context Manager
 * 
 * Cursor forces re-reading files constantly, inflating token counts.
 * This manager intelligently caches file contents and only includes
 * what's actually needed, minimizing context window usage.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

interface FileCache {
  content: string;
  hash: string;
  lastModified: number;
  tokenCount: number;
  summary?: string;
  imports?: string[];
  exports?: string[];
  functions?: string[];
  classes?: string[];
}

interface ContextConfig {
  maxTokens: number;
  prioritizeOpenFiles: boolean;
  includeSummariesOnly: boolean;
  smartTruncation: boolean;
}

export class ContextManager {
  private fileCache: Map<string, FileCache> = new Map();
  private fileWatchers: Map<string, vscode.FileSystemWatcher> = new Map();
  private recentlyAccessed: string[] = [];
  private readonly MAX_RECENT = 50;
  private readonly CHUNK_SIZE = 500; // lines per chunk

  private config: ContextConfig = {
    maxTokens: 100000,
    prioritizeOpenFiles: true,
    includeSummariesOnly: false,
    smartTruncation: true,
  };

  constructor() {
    // Watch for file changes
    this.setupFileWatchers();
  }

  /**
   * Set up file system watchers to invalidate cache
   */
  private setupFileWatchers(): void {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");

    watcher.onDidChange((uri) => {
      this.invalidateFile(uri.fsPath);
    });

    watcher.onDidDelete((uri) => {
      this.fileCache.delete(uri.fsPath);
      this.fileWatchers.get(uri.fsPath)?.dispose();
      this.fileWatchers.delete(uri.fsPath);
    });
  }

  /**
   * Invalidate a file's cache
   */
  private invalidateFile(filePath: string): void {
    this.fileCache.delete(filePath);
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters for English text
    // Code tends to have more tokens per character
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Generate content hash
   */
  private hashContent(content: string): string {
    return crypto.createHash("md5").update(content).digest("hex");
  }

  /**
   * Extract file structure (imports, exports, functions, classes)
   */
  private extractStructure(content: string, language: string): Partial<FileCache> {
    const lines = content.split("\n");
    const imports: string[] = [];
    const exports: string[] = [];
    const functions: string[] = [];
    const classes: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // Imports
      if (trimmed.startsWith("import ") || trimmed.startsWith("from ")) {
        imports.push(trimmed);
      }

      // Exports
      if (trimmed.startsWith("export ")) {
        const match = trimmed.match(/export\s+(default\s+)?(function|class|const|let|var|interface|type)\s+(\w+)/);
        if (match) {
          exports.push(match[3]);
        }
      }

      // Functions
      const funcMatch = trimmed.match(/^(async\s+)?function\s+(\w+)|^(export\s+)?(async\s+)?(\w+)\s*[=:]\s*(async\s+)?\(|^(async\s+)?(\w+)\s*\(/);
      if (funcMatch) {
        const name = funcMatch[2] || funcMatch[5] || funcMatch[8];
        if (name && !["if", "for", "while", "switch", "catch"].includes(name)) {
          functions.push(name);
        }
      }

      // Classes
      const classMatch = trimmed.match(/^(export\s+)?(abstract\s+)?class\s+(\w+)/);
      if (classMatch) {
        classes.push(classMatch[3]);
      }
    }

    return { imports, exports, functions, classes };
  }

  /**
   * Generate a concise summary of a file
   */
  private generateSummary(content: string, structure: Partial<FileCache>): string {
    const lines = content.split("\n");
    const parts: string[] = [];

    // File stats
    parts.push(`// ${lines.length} lines`);

    // Imports summary
    if (structure.imports && structure.imports.length > 0) {
      parts.push(`// Imports: ${structure.imports.length} modules`);
    }

    // Exports
    if (structure.exports && structure.exports.length > 0) {
      parts.push(`// Exports: ${structure.exports.join(", ")}`);
    }

    // Functions
    if (structure.functions && structure.functions.length > 0) {
      parts.push(`// Functions: ${structure.functions.join(", ")}`);
    }

    // Classes
    if (structure.classes && structure.classes.length > 0) {
      parts.push(`// Classes: ${structure.classes.join(", ")}`);
    }

    return parts.join("\n");
  }

  /**
   * Get file content with intelligent caching
   */
  async getFile(filePath: string, options: {
    fullContent?: boolean;
    lines?: { start: number; end: number };
    summaryOnly?: boolean;
  } = {}): Promise<{ content: string; tokenCount: number; fromCache: boolean }> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "", filePath);

    // Check cache
    let cached = this.fileCache.get(absolutePath);
    let fromCache = false;

    if (cached) {
      // Verify file hasn't changed
      try {
        const stats = fs.statSync(absolutePath);
        if (stats.mtimeMs <= cached.lastModified) {
          fromCache = true;
        } else {
          // File changed, invalidate cache
          this.invalidateFile(absolutePath);
          cached = undefined;
        }
      } catch {
        // File might not exist
      }
    }

    // Load and cache file if needed
    if (!cached) {
      try {
        const content = fs.readFileSync(absolutePath, "utf-8");
        const hash = this.hashContent(content);
        const ext = path.extname(absolutePath);
        const language = this.getLanguage(ext);
        const structure = this.extractStructure(content, language);
        const summary = this.generateSummary(content, structure);

        cached = {
          content,
          hash,
          lastModified: Date.now(),
          tokenCount: this.estimateTokens(content),
          summary,
          ...structure,
        };

        this.fileCache.set(absolutePath, cached);
      } catch (error) {
        return {
          content: `// Error reading file: ${error}`,
          tokenCount: 10,
          fromCache: false,
        };
      }
    }

    // Update recently accessed
    this.recentlyAccessed = this.recentlyAccessed.filter((p) => p !== absolutePath);
    this.recentlyAccessed.unshift(absolutePath);
    if (this.recentlyAccessed.length > this.MAX_RECENT) {
      this.recentlyAccessed.pop();
    }

    // Return appropriate content
    if (options.summaryOnly) {
      return {
        content: cached.summary || "",
        tokenCount: this.estimateTokens(cached.summary || ""),
        fromCache,
      };
    }

    if (options.lines) {
      const lines = cached.content.split("\n");
      const start = Math.max(0, options.lines.start - 1);
      const end = Math.min(lines.length, options.lines.end);
      const slice = lines.slice(start, end).join("\n");
      return {
        content: slice,
        tokenCount: this.estimateTokens(slice),
        fromCache,
      };
    }

    return {
      content: cached.content,
      tokenCount: cached.tokenCount,
      fromCache,
    };
  }

  /**
   * Get language from file extension
   */
  private getLanguage(ext: string): string {
    const langMap: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".js": "javascript",
      ".jsx": "javascript",
      ".py": "python",
      ".rb": "ruby",
      ".go": "go",
      ".rs": "rust",
      ".java": "java",
      ".cs": "csharp",
      ".cpp": "cpp",
      ".c": "c",
      ".h": "c",
      ".hpp": "cpp",
    };
    return langMap[ext] || "text";
  }

  /**
   * Build optimized context for a request
   */
  async buildContext(options: {
    query: string;
    relevantFiles?: string[];
    maxTokens?: number;
    includeOpenFiles?: boolean;
  }): Promise<{ context: string; tokenCount: number; filesIncluded: string[] }> {
    const maxTokens = options.maxTokens || this.config.maxTokens;
    let currentTokens = 0;
    const contextParts: string[] = [];
    const filesIncluded: string[] = [];

    // Priority 1: Explicitly relevant files (full content or smart truncation)
    if (options.relevantFiles) {
      for (const file of options.relevantFiles) {
        if (currentTokens >= maxTokens) break;

        // First, get full content to check size
        const { content: fullContent, tokenCount: fullTokenCount } = await this.getFile(file);
        
        // If it would exceed limit, try summary instead
        if (currentTokens + fullTokenCount > maxTokens && this.config.smartTruncation) {
          const { content: summaryContent, tokenCount: summaryTokenCount } = await this.getFile(file, {
            summaryOnly: true,
          });
          if (currentTokens + summaryTokenCount <= maxTokens) {
            contextParts.push(`// File: ${file}\n${summaryContent}`);
            currentTokens += summaryTokenCount;
            filesIncluded.push(file);
          }
        } else if (currentTokens + fullTokenCount <= maxTokens) {
          contextParts.push(`// File: ${file}\n${fullContent}`);
          currentTokens += fullTokenCount;
          filesIncluded.push(file);
        }
      }
    }

    // Priority 2: Currently open files
    if (options.includeOpenFiles && this.config.prioritizeOpenFiles) {
      const openFiles = vscode.window.visibleTextEditors.map((e) => e.document.uri.fsPath);

      for (const file of openFiles) {
        if (filesIncluded.includes(file)) continue;
        if (currentTokens >= maxTokens) break;

        const remainingTokens = maxTokens - currentTokens;
        const { content, tokenCount } = await this.getFile(file, {
          summaryOnly: remainingTokens < 1000,
        });

        if (tokenCount <= remainingTokens) {
          contextParts.push(`// Open File: ${file}\n${content}`);
          currentTokens += tokenCount;
          filesIncluded.push(file);
        }
      }
    }

    // Priority 3: Recently accessed files (summaries only)
    if (currentTokens < maxTokens * 0.9) {
      for (const file of this.recentlyAccessed.slice(0, 10)) {
        if (filesIncluded.includes(file)) continue;
        if (currentTokens >= maxTokens) break;

        const { content, tokenCount } = await this.getFile(file, { summaryOnly: true });

        if (currentTokens + tokenCount <= maxTokens) {
          contextParts.push(`// Recent: ${file}\n${content}`);
          currentTokens += tokenCount;
          filesIncluded.push(file);
        }
      }
    }

    return {
      context: contextParts.join("\n\n"),
      tokenCount: currentTokens,
      filesIncluded,
    };
  }

  /**
   * Get smart diff - only changed portions
   */
  async getSmartDiff(filePath: string, newContent: string): Promise<{
    diff: string;
    changedLines: { start: number; end: number }[];
    tokenCount: number;
  }> {
    const { content: oldContent } = await this.getFile(filePath);
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");

    const changedLines: { start: number; end: number }[] = [];
    const diffParts: string[] = [];

    let i = 0;
    let j = 0;
    let changeStart = -1;

    while (i < oldLines.length || j < newLines.length) {
      if (oldLines[i] === newLines[j]) {
        if (changeStart !== -1) {
          changedLines.push({ start: changeStart + 1, end: i });
          changeStart = -1;
        }
        i++;
        j++;
      } else {
        if (changeStart === -1) {
          changeStart = i;
        }

        if (i < oldLines.length) {
          diffParts.push(`- ${i + 1}: ${oldLines[i]}`);
          i++;
        }
        if (j < newLines.length) {
          diffParts.push(`+ ${j + 1}: ${newLines[j]}`);
          j++;
        }
      }
    }

    if (changeStart !== -1) {
      changedLines.push({ start: changeStart + 1, end: Math.max(oldLines.length, newLines.length) });
    }

    const diff = diffParts.join("\n");
    return {
      diff,
      changedLines,
      tokenCount: this.estimateTokens(diff),
    };
  }

  /**
   * Prefetch files likely to be needed
   */
  async prefetch(patterns: string[]): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return;

    for (const pattern of patterns) {
      const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**", 50);
      for (const file of files) {
        // Load into cache in background
        this.getFile(file.fsPath).catch(() => {});
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    cachedFiles: number;
    totalTokensCached: number;
    recentFiles: string[];
  } {
    let totalTokens = 0;
    for (const cached of this.fileCache.values()) {
      totalTokens += cached.tokenCount;
    }

    return {
      cachedFiles: this.fileCache.size,
      totalTokensCached: totalTokens,
      recentFiles: this.recentlyAccessed.slice(0, 10),
    };
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.fileCache.clear();
    this.recentlyAccessed = [];
  }

  /**
   * Configure context manager
   */
  configure(config: Partial<ContextConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Singleton instance
let instance: ContextManager | null = null;

export function getContextManager(): ContextManager {
  if (!instance) {
    instance = new ContextManager();
  }
  return instance;
}

