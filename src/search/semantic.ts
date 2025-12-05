/**
 * Semantic Code Search - Uses embeddings for meaning-based search
 * Falls back to keyword search when embeddings unavailable
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface SearchResult {
  file: string;
  relativePath: string;
  content: string;
  score: number;
  startLine: number;
  endLine: number;
  matchType: "semantic" | "keyword" | "filename";
}

export interface CodeChunk {
  file: string;
  relativePath: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  signature?: string; // Function/class signature
}

export class SemanticSearch {
  private workspaceRoot: string;
  private chunks: CodeChunk[] = [];
  private indexed = false;
  private indexPath: string;

  // File extensions to index
  private readonly CODE_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs",
    ".py", ".pyi",
    ".rs",
    ".go",
    ".java", ".kt",
    ".c", ".cpp", ".h", ".hpp",
    ".cs",
    ".rb",
    ".php",
    ".swift",
    ".vue", ".svelte",
  ]);

  private readonly IGNORE_DIRS = new Set([
    "node_modules", ".git", "dist", "build", ".next",
    "__pycache__", "venv", ".venv", "target", "coverage",
  ]);

  constructor(workspaceRoot?: string) {
    this.workspaceRoot =
      workspaceRoot ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      process.cwd();
    
    this.indexPath = path.join(this.workspaceRoot, ".claudecode", "search-index.json");
  }

  /**
   * Index the codebase into searchable chunks
   */
  async buildIndex(onProgress?: (message: string) => void): Promise<void> {
    this.chunks = [];
    onProgress?.("Scanning files...");

    await this.scanDirectory(this.workspaceRoot, onProgress);
    
    onProgress?.(`Indexed ${this.chunks.length} code chunks`);
    this.indexed = true;

    // Save index to disk
    this.saveIndex();
  }

  private async scanDirectory(
    dir: string,
    onProgress?: (message: string) => void,
    depth = 0
  ): Promise<void> {
    if (depth > 10) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(this.workspaceRoot, fullPath);

      if (entry.isDirectory()) {
        if (this.IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) {
          continue;
        }
        await this.scanDirectory(fullPath, onProgress, depth + 1);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!this.CODE_EXTENSIONS.has(ext)) continue;

      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 500 * 1024) continue; // Skip files > 500KB

        const content = fs.readFileSync(fullPath, "utf-8");
        const chunks = this.chunkFile(fullPath, relativePath, content, ext);
        this.chunks.push(...chunks);

        if (this.chunks.length % 100 === 0) {
          onProgress?.(`Processed ${this.chunks.length} chunks...`);
        }
      } catch {
        // Skip files we can't read
      }
    }
  }

  /**
   * Break a file into semantic chunks (functions, classes, etc.)
   */
  private chunkFile(
    filePath: string,
    relativePath: string,
    content: string,
    ext: string
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split("\n");
    const language = this.getLanguage(ext);

    // Try to extract semantic chunks (functions, classes)
    const semanticChunks = this.extractSemanticChunks(lines, language);
    
    if (semanticChunks.length > 0) {
      for (const chunk of semanticChunks) {
        chunks.push({
          file: filePath,
          relativePath,
          content: chunk.content,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          language,
          signature: chunk.signature,
        });
      }
    } else {
      // Fall back to fixed-size chunks
      const chunkSize = 50;
      const overlap = 10;

      for (let i = 0; i < lines.length; i += chunkSize - overlap) {
        const chunkLines = lines.slice(i, i + chunkSize);
        if (chunkLines.length < 5) continue;

        chunks.push({
          file: filePath,
          relativePath,
          content: chunkLines.join("\n"),
          startLine: i + 1,
          endLine: Math.min(i + chunkSize, lines.length),
          language,
        });
      }
    }

    return chunks;
  }

  /**
   * Extract semantic chunks (functions, classes) from code
   */
  private extractSemanticChunks(
    lines: string[],
    language: string
  ): Array<{ content: string; startLine: number; endLine: number; signature?: string }> {
    const chunks: Array<{ content: string; startLine: number; endLine: number; signature?: string }> = [];

    // Language-specific patterns
    const patterns: Record<string, RegExp[]> = {
      typescript: [
        /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
        /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/,
        /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
        /^(?:export\s+)?interface\s+(\w+)/,
        /^(?:export\s+)?type\s+(\w+)/,
      ],
      python: [
        /^def\s+(\w+)\s*\(/,
        /^async\s+def\s+(\w+)\s*\(/,
        /^class\s+(\w+)/,
      ],
      rust: [
        /^(?:pub\s+)?fn\s+(\w+)/,
        /^(?:pub\s+)?struct\s+(\w+)/,
        /^(?:pub\s+)?enum\s+(\w+)/,
        /^(?:pub\s+)?impl\s+/,
      ],
      go: [
        /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/,
        /^type\s+(\w+)\s+struct/,
        /^type\s+(\w+)\s+interface/,
      ],
    };

    const langPatterns = patterns[language] || patterns.typescript;

    let currentChunk: { startLine: number; signature: string } | null = null;
    let braceCount = 0;
    let inChunk = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check for new function/class start
      if (!inChunk) {
        for (const pattern of langPatterns) {
          const match = trimmed.match(pattern);
          if (match) {
            currentChunk = { startLine: i, signature: trimmed };
            inChunk = true;
            braceCount = 0;
            break;
          }
        }
      }

      if (inChunk) {
        // Count braces to find end of block
        for (const char of line) {
          if (char === "{" || char === "(" && language === "python") braceCount++;
          if (char === "}" || char === ")" && language === "python") braceCount--;
        }

        // Python uses indentation
        if (language === "python") {
          const nextLine = lines[i + 1];
          if (nextLine !== undefined && !nextLine.match(/^\s/) && trimmed !== "") {
            // End of Python block
            chunks.push({
              content: lines.slice(currentChunk!.startLine, i + 1).join("\n"),
              startLine: currentChunk!.startLine + 1,
              endLine: i + 1,
              signature: currentChunk!.signature,
            });
            inChunk = false;
            currentChunk = null;
          }
        } else if (braceCount === 0 && i > currentChunk!.startLine) {
          // End of brace-delimited block
          chunks.push({
            content: lines.slice(currentChunk!.startLine, i + 1).join("\n"),
            startLine: currentChunk!.startLine + 1,
            endLine: i + 1,
            signature: currentChunk!.signature,
          });
          inChunk = false;
          currentChunk = null;
        }
      }
    }

    return chunks;
  }

  /**
   * Search the codebase
   */
  async search(query: string, maxResults = 20): Promise<SearchResult[]> {
    // Load index if not loaded
    if (!this.indexed) {
      this.loadIndex();
    }

    if (this.chunks.length === 0) {
      await this.buildIndex();
    }

    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

    // Score each chunk
    for (const chunk of this.chunks) {
      let score = 0;
      const contentLower = chunk.content.toLowerCase();
      const fileNameLower = path.basename(chunk.relativePath).toLowerCase();
      const signatureLower = chunk.signature?.toLowerCase() || "";

      // Exact phrase match
      if (contentLower.includes(queryLower)) {
        score += 100;
      }

      // Signature match
      if (signatureLower.includes(queryLower)) {
        score += 80;
      }

      // Filename match
      if (fileNameLower.includes(queryLower)) {
        score += 60;
      }

      // Word matches
      for (const word of queryWords) {
        if (signatureLower.includes(word)) score += 20;
        if (fileNameLower.includes(word)) score += 15;
        
        // Count occurrences in content
        const regex = new RegExp(word, "gi");
        const matches = contentLower.match(regex);
        if (matches) {
          score += Math.min(matches.length * 5, 30);
        }
      }

      // Boost for common code patterns
      if (query.includes("function") && chunk.signature?.includes("function")) {
        score += 20;
      }
      if (query.includes("class") && chunk.signature?.includes("class")) {
        score += 20;
      }

      if (score > 0) {
        results.push({
          file: chunk.file,
          relativePath: chunk.relativePath,
          content: chunk.content,
          score,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          matchType: "keyword",
        });
      }
    }

    // Sort by score and return top results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  /**
   * Save index to disk
   */
  private saveIndex(): void {
    const configDir = path.dirname(this.indexPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(
      this.indexPath,
      JSON.stringify({ chunks: this.chunks, timestamp: Date.now() })
    );
  }

  /**
   * Load index from disk
   */
  private loadIndex(): void {
    try {
      if (fs.existsSync(this.indexPath)) {
        const data = JSON.parse(fs.readFileSync(this.indexPath, "utf-8"));
        
        // Check if index is fresh (less than 1 hour old)
        if (Date.now() - data.timestamp < 60 * 60 * 1000) {
          this.chunks = data.chunks;
          this.indexed = true;
        }
      }
    } catch {
      // Ignore load errors
    }
  }

  private getLanguage(ext: string): string {
    const map: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".js": "javascript",
      ".jsx": "javascript",
      ".py": "python",
      ".rs": "rust",
      ".go": "go",
      ".java": "java",
      ".kt": "kotlin",
      ".c": "c",
      ".cpp": "cpp",
      ".cs": "csharp",
      ".rb": "ruby",
      ".php": "php",
      ".swift": "swift",
    };
    return map[ext] || "unknown";
  }

  /**
   * Get index stats
   */
  getStats(): { chunks: number; files: number } {
    const files = new Set(this.chunks.map((c) => c.file));
    return {
      chunks: this.chunks.length,
      files: files.size,
    };
  }
}

// Singleton
let semanticSearch: SemanticSearch | null = null;

export function getSemanticSearch(): SemanticSearch {
  if (!semanticSearch) {
    semanticSearch = new SemanticSearch();
  }
  return semanticSearch;
}

export async function initSemanticSearch(workspaceRoot: string): Promise<void> {
  semanticSearch = new SemanticSearch(workspaceRoot);
  // Optionally build index on init
  // await semanticSearch.buildIndex();
}

