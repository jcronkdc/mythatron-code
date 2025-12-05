/**
 * Preflight Check System
 * 
 * Catches problems BEFORE they pile up:
 * - TypeScript errors (continuous validation)
 * - Missing dependencies
 * - Environment/API configuration
 * - Auth issues
 * - Integration sanity checks
 * 
 * Philosophy: Fix as you go, not at the end
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface PreflightResult {
  category: string;
  status: "pass" | "warn" | "fail";
  message: string;
  fix?: string;
  autoFixable?: boolean;
}

export interface PreflightReport {
  timestamp: Date;
  workspace: string;
  results: PreflightResult[];
  score: number; // 0-100
  canProceed: boolean;
}

/**
 * Run all preflight checks
 */
export async function runPreflightChecks(
  workspacePath: string
): Promise<PreflightReport> {
  const results: PreflightResult[] = [];

  // Run all checks in parallel for speed
  const checks = await Promise.all([
    checkTypeScript(workspacePath),
    checkDependencies(workspacePath),
    checkEnvironment(workspacePath),
    checkGitStatus(workspacePath),
    checkAPIKeys(workspacePath),
    checkLintErrors(workspacePath),
  ]);

  results.push(...checks.flat());

  // Calculate score
  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const warnings = results.filter((r) => r.status === "warn").length;
  const score = Math.round(((passed + warnings * 0.5) / total) * 100);

  // Can proceed if no failures
  const canProceed = !results.some((r) => r.status === "fail");

  return {
    timestamp: new Date(),
    workspace: workspacePath,
    results,
    score,
    canProceed,
  };
}

/**
 * TypeScript compilation check
 */
async function checkTypeScript(workspacePath: string): Promise<PreflightResult[]> {
  const results: PreflightResult[] = [];
  const tsconfigPath = path.join(workspacePath, "tsconfig.json");

  if (!fs.existsSync(tsconfigPath)) {
    // Check if it's a TS project
    const hasTS = fs.readdirSync(workspacePath).some(
      (f) => f.endsWith(".ts") || f.endsWith(".tsx")
    );

    if (hasTS) {
      results.push({
        category: "TypeScript",
        status: "warn",
        message: "TypeScript files found but no tsconfig.json",
        fix: "npx tsc --init",
        autoFixable: true,
      });
    }
    return results;
  }

  try {
    // Run tsc --noEmit to check for errors without building
    await execAsync("npx tsc --noEmit 2>&1", {
      cwd: workspacePath,
      timeout: 30000,
    });

    results.push({
      category: "TypeScript",
      status: "pass",
      message: "No TypeScript errors",
    });
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error);
    
    // Parse error count
    const errorMatch = output.match(/Found (\d+) errors?/);
    const errorCount = errorMatch ? parseInt(errorMatch[1]) : "multiple";

    // Extract first few errors for context
    const errorLines = output
      .split("\n")
      .filter((line) => line.includes("error TS"))
      .slice(0, 3);

    results.push({
      category: "TypeScript",
      status: "fail",
      message: `${errorCount} TypeScript error(s) found`,
      fix: errorLines.join("\n"),
    });
  }

  return results;
}

/**
 * Check dependencies are installed
 */
async function checkDependencies(workspacePath: string): Promise<PreflightResult[]> {
  const results: PreflightResult[] = [];
  const packagePath = path.join(workspacePath, "package.json");

  if (!fs.existsSync(packagePath)) {
    return results; // Not a Node project
  }

  const nodeModules = path.join(workspacePath, "node_modules");

  if (!fs.existsSync(nodeModules)) {
    results.push({
      category: "Dependencies",
      status: "fail",
      message: "node_modules not found",
      fix: "npm install",
      autoFixable: true,
    });
    return results;
  }

  // Check for missing dependencies
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const missing: string[] = [];

    for (const dep of Object.keys(deps)) {
      const depPath = path.join(nodeModules, dep);
      if (!fs.existsSync(depPath)) {
        missing.push(dep);
      }
    }

    if (missing.length > 0) {
      results.push({
        category: "Dependencies",
        status: "fail",
        message: `Missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "..." : ""}`,
        fix: "npm install",
        autoFixable: true,
      });
    } else {
      results.push({
        category: "Dependencies",
        status: "pass",
        message: "All dependencies installed",
      });
    }
  } catch {
    results.push({
      category: "Dependencies",
      status: "warn",
      message: "Could not verify dependencies",
    });
  }

  return results;
}

/**
 * Check environment configuration
 */
