/**
 * Dependency Analyzer - Analyze and update dependencies
 * Check for updates, security issues, unused deps
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface DependencyInfo {
  name: string;
  currentVersion: string;
  latestVersion?: string;
  wantedVersion?: string;
  type: "dependency" | "devDependency" | "peerDependency";
  hasUpdate: boolean;
  updateType?: "major" | "minor" | "patch";
  isDeprecated?: boolean;
  vulnerabilities?: number;
}

export interface DependencyReport {
  dependencies: DependencyInfo[];
  outdated: number;
  deprecated: number;
  vulnerable: number;
  unused: string[];
}

/**
 * Analyze dependencies in package.json
 */
export async function analyzeDependencies(
  workspaceRoot: string
): Promise<DependencyReport> {
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error("No package.json found");
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  const dependencies: DependencyInfo[] = [];

  // Collect all dependencies
  const allDeps: Array<{ name: string; version: string; type: DependencyInfo["type"] }> = [];

  for (const [name, version] of Object.entries(packageJson.dependencies || {})) {
    allDeps.push({ name, version: version as string, type: "dependency" });
  }

  for (const [name, version] of Object.entries(packageJson.devDependencies || {})) {
    allDeps.push({ name, version: version as string, type: "devDependency" });
  }

  for (const [name, version] of Object.entries(packageJson.peerDependencies || {})) {
    allDeps.push({ name, version: version as string, type: "peerDependency" });
  }

  // Check for outdated packages
  let outdatedInfo: Record<string, { current: string; wanted: string; latest: string }> = {};
  try {
    const { stdout } = await execAsync("npm outdated --json", {
      cwd: workspaceRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    outdatedInfo = JSON.parse(stdout || "{}");
  } catch {
    // npm outdated returns exit code 1 if there are outdated packages
    try {
      const { stdout } = await execAsync("npm outdated --json 2>/dev/null || true", {
        cwd: workspaceRoot,
        maxBuffer: 10 * 1024 * 1024,
      });
      if (stdout) {
        outdatedInfo = JSON.parse(stdout);
      }
    } catch {
      // Ignore
    }
  }

  // Build dependency info
  for (const dep of allDeps) {
    const outdated = outdatedInfo[dep.name];
    const cleanVersion = dep.version.replace(/[\^~]/g, "");
    
    const info: DependencyInfo = {
      name: dep.name,
      currentVersion: cleanVersion,
      type: dep.type,
      hasUpdate: !!outdated,
    };

    if (outdated) {
      info.latestVersion = outdated.latest;
      info.wantedVersion = outdated.wanted;
      info.updateType = determineUpdateType(cleanVersion, outdated.latest);
    }

    dependencies.push(info);
  }

  // Find unused dependencies (simple heuristic)
  const unused: string[] = [];
  const srcFiles = await collectSourceFiles(workspaceRoot);
  const allContent = srcFiles.map((f) => {
    try {
      return fs.readFileSync(f, "utf-8");
    } catch {
      return "";
    }
  }).join("\n");

  for (const dep of dependencies) {
    if (dep.type === "devDependency") continue; // Skip dev deps
    
    // Check if package is imported/required anywhere
    const importRegex = new RegExp(
      `(from\\s+['"]${dep.name}|require\\(['"]${dep.name})`,
      "g"
    );
    
    if (!importRegex.test(allContent)) {
      unused.push(dep.name);
    }
  }

  return {
    dependencies,
    outdated: dependencies.filter((d) => d.hasUpdate).length,
    deprecated: dependencies.filter((d) => d.isDeprecated).length,
    vulnerable: dependencies.filter((d) => (d.vulnerabilities || 0) > 0).length,
    unused,
  };
}

/**
 * Determine update type (major/minor/patch)
 */
function determineUpdateType(
  current: string,
  latest: string
): "major" | "minor" | "patch" {
  const [currentMajor, currentMinor] = current.split(".").map(Number);
  const [latestMajor, latestMinor] = latest.split(".").map(Number);

  if (latestMajor > currentMajor) return "major";
  if (latestMinor > currentMinor) return "minor";
  return "patch";
}

/**
 * Collect source files
 */
async function collectSourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
  const ignoreDirs = new Set(["node_modules", ".git", "dist", "build"]);

  function walk(currentDir: string): void {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!ignoreDirs.has(entry.name) && !entry.name.startsWith(".")) {
            walk(path.join(currentDir, entry.name));
          }
        } else if (extensions.has(path.extname(entry.name))) {
          files.push(path.join(currentDir, entry.name));
        }
      }
    } catch {
      // Skip
    }
  }

  walk(dir);
  return files;
}

