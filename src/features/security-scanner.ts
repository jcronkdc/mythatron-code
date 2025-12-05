/**
 * Security Scanner - Find security vulnerabilities
 * OWASP Top 10, secrets detection, dependency vulnerabilities
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface SecurityIssue {
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  title: string;
  description: string;
  file: string;
  line?: number;
  code?: string;
  recommendation: string;
  cwe?: string; // Common Weakness Enumeration
}

export interface SecurityReport {
  issues: SecurityIssue[];
  scannedFiles: number;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

// Security patterns to detect
const SECURITY_PATTERNS: Array<{
  pattern: RegExp;
  severity: SecurityIssue["severity"];
  category: string;
  title: string;
  description: string;
  recommendation: string;
  cwe?: string;
}> = [
  // Secrets detection
  {
    pattern: /['"]?(?:api[_-]?key|apikey)['"]?\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/gi,
    severity: "critical",
    category: "Secrets",
    title: "Hardcoded API Key",
    description: "API key is hardcoded in source code",
    recommendation: "Use environment variables or a secrets manager",
    cwe: "CWE-798",
  },
  {
    pattern: /['"]?(?:password|passwd|pwd)['"]?\s*[:=]\s*['"][^'"]{4,}['"]/gi,
    severity: "critical",
    category: "Secrets",
    title: "Hardcoded Password",
    description: "Password is hardcoded in source code",
    recommendation: "Use environment variables or a secrets manager",
    cwe: "CWE-798",
  },
  {
    pattern: /['"]?(?:secret|token)['"]?\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/gi,
    severity: "critical",
    category: "Secrets",
    title: "Hardcoded Secret/Token",
    description: "Secret or token is hardcoded in source code",
    recommendation: "Use environment variables or a secrets manager",
    cwe: "CWE-798",
  },
  {
    pattern: /-----BEGIN (?:RSA )?PRIVATE KEY-----/g,
    severity: "critical",
    category: "Secrets",
    title: "Private Key in Code",
    description: "Private key is embedded in source code",
    recommendation: "Store private keys in secure key management systems",
    cwe: "CWE-321",
  },
  {
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    severity: "critical",
    category: "Secrets",
    title: "GitHub Personal Access Token",
    description: "GitHub PAT detected in source code",
    recommendation: "Rotate the token immediately and use environment variables",
    cwe: "CWE-798",
  },

  // SQL Injection
  {
    pattern: /(?:query|execute|exec)\s*\([^)]*\+[^)]*\)/gi,
    severity: "high",
    category: "Injection",
    title: "Potential SQL Injection",
    description: "String concatenation in SQL query",
    recommendation: "Use parameterized queries or prepared statements",
    cwe: "CWE-89",
  },
  {
    pattern: /\$\{[^}]+\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/gi,
    severity: "high",
    category: "Injection",
    title: "SQL Injection via Template Literal",
    description: "User input may be interpolated into SQL query",
    recommendation: "Use parameterized queries",
    cwe: "CWE-89",
  },

  // XSS
  {
    pattern: /innerHTML\s*=\s*[^;]+/g,
    severity: "medium",
    category: "XSS",
    title: "Potential XSS via innerHTML",
    description: "Direct HTML injection without sanitization",
    recommendation: "Use textContent or sanitize input before injection",
    cwe: "CWE-79",
  },
  {
    pattern: /dangerouslySetInnerHTML/g,
    severity: "medium",
    category: "XSS",
    title: "React dangerouslySetInnerHTML",
    description: "Using dangerouslySetInnerHTML can lead to XSS",
    recommendation: "Sanitize content with DOMPurify before use",
    cwe: "CWE-79",
  },
  {
    pattern: /document\.write\s*\(/g,
    severity: "medium",
    category: "XSS",
    title: "document.write Usage",
    description: "document.write can be exploited for XSS",
    recommendation: "Use DOM manipulation methods instead",
    cwe: "CWE-79",
  },

  // Command Injection
  {
    pattern: /(?:exec|spawn|execSync|spawnSync)\s*\([^)]*\+[^)]*\)/g,
    severity: "high",
    category: "Injection",
    title: "Potential Command Injection",
    description: "String concatenation in shell command",
    recommendation: "Use array arguments and avoid shell interpretation",
    cwe: "CWE-78",
  },

  // Insecure practices
  {
    pattern: /eval\s*\(/g,
    severity: "high",
    category: "Insecure",
    title: "Use of eval()",
    description: "eval() can execute arbitrary code",
    recommendation: "Avoid eval() - use JSON.parse() or safer alternatives",
    cwe: "CWE-95",
  },
  {
    pattern: /new\s+Function\s*\(/g,
    severity: "high",
    category: "Insecure",
    title: "Dynamic Function Creation",
    description: "new Function() is similar to eval()",
    recommendation: "Avoid dynamic function creation",
    cwe: "CWE-95",
  },
  {
    pattern: /(?:http:\/\/)/g,
    severity: "low",
    category: "Insecure",
    title: "HTTP URL (Insecure)",
    description: "Using HTTP instead of HTTPS",
    recommendation: "Use HTTPS for all connections",
    cwe: "CWE-319",
  },

  // Crypto issues
  {
    pattern: /MD5|SHA1(?![\d])/gi,
    severity: "medium",
    category: "Crypto",
    title: "Weak Hash Algorithm",
    description: "MD5 and SHA1 are cryptographically broken",
    recommendation: "Use SHA-256 or better",
    cwe: "CWE-328",
  },
  {
    pattern: /Math\.random\(\)/g,
    severity: "medium",
    category: "Crypto",
    title: "Insecure Random",
    description: "Math.random() is not cryptographically secure",
    recommendation: "Use crypto.randomBytes() or crypto.getRandomValues()",
    cwe: "CWE-338",
  },

  // Path traversal
  {
    pattern: /\.\.\//g,
    severity: "medium",
    category: "Path Traversal",
    title: "Path Traversal Pattern",
    description: "../ pattern could indicate path traversal",
    recommendation: "Validate and sanitize file paths",
    cwe: "CWE-22",
  },
];

/**
 * Scan a file for security issues
 */