async function checkEnvironment(workspacePath: string): Promise<PreflightResult[]> {
  const results: PreflightResult[] = [];

  // Check for .env.example but no .env
  const envExample = path.join(workspacePath, ".env.example");
  const envFile = path.join(workspacePath, ".env");

  if (fs.existsSync(envExample) && !fs.existsSync(envFile)) {
    results.push({
      category: "Environment",
      status: "fail",
      message: ".env.example exists but .env is missing",
      fix: "cp .env.example .env && # fill in values",
      autoFixable: false,
    });
  } else if (fs.existsSync(envExample) && fs.existsSync(envFile)) {
    // Check if all example vars are in .env
    try {
      const exampleVars = parseEnvFile(fs.readFileSync(envExample, "utf-8"));
      const envVars = parseEnvFile(fs.readFileSync(envFile, "utf-8"));

      const missing = exampleVars.filter((v) => !envVars.includes(v));

      if (missing.length > 0) {
        results.push({
          category: "Environment",
          status: "warn",
          message: `Missing env vars: ${missing.join(", ")}`,
          fix: "Add missing variables to .env",
        });
      } else {
        results.push({
          category: "Environment",
          status: "pass",
          message: "Environment configured",
        });
      }
    } catch {
      // Ignore parse errors
    }
  }

  return results;
}

function parseEnvFile(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => line.split("=")[0].trim());
}

/**
 * Check Git status for uncommitted changes
 */
async function checkGitStatus(workspacePath: string): Promise<PreflightResult[]> {
  const results: PreflightResult[] = [];

  try {
    const { stdout } = await execAsync("git status --porcelain", {
      cwd: workspacePath,
    });

    if (stdout.trim()) {
      const lines = stdout.trim().split("\n").length;
      results.push({
        category: "Git",
        status: "warn",
        message: `${lines} uncommitted change(s)`,
        fix: "git add -A && git commit -m 'checkpoint'",
        autoFixable: true,
      });
    } else {
      results.push({
        category: "Git",
        status: "pass",
        message: "Working tree clean",
      });
    }
  } catch {
    // Not a git repo, that's fine
  }

  return results;
}

/**
 * Check for common API key issues
 */
async function checkAPIKeys(workspacePath: string): Promise<PreflightResult[]> {
  const results: PreflightResult[] = [];
  const config = vscode.workspace.getConfiguration("claudeCode");

  // Check required API keys based on provider setting
  const provider = config.get<string>("provider", "anthropic");

  const keyChecks: Record<string, { setting: string; env: string }> = {
    anthropic: { setting: "apiKey", env: "ANTHROPIC_API_KEY" },
    openai: { setting: "openaiApiKey", env: "OPENAI_API_KEY" },
    groq: { setting: "groqApiKey", env: "GROQ_API_KEY" },
  };

  const check = keyChecks[provider];
  if (check) {
    const hasKey = config.get<string>(check.setting) || process.env[check.env];

    if (!hasKey) {
      results.push({
        category: "API Keys",
        status: "fail",
        message: `${provider} API key not configured`,
        fix: `Set mythaTron.${check.setting} in settings or ${check.env} env var`,
      });
    } else {
      results.push({
        category: "API Keys",
        status: "pass",
        message: `${provider} API key configured`,
      });
    }
  }

  // Ollama check
  if (provider === "ollama") {
    try {
      await execAsync("curl -s http://localhost:11434/api/tags", { timeout: 5000 });
      results.push({
        category: "API Keys",
        status: "pass",
        message: "Ollama server running",
      });
    } catch {
      results.push({
        category: "API Keys",
        status: "fail",
        message: "Ollama server not running",
        fix: "ollama serve",
        autoFixable: true,
      });
    }
  }

  return results;
}

/**
 * Check for lint errors (ESLint)
 */
async function checkLintErrors(workspacePath: string): Promise<PreflightResult[]> {
  const results: PreflightResult[] = [];
  const eslintConfig = [
    ".eslintrc.js",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".eslintrc",
    "eslint.config.js",
  ].some((f) => fs.existsSync(path.join(workspacePath, f)));

  if (!eslintConfig) {
    return results; // No ESLint configured
  }

  try {
    await execAsync("npx eslint . --max-warnings 0 2>&1", {
      cwd: workspacePath,
      timeout: 30000,
    });

    results.push({
      category: "Lint",
      status: "pass",
      message: "No lint errors",
    });
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error);
    const errorMatch = output.match(/(\d+) errors?/);
    const warnMatch = output.match(/(\d+) warnings?/);

    const errors = errorMatch ? parseInt(errorMatch[1]) : 0;
    const warnings = warnMatch ? parseInt(warnMatch[1]) : 0;

    if (errors > 0) {
      results.push({
        category: "Lint",
        status: "fail",
        message: `${errors} lint error(s), ${warnings} warning(s)`,
        fix: "npx eslint . --fix",
        autoFixable: true,
      });
    } else if (warnings > 0) {
      results.push({
        category: "Lint",
        status: "warn",
        message: `${warnings} lint warning(s)`,
        fix: "npx eslint . --fix",
        autoFixable: true,
      });
    }
  }

  return results;
}

/**
 * Auto-fix issues that can be fixed
 */
