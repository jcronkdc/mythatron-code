/**
 * Code Metrics - Analyze code complexity and quality
 * Cyclomatic complexity, lines of code, maintainability index
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface FileMetrics {
  file: string;
  relativePath: string;
  loc: number; // Lines of code
  sloc: number; // Source lines (non-blank, non-comment)
  comments: number;
  blanks: number;
  functions: number;
  classes: number;
  complexity: number; // Cyclomatic complexity
  maintainability: number; // Maintainability index (0-100)
  avgFunctionLength: number;
  maxFunctionLength: number;
}

export interface ProjectMetrics {
  totalFiles: number;
  totalLoc: number;
  totalSloc: number;
  avgComplexity: number;
  avgMaintainability: number;
  byLanguage: Record<string, { files: number; sloc: number }>;
  hotspots: FileMetrics[]; // Files that need attention
}

/**
 * Calculate metrics for a single file
 */
export function calculateFileMetrics(
  filePath: string,
  workspaceRoot: string
): FileMetrics {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const ext = path.extname(filePath);

  let loc = lines.length;
  let blanks = 0;
  let comments = 0;
  let inBlockComment = false;

  // Count blanks and comments
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "") {
      blanks++;
      continue;
    }

    // Block comments
    if (trimmed.startsWith("/*") || trimmed.startsWith("/**")) {
      inBlockComment = true;
    }
    if (inBlockComment) {
      comments++;
      if (trimmed.endsWith("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    // Line comments
    if (trimmed.startsWith("//") || trimmed.startsWith("#")) {
      comments++;
    }
  }

  const sloc = loc - blanks - comments;

  // Count functions and classes
  const functionMatches = content.match(
    /\b(function|const\s+\w+\s*=\s*(?:async\s*)?\(|(?:async\s+)?(?:get|set)?\s*\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{|def\s+\w+|fn\s+\w+)/g
  );
  const classMatches = content.match(/\b(class|struct|interface|enum)\s+\w+/g);

  const functions = functionMatches?.length || 0;
  const classes = classMatches?.length || 0;

  // Calculate cyclomatic complexity
  const complexity = calculateCyclomaticComplexity(content, ext);

  // Calculate average and max function length
  const functionLengths = extractFunctionLengths(content, ext);
  const avgFunctionLength =
    functionLengths.length > 0
      ? functionLengths.reduce((a, b) => a + b, 0) / functionLengths.length
      : 0;
  const maxFunctionLength =
    functionLengths.length > 0 ? Math.max(...functionLengths) : 0;

  // Calculate maintainability index
  // MI = 171 - 5.2 * ln(HV) - 0.23 * CC - 16.2 * ln(LOC)
  // Simplified version
  const maintainability = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        171 - 5.2 * Math.log(Math.max(sloc, 1)) - 0.23 * complexity - 16.2 * Math.log(Math.max(sloc, 1))
      ) / 1.71
    )
  );

  return {
    file: filePath,
    relativePath: path.relative(workspaceRoot, filePath),
    loc,
    sloc,
    comments,
    blanks,
    functions,
    classes,
    complexity,
    maintainability,
    avgFunctionLength: Math.round(avgFunctionLength),
    maxFunctionLength,
  };
}

/**
 * Calculate cyclomatic complexity
 */
function calculateCyclomaticComplexity(content: string, ext: string): number {
  // Count decision points
  const decisionPoints = [
    /\bif\b/g,
    /\belse\s+if\b/g,
    /\bfor\b/g,
    /\bwhile\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /\b\?\s*[^:]/g, // Ternary
    /&&/g,
    /\|\|/g,
  ];

  let complexity = 1; // Base complexity

  for (const pattern of decisionPoints) {
    const matches = content.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  return complexity;
}

/**
 * Extract function lengths
 */
function extractFunctionLengths(content: string, ext: string): number[] {
  const lengths: number[] = [];
  const lines = content.split("\n");

  let inFunction = false;
  let braceCount = 0;
  let functionStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect function start
    if (
      !inFunction &&
      (line.match(/\bfunction\b/) ||
        line.match(/=>\s*\{/) ||
        line.match(/\w+\s*\([^)]*\)\s*\{/))
    ) {
      inFunction = true;
      functionStart = i;
      braceCount = 0;
    }

    if (inFunction) {
      for (const char of line) {
        if (char === "{") braceCount++;
        if (char === "}") braceCount--;
      }

      if (braceCount <= 0 && i > functionStart) {
        lengths.push(i - functionStart + 1);
        inFunction = false;
      }
    }
  }

  return lengths;
}

/**
 * Analyze entire project
 */
export async function analyzeProject(
  workspaceRoot: string,
  maxFiles = 500
): Promise<ProjectMetrics> {
  const files = await collectSourceFiles(workspaceRoot, maxFiles);
  const fileMetrics: FileMetrics[] = [];
  const byLanguage: Record<string, { files: number; sloc: number }> = {};

  for (const file of files) {
    try {
      const metrics = calculateFileMetrics(file, workspaceRoot);
      fileMetrics.push(metrics);

      const ext = path.extname(file);
      if (!byLanguage[ext]) {
        byLanguage[ext] = { files: 0, sloc: 0 };
      }
      byLanguage[ext].files++;
      byLanguage[ext].sloc += metrics.sloc;
    } catch {
      // Skip files that can't be analyzed
    }
  }

  const totalLoc = fileMetrics.reduce((sum, m) => sum + m.loc, 0);
  const totalSloc = fileMetrics.reduce((sum, m) => sum + m.sloc, 0);
  const avgComplexity =
    fileMetrics.length > 0
      ? fileMetrics.reduce((sum, m) => sum + m.complexity, 0) / fileMetrics.length
      : 0;
  const avgMaintainability =
    fileMetrics.length > 0
      ? fileMetrics.reduce((sum, m) => sum + m.maintainability, 0) / fileMetrics.length
      : 0;

  // Find hotspots (high complexity, low maintainability)
  const hotspots = fileMetrics
    .filter((m) => m.complexity > 20 || m.maintainability < 50 || m.maxFunctionLength > 100)
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, 10);

  return {
    totalFiles: fileMetrics.length,
    totalLoc,
    totalSloc,
    avgComplexity: Math.round(avgComplexity * 10) / 10,
    avgMaintainability: Math.round(avgMaintainability),
    byLanguage,
    hotspots,
  };
}