/**
 * Update a dependency
 */
export async function updateDependency(
  workspaceRoot: string,
  name: string,
  version: string
): Promise<void> {
  await execAsync(`npm install ${name}@${version}`, { cwd: workspaceRoot });
}

/**
 * Update all dependencies
 */
export async function updateAllDependencies(
  workspaceRoot: string,
  type: "all" | "patch" | "minor"
): Promise<string[]> {
  const report = await analyzeDependencies(workspaceRoot);
  const updated: string[] = [];

  for (const dep of report.dependencies) {
    if (!dep.hasUpdate || !dep.latestVersion) continue;

    if (type === "all") {
      await updateDependency(workspaceRoot, dep.name, dep.latestVersion);
      updated.push(dep.name);
    } else if (type === "minor" && dep.updateType !== "major") {
      await updateDependency(workspaceRoot, dep.name, dep.wantedVersion || dep.latestVersion);
      updated.push(dep.name);
    } else if (type === "patch" && dep.updateType === "patch") {
      await updateDependency(workspaceRoot, dep.name, dep.wantedVersion || dep.latestVersion);
      updated.push(dep.name);
    }
  }

  return updated;
}

/**
 * Show dependency report
 */
export async function showDependencyReport(workspaceRoot: string): Promise<void> {
  const report = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Analyzing dependencies...",
    },
    () => analyzeDependencies(workspaceRoot)
  );

  const panel = vscode.window.createWebviewPanel(
    "depsReport",
    "Dependency Report",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = generateDepsReportHTML(report);
}

function generateDepsReportHTML(report: DependencyReport): string {
  const rows = report.dependencies
    .sort((a, b) => (a.hasUpdate ? -1 : 1))
    .map(
      (dep) => `
      <tr class="${dep.hasUpdate ? "outdated" : ""}">
        <td>${dep.name}</td>
        <td>${dep.currentVersion}</td>
        <td>${dep.latestVersion || "-"}</td>
        <td>${dep.updateType || "-"}</td>
        <td>${dep.type}</td>
      </tr>
    `
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #333; }
    th { background: #252526; }
    .outdated { background: rgba(255, 200, 0, 0.1); }
    .stats { display: flex; gap: 20px; }
    .stat { padding: 15px; background: #252526; border-radius: 8px; }
    .stat-value { font-size: 24px; font-weight: bold; }
    .unused { color: #f48771; }
  </style>
</head>
<body>
  <h1>Dependency Report</h1>
  <div class="stats">
    <div class="stat">
      <div class="stat-value">${report.dependencies.length}</div>
      <div>Total</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color: #dcdcaa">${report.outdated}</div>
      <div>Outdated</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color: #f48771">${report.unused.length}</div>
      <div>Unused</div>
    </div>
  </div>
  
  ${report.unused.length > 0 ? `
    <h2>Potentially Unused</h2>
    <p class="unused">${report.unused.join(", ")}</p>
  ` : ""}
  
  <table>
    <tr><th>Package</th><th>Current</th><th>Latest</th><th>Update</th><th>Type</th></tr>
    ${rows}
  </table>
</body>
</html>`;
}

