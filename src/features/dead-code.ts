/**
 * Dead Code Detection - Find unused code
 * Identifies unused exports, functions, variables, imports
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface DeadCodeItem {
  type: "export" | "function" | "variable" | "import" | "class" | "type";
  name: string;
  file: string;
  line: number;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface DeadCodeReport {
  items: DeadCodeItem[];
  filesAnalyzed: number;
  potentialSavings: {
    lines: number;
    bytes: number;
  };
}

/**
 * Analyze workspace for dead code
 */
export async function analyzeDeadCode(
  workspaceRoot: string,
  options: {
    includeTests?: boolean;
    maxFiles?: number;
  } = {}
): Promise<DeadCodeReport> {
  const items: DeadCodeItem[] = [];
  const exports = new Map<string, { file: string; line: number; used: boolean }>();
  const imports = new Map<string, { file: string; line: number; from: string; used: boolean }>();
  
  // Collect all exports and imports
  const files = await collectTypeScriptFiles(workspaceRoot, options.maxFiles || 500);
  
  for (const file of files) {
    if (!options.includeTests && (file.includes(".test.") || file.includes(".spec."))) {
      continue;
    }
    
    try {
      const content = fs.readFileSync(file, "utf-8");
      const relativePath = path.relative(workspaceRoot, file);
      
      // Find exports
      const exportMatches = content.matchAll(
        /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g
      );
      for (const match of exportMatches) {
        const key = `${relativePath}:${match[1]}`;
        exports.set(key, {
          file: relativePath,
          line: getLineNumber(content, match.index!),
          used: false,
        });
      }
      
      // Find named exports
      const namedExportMatches = content.matchAll(/export\s*\{\s*([^}]+)\s*\}/g);
      for (const match of namedExportMatches) {
        const names = match[1].split(",").map((n) => n.trim().split(" as ")[0].trim());
        for (const name of names) {
          const key = `${relativePath}:${name}`;
          exports.set(key, {
            file: relativePath,
            line: getLineNumber(content, match.index!),
            used: false,
          });
        }
      }
      
      // Find imports
      const importMatches = content.matchAll(
        /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g
      );
      for (const match of importMatches) {
        const importPath = match[3];
        if (match[1]) {
          // Named imports
          const names = match[1].split(",").map((n) => n.trim().split(" as ")[0].trim());
          for (const name of names) {
            const key = `${relativePath}:import:${name}`;
            imports.set(key, {
              file: relativePath,
              line: getLineNumber(content, match.index!),
              from: importPath,
              used: false,
            });
          }
        }
        if (match[2]) {
          // Default import
          const key = `${relativePath}:import:${match[2]}`;
          imports.set(key, {
            file: relativePath,
            line: getLineNumber(content, match.index!),
            from: importPath,
            used: false,
          });
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }
  
  // Check usage of exports across files
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      
      // Check if exports are imported elsewhere
      for (const [key, exp] of exports) {
        const name = key.split(":")[1];
        // Check for import or usage
        const usageRegex = new RegExp(`\\b${name}\\b`, "g");
        const matches = content.match(usageRegex);
        if (matches && matches.length > 0) {
          if (file !== path.join(workspaceRoot, exp.file)) {
            exp.used = true;
          }
        }
      }
      
      // Check if imports are used in the file
      const relativePath = path.relative(workspaceRoot, file);
      for (const [key, imp] of imports) {
        if (!key.startsWith(relativePath + ":import:")) continue;
        const name = key.split(":import:")[1];
        
        // Count occurrences (first is the import itself)
        const regex = new RegExp(`\\b${name}\\b`, "g");
        const matches = content.match(regex);
        if (matches && matches.length > 1) {
          imp.used = true;
        }
      }
    } catch {
      // Skip
    }
  }
  
  // Report unused exports
  for (const [key, exp] of exports) {
    if (!exp.used) {
      const name = key.split(":")[1];
      items.push({
        type: "export",
        name,
        file: exp.file,
        line: exp.line,
        confidence: "medium",
        reason: "Export not imported in any other file",
      });
    }
  }
  
  // Report unused imports
  for (const [key, imp] of imports) {
    if (!imp.used) {
      const name = key.split(":import:")[1];
      items.push({
        type: "import",
        name,
        file: imp.file,
        line: imp.line,
        confidence: "high",
        reason: `Imported from "${imp.from}" but never used`,
      });
    }
  }
  
  // Calculate potential savings
  let savedLines = 0;
  let savedBytes = 0;
  for (const item of items) {
    savedLines += 1;
    savedBytes += item.name.length + 20; // Rough estimate
  }
  
  return {
    items,
    filesAnalyzed: files.length,
    potentialSavings: {
      lines: savedLines,
      bytes: savedBytes,
    },
  };
}

/**
 * Get line number from string index
 */
function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

/**
 * Collect TypeScript/JavaScript files
 */
async function collectTypeScriptFiles(
  dir: string,
  maxFiles: number
): Promise<string[]> {
  const files: string[] = [];
  const extensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
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
 * Show dead code report
 */
export async function showDeadCodeReport(workspaceRoot: string): Promise<void> {
  const report = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Analyzing for dead code...",
      cancellable: true,
    },
    async (progress, token) => {
      return analyzeDeadCode(workspaceRoot);
    }
  );
  
  if (report.items.length === 0) {
    vscode.window.showInformationMessage("No dead code found!");
    return;
  }
  
  const panel = vscode.window.createWebviewPanel(
    "deadCodeReport",
    "Dead Code Report",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  
  panel.webview.html = generateReportHTML(report);
}

function generateReportHTML(report: DeadCodeReport): string {
  const rows = report.items
    .map(
      (item) => `
      <tr>
        <td>${item.type}</td>
        <td><code>${item.name}</code></td>
        <td>${item.file}:${item.line}</td>
        <td>${item.confidence}</td>
        <td>${item.reason}</td>
      </tr>
    `
    )
    .join("");
  
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #333; }
    th { background: #252526; }
    code { background: #2d2d2d; padding: 2px 6px; border-radius: 3px; }
    .stats { margin-bottom: 20px; padding: 15px; background: #252526; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Dead Code Report</h1>
  <div class="stats">
    <p>Files analyzed: ${report.filesAnalyzed}</p>
    <p>Issues found: ${report.items.length}</p>
    <p>Potential savings: ${report.potentialSavings.lines} lines (~${Math.round(report.potentialSavings.bytes / 1024)}KB)</p>
  </div>
  <table>
    <tr><th>Type</th><th>Name</th><th>Location</th><th>Confidence</th><th>Reason</th></tr>
    ${rows}
  </table>
</body>
</html>`;
}