export function scanFile(
  filePath: string,
  workspaceRoot: string
): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const relativePath = path.relative(workspaceRoot, filePath);

  for (const pattern of SECURITY_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);

    while ((match = regex.exec(content)) !== null) {
      // Find line number
      const beforeMatch = content.slice(0, match.index);
      const lineNumber = beforeMatch.split("\n").length;

      issues.push({
        severity: pattern.severity,
        category: pattern.category,
        title: pattern.title,
        description: pattern.description,
        file: relativePath,
        line: lineNumber,
        code: lines[lineNumber - 1]?.trim().slice(0, 100),
        recommendation: pattern.recommendation,
        cwe: pattern.cwe,
      });
    }
  }

  return issues;
}

/**
 * Scan entire project
 */
export async function scanProject(workspaceRoot: string): Promise<SecurityReport> {
  const issues: SecurityIssue[] = [];
  const files = await collectSourceFiles(workspaceRoot);

  for (const file of files) {
    try {
      const fileIssues = scanFile(file, workspaceRoot);
      issues.push(...fileIssues);
    } catch {
      // Skip files that can't be scanned
    }
  }

  // Check npm audit if package.json exists
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const { stdout } = await execAsync("npm audit --json 2>/dev/null || true", {
        cwd: workspaceRoot,
        maxBuffer: 10 * 1024 * 1024,
      });
      
      if (stdout) {
        const audit = JSON.parse(stdout);
        for (const advisory of Object.values(audit.advisories || {}) as any[]) {
          issues.push({
            severity: advisory.severity as SecurityIssue["severity"],
            category: "Dependency",
            title: advisory.title,
            description: advisory.overview,
            file: "package.json",
            recommendation: advisory.recommendation,
            cwe: advisory.cwe?.[0],
          });
        }
      }
    } catch {
      // npm audit failed
    }
  }

  // Calculate summary
  const summary = {
    critical: issues.filter((i) => i.severity === "critical").length,
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
    info: issues.filter((i) => i.severity === "info").length,
  };

  return {
    issues: issues.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return order[a.severity] - order[b.severity];
    }),
    scannedFiles: files.length,
    summary,
  };
}

/**
 * Collect source files
 */
async function collectSourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rb", ".php"]);
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
 * Show security report
 */
export async function showSecurityReport(workspaceRoot: string): Promise<void> {
  const report = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Scanning for security issues...",
    },
    () => scanProject(workspaceRoot)
  );

  const panel = vscode.window.createWebviewPanel(
    "securityReport",
    "Security Report",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = generateSecurityHTML(report);
}

function generateSecurityHTML(report: SecurityReport): string {
  const issueRows = report.issues
    .map(
      (issue) => `
      <tr class="${issue.severity}">
        <td><span class="severity-badge ${issue.severity}">${issue.severity}</span></td>
        <td>${issue.category}</td>
        <td>
          <strong>${issue.title}</strong>
          <br><small>${issue.description}</small>
          ${issue.code ? `<br><code>${issue.code}</code>` : ""}
        </td>
        <td>${issue.file}${issue.line ? `:${issue.line}` : ""}</td>
        <td>${issue.recommendation}</td>
      </tr>
    `
    )
    .join("");

  const totalIssues = Object.values(report.summary).reduce((a, b) => a + b, 0);

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
    .summary { display: flex; gap: 15px; margin-bottom: 30px; }
    .summary-card {
      padding: 20px;
      background: #252526;
      border-radius: 12px;
      text-align: center;
      flex: 1;
    }
    .summary-value { font-size: 36px; font-weight: bold; }
    .summary-value.critical { color: #dc3545; }
    .summary-value.high { color: #fd7e14; }
    .summary-value.medium { color: #ffc107; }
    .summary-value.low { color: #17a2b8; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #333; }
    th { background: #252526; }
    .severity-badge {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
    }
    .severity-badge.critical { background: #dc3545; color: white; }
    .severity-badge.high { background: #fd7e14; color: white; }
    .severity-badge.medium { background: #ffc107; color: black; }
    .severity-badge.low { background: #17a2b8; color: white; }
    .severity-badge.info { background: #6c757d; color: white; }
    code { background: #2d2d2d; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
    small { color: #888; }
  </style>
</head>
<body>
  <h1>🔒 Security Report</h1>
  <p>Scanned ${report.scannedFiles} files, found ${totalIssues} issues</p>

  <div class="summary">
    <div class="summary-card">
      <div class="summary-value critical">${report.summary.critical}</div>
      <div>Critical</div>
    </div>
    <div class="summary-card">
      <div class="summary-value high">${report.summary.high}</div>
      <div>High</div>
    </div>
    <div class="summary-card">
      <div class="summary-value medium">${report.summary.medium}</div>
      <div>Medium</div>
    </div>
    <div class="summary-card">
      <div class="summary-value low">${report.summary.low}</div>
      <div>Low</div>
    </div>
  </div>

  <table>
    <tr><th>Severity</th><th>Category</th><th>Issue</th><th>Location</th><th>Recommendation</th></tr>
    ${issueRows || "<tr><td colspan='5'>No issues found! 🎉</td></tr>"}
  </table>
</body>
</html>`;
}