export async function autoFixIssues(
  workspacePath: string,
  results: PreflightResult[]
): Promise<{ fixed: string[]; failed: string[] }> {
  const fixed: string[] = [];
  const failed: string[] = [];

  const fixable = results.filter((r) => r.autoFixable && r.fix);

  for (const issue of fixable) {
    try {
      await execAsync(issue.fix!, { cwd: workspacePath, timeout: 60000 });
      fixed.push(issue.category);
    } catch {
      failed.push(issue.category);
    }
  }

  return { fixed, failed };
}

/**
 * Show preflight report in VS Code
 */
export async function showPreflightReport(): Promise<void> {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) {
    vscode.window.showErrorMessage("Open a workspace first");
    return;
  }

  const report = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Running preflight checks...",
    },
    () => runPreflightChecks(workspacePath)
  );

  // Show results
  const panel = vscode.window.createWebviewPanel(
    "preflightReport",
    "Preflight Check",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = generateReportHTML(report);

  // Handle auto-fix button
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.type === "autofix") {
      const { fixed, failed } = await autoFixIssues(workspacePath, report.results);

      if (fixed.length > 0) {
        vscode.window.showInformationMessage(`Fixed: ${fixed.join(", ")}`);
      }
      if (failed.length > 0) {
        vscode.window.showWarningMessage(`Could not fix: ${failed.join(", ")}`);
      }

      // Refresh report
      const newReport = await runPreflightChecks(workspacePath);
      panel.webview.html = generateReportHTML(newReport);
    }
  });
}

function generateReportHTML(report: PreflightReport): string {
  const statusIcon = (status: string) => {
    switch (status) {
      case "pass": return "✅";
      case "warn": return "⚠️";
      case "fail": return "❌";
      default: return "•";
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "pass": return "#3fb950";
      case "warn": return "#d29922";
      case "fail": return "#f85149";
      default: return "#8b949e";
    }
  };

  const rows = report.results
    .map((r) => `
      <tr>
        <td>${statusIcon(r.status)}</td>
        <td><strong>${r.category}</strong></td>
        <td style="color: ${statusColor(r.status)}">${r.message}</td>
        <td>${r.fix ? `<code>${r.fix}</code>` : "-"}</td>
      </tr>
    `)
    .join("");

  const scoreColor = report.score >= 80 ? "#3fb950" : report.score >= 50 ? "#d29922" : "#f85149";
  const hasFixable = report.results.some((r) => r.autoFixable);

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: #0d1117;
      color: #c9d1d9;
    }
    h1 { color: #58a6ff; margin-bottom: 5px; }
    .score {
      font-size: 48px;
      font-weight: bold;
      color: ${scoreColor};
      margin: 20px 0;
    }
    .status {
      padding: 8px 16px;
      border-radius: 20px;
      display: inline-block;
      margin-bottom: 20px;
      font-weight: bold;
    }
    .status.pass { background: rgba(63, 185, 80, 0.2); color: #3fb950; }
    .status.fail { background: rgba(248, 81, 73, 0.2); color: #f85149; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; font-weight: 600; }
    code {
      background: #161b22;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
    }
    .btn {
      padding: 10px 20px;
      background: #238636;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      margin-top: 20px;
    }
    .btn:hover { background: #2ea043; }
    .btn:disabled { background: #21262d; cursor: not-allowed; }
  </style>
</head>
<body>
  <h1>🚀 Preflight Check</h1>
  <p style="color: #8b949e;">Last run: ${report.timestamp.toLocaleString()}</p>
  
  <div class="score">${report.score}%</div>
  
  <div class="status ${report.canProceed ? 'pass' : 'fail'}">
    ${report.canProceed ? '✓ Ready to proceed' : '✗ Issues need attention'}
  </div>

  <table>
    <tr><th></th><th>Check</th><th>Status</th><th>Fix</th></tr>
    ${rows}
  </table>

  ${hasFixable ? '<button class="btn" onclick="autoFix()">🔧 Auto-fix Issues</button>' : ''}

  <script>
    const vscode = acquireVsCodeApi();
    function autoFix() {
      vscode.postMessage({ type: 'autofix' });
    }
  </script>
</body>
</html>`;
}

/**
 * Quick check - returns true if ready to proceed
 */
export async function quickPreflightCheck(workspacePath: string): Promise<boolean> {
  const report = await runPreflightChecks(workspacePath);

  if (!report.canProceed) {
    const failures = report.results
      .filter((r) => r.status === "fail")
      .map((r) => `${r.category}: ${r.message}`)
      .join("\n");

    vscode.window.showWarningMessage(
      `Preflight check failed:\n${failures}`,
      "Show Details",
      "Ignore"
    ).then((choice) => {
      if (choice === "Show Details") {
        showPreflightReport();
      }
    });

    return false;
  }

  return true;
}