/**
 * Collect source files
 */
async function collectSourceFiles(dir: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs"]);
  const ignoreDirs = new Set(["node_modules", ".git", "dist", "build", ".next"]);

  function walk(currentDir: string): void {
    if (files.length >= maxFiles) return;

    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= maxFiles) return;

        if (entry.isDirectory()) {
          if (!ignoreDirs.has(entry.name) && !entry.name.startsWith(".")) {
            walk(path.join(currentDir, entry.name));
          }
        } else if (extensions.has(path.extname(entry.name))) {
          files.push(path.join(currentDir, entry.name));
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  walk(dir);
  return files;
}

/**
 * Show metrics panel
 */
export async function showMetricsPanel(workspaceRoot: string): Promise<void> {
  const metrics = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Analyzing code metrics...",
    },
    () => analyzeProject(workspaceRoot)
  );

  const panel = vscode.window.createWebviewPanel(
    "codeMetrics",
    "Code Metrics",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = generateMetricsHTML(metrics);
}

function generateMetricsHTML(metrics: ProjectMetrics): string {
  const languageRows = Object.entries(metrics.byLanguage)
    .sort((a, b) => b[1].sloc - a[1].sloc)
    .map(
      ([ext, data]) => `
      <tr>
        <td>${ext}</td>
        <td>${data.files}</td>
        <td>${data.sloc.toLocaleString()}</td>
      </tr>
    `
    )
    .join("");

  const hotspotRows = metrics.hotspots
    .map(
      (m) => `
      <tr>
        <td>${m.relativePath}</td>
        <td>${m.complexity}</td>
        <td>${m.maintainability}</td>
        <td>${m.maxFunctionLength}</td>
      </tr>
    `
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { 
      font-family: system-ui; 
      padding: 20px; 
      background: #1e1e1e; 
      color: #d4d4d4; 
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin-bottom: 30px;
    }
    .stat {
      padding: 20px;
      background: #252526;
      border-radius: 12px;
      text-align: center;
    }
    .stat-value {
      font-size: 36px;
      font-weight: bold;
      color: #6366f1;
    }
    .stat-label {
      color: #888;
      margin-top: 5px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #333;
    }
    th { background: #252526; }
    h2 { margin-top: 30px; }
    .warning { color: #ffc107; }
  </style>
</head>
<body>
  <h1>Code Metrics</h1>
  
  <div class="stats">
    <div class="stat">
      <div class="stat-value">${metrics.totalFiles}</div>
      <div class="stat-label">Files</div>
    </div>
    <div class="stat">
      <div class="stat-value">${metrics.totalSloc.toLocaleString()}</div>
      <div class="stat-label">Lines of Code</div>
    </div>
    <div class="stat">
      <div class="stat-value">${metrics.avgComplexity}</div>
      <div class="stat-label">Avg Complexity</div>
    </div>
    <div class="stat">
      <div class="stat-value">${metrics.avgMaintainability}%</div>
      <div class="stat-label">Maintainability</div>
    </div>
  </div>

  <h2>By Language</h2>
  <table>
    <tr><th>Extension</th><th>Files</th><th>Lines</th></tr>
    ${languageRows}
  </table>

  <h2 class="warning">⚠️ Hotspots (Need Attention)</h2>
  <table>
    <tr><th>File</th><th>Complexity</th><th>Maintainability</th><th>Max Function</th></tr>
    ${hotspotRows || "<tr><td colspan='4'>No hotspots found!</td></tr>"}
  </table>
</body>
</html>`;
}

