/**
 * Codebase Indexer - Builds understanding of your project
 * Creates a searchable index of files, symbols, and structure
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import ignore from "ignore";

export interface FileInfo {
  path: string;
  relativePath: string;
  language: string;
  size: number;
  lastModified: Date;
  symbols?: SymbolInfo[];
}

export interface SymbolInfo {
  name: string;
  kind: string;
  line: number;
  container?: string;
}

export interface CodebaseIndex {
  workspaceRoot: string;
  files: FileInfo[];
  totalFiles: number;
  totalLines: number;
  languages: Record<string, number>;
  lastIndexed: Date;
}

export class CodebaseIndexer {
  private workspaceRoot: string;
  private index: CodebaseIndex | null = null;
  private gitignore: ReturnType<typeof ignore> | null = null;
  private indexing = false;

  // File extensions we care about
  private readonly CODE_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".pyi",
    ".rs",
    ".go",
    ".java", ".kt", ".scala",
    ".c", ".cpp", ".h", ".hpp", ".cc",
    ".cs",
    ".rb",
    ".php",
    ".swift",
    ".vue", ".svelte",
    ".html", ".css", ".scss", ".less",
    ".json", ".yaml", ".yml", ".toml",
    ".md", ".mdx",
    ".sql",
    ".sh", ".bash", ".zsh",
    ".dockerfile", ".docker-compose.yml",
  ]);

  private readonly IGNORE_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".output",
    "__pycache__",
    ".pytest_cache",
    "venv",
    ".venv",
    "target",
    "coverage",
    ".idea",
    ".vscode",
  ]);

  constructor() {
    this.workspaceRoot =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    this.loadGitignore();
  }

  private loadGitignore(): void {
    try {
      const gitignorePath = path.join(this.workspaceRoot, ".gitignore");
      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, "utf-8");
        this.gitignore = ignore().add(content);
      }
    } catch {
      // Ignore errors
    }
  }

  async buildIndex(onProgress?: (message: string) => void): Promise<CodebaseIndex> {
    if (this.indexing) {
      throw new Error("Indexing already in progress");
    }

    this.indexing = true;
    const files: FileInfo[] = [];
    let totalLines = 0;
    const languages: Record<string, number> = {};

    try {
      onProgress?.("Scanning workspace...");
      await this.scanDirectory(this.workspaceRoot, files, onProgress);

      // Count lines and languages
      for (const file of files) {
        try {
          const content = fs.readFileSync(file.path, "utf-8");
          const lineCount = content.split("\n").length;
          totalLines += lineCount;
          languages[file.language] = (languages[file.language] || 0) + 1;
        } catch {
          // Skip files we can't read
        }
      }

      onProgress?.(`Indexed ${files.length} files`);

      this.index = {
        workspaceRoot: this.workspaceRoot,
        files,
        totalFiles: files.length,
        totalLines,
        languages,
        lastIndexed: new Date(),
      };

      return this.index;
    } finally {
      this.indexing = false;
    }
  }

  private async scanDirectory(
    dir: string,
    files: FileInfo[],
    onProgress?: (message: string) => void,
    depth = 0
  ): Promise<void> {
    if (depth > 10) return; // Max depth

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(this.workspaceRoot, fullPath);

      // Skip ignored directories
      if (entry.isDirectory()) {
        if (this.IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) {
          continue;
        }
        if (this.gitignore?.ignores(relativePath + "/")) {
          continue;
        }
        await this.scanDirectory(fullPath, files, onProgress, depth + 1);
        continue;
      }

      // Skip non-code files
      const ext = path.extname(entry.name).toLowerCase();
      if (!this.CODE_EXTENSIONS.has(ext)) {
        continue;
      }

      // Skip gitignored files
      if (this.gitignore?.ignores(relativePath)) {
        continue;
      }

      try {
        const stats = fs.statSync(fullPath);
        
        // Skip large files (> 1MB)
        if (stats.size > 1024 * 1024) {
          continue;
        }

        const language = this.getLanguage(ext);
        
        files.push({
          path: fullPath,
          relativePath,
          language,
          size: stats.size,
          lastModified: stats.mtime,
        });

        if (files.length % 100 === 0) {
          onProgress?.(`Scanned ${files.length} files...`);
        }
      } catch {
        // Skip files we can't stat
      }
    }
  }

  private getLanguage(ext: string): string {
    const languageMap: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".jsx": "javascriptreact",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".py": "python",
      ".pyi": "python",
      ".rs": "rust",
      ".go": "go",
      ".java": "java",
      ".kt": "kotlin",
      ".scala": "scala",
      ".c": "c",
      ".cpp": "cpp",
      ".h": "c",
      ".hpp": "cpp",
      ".cc": "cpp",
      ".cs": "csharp",
      ".rb": "ruby",
      ".php": "php",
      ".swift": "swift",
      ".vue": "vue",
      ".svelte": "svelte",
      ".html": "html",
      ".css": "css",
      ".scss": "scss",
      ".less": "less",
      ".json": "json",
      ".yaml": "yaml",
      ".yml": "yaml",
      ".toml": "toml",
      ".md": "markdown",
      ".mdx": "mdx",
      ".sql": "sql",
      ".sh": "shellscript",
      ".bash": "shellscript",
      ".zsh": "shellscript",
    };
    return languageMap[ext] || "plaintext";
  }

  getIndex(): CodebaseIndex | null {
    return this.index;
  }

  getSummary(): string {
    if (!this.index) {
      return "Codebase not indexed. Run indexing first.";
    }

    const parts = [
      `Workspace: ${this.index.workspaceRoot}`,
      `Total files: ${this.index.totalFiles}`,
      `Total lines: ${this.index.totalLines.toLocaleString()}`,
      `\nLanguages:`,
    ];

    const sortedLangs = Object.entries(this.index.languages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [lang, count] of sortedLangs) {
      parts.push(`  ${lang}: ${count} files`);
    }

    parts.push(`\nLast indexed: ${this.index.lastIndexed.toLocaleString()}`);

    return parts.join("\n");
  }

  findRelevantFiles(query: string, maxResults = 10): FileInfo[] {
    if (!this.index) return [];

    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    // Score files by relevance
    const scored = this.index.files.map(file => {
      let score = 0;
      const pathLower = file.relativePath.toLowerCase();
      const nameLower = path.basename(file.relativePath).toLowerCase();

      // Exact name match
      if (nameLower === queryLower) score += 100;
      
      // Name contains query
      if (nameLower.includes(queryLower)) score += 50;
      
      // Path contains query
      if (pathLower.includes(queryLower)) score += 20;

      // Word matches
      for (const word of queryWords) {
        if (nameLower.includes(word)) score += 10;
        if (pathLower.includes(word)) score += 5;
      }

      // Prefer certain file types
      if (file.language === "typescript" || file.language === "typescriptreact") {
        score += 5;
      }

      return { file, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(s => s.file);
  }

  getFilesByLanguage(language: string): FileInfo[] {
    if (!this.index) return [];
    return this.index.files.filter(f => f.language === language);
  }

  getRecentlyModified(count = 10): FileInfo[] {
    if (!this.index) return [];
    return [...this.index.files]
      .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
      .slice(0, count);
  }
}


