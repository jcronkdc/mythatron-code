/**
 * CLI Integration - Connect to provider CLIs and import configurations
 * Supports: Anthropic, OpenAI, Groq, Ollama, GitHub
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface CLIStatus {
  name: string;
  installed: boolean;
  authenticated: boolean;
  version?: string;
  apiKey?: string;
  error?: string;
}

export interface CLIConfig {
  anthropic?: { apiKey: string; source: string };
  openai?: { apiKey: string; source: string };
  groq?: { apiKey: string; source: string };
  ollama?: { url: string; models: string[] };
  github?: { authenticated: boolean; user?: string };
}

/**
 * Check all CLI statuses
 */
export async function checkAllCLIs(): Promise<CLIStatus[]> {
  const checks = await Promise.all([
    checkAnthropicCLI(),
    checkOpenAICLI(),
    checkGroqCLI(),
    checkOllamaCLI(),
    checkGitHubCLI(),
  ]);

  return checks;
}

/**
 * Check Anthropic CLI / Environment
 */
async function checkAnthropicCLI(): Promise<CLIStatus> {
  const status: CLIStatus = {
    name: "Anthropic",
    installed: false,
    authenticated: false,
  };

  // Check environment variable first
  if (process.env.ANTHROPIC_API_KEY) {
    status.authenticated = true;
    status.apiKey = process.env.ANTHROPIC_API_KEY;
    status.installed = true;
    return status;
  }

  // Check for Claude CLI config
  const configPaths = [
    path.join(os.homedir(), ".anthropic", "config.json"),
    path.join(os.homedir(), ".config", "anthropic", "config.json"),
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (config.api_key) {
          status.installed = true;
          status.authenticated = true;
          status.apiKey = config.api_key;
          return status;
        }
      }
    } catch {
      // Continue checking
    }
  }

  // Check if claude CLI is installed
  try {
    const { stdout } = await execAsync("which claude || where claude 2>/dev/null");
    if (stdout.trim()) {
      status.installed = true;
    }
  } catch {
    // Not installed
  }

  return status;
}

/**
 * Check OpenAI CLI / Environment
 */
async function checkOpenAICLI(): Promise<CLIStatus> {
  const status: CLIStatus = {
    name: "OpenAI",
    installed: false,
    authenticated: false,
  };

  // Check environment variable
  if (process.env.OPENAI_API_KEY) {
    status.authenticated = true;
    status.apiKey = process.env.OPENAI_API_KEY;
    status.installed = true;
    return status;
  }

  // Check for OpenAI config files
  const configPaths = [
    path.join(os.homedir(), ".openai", "config.json"),
    path.join(os.homedir(), ".config", "openai", "credentials"),
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, "utf-8");
        
        // Try JSON format
        try {
          const config = JSON.parse(content);
          if (config.api_key || config.OPENAI_API_KEY) {
            status.installed = true;
            status.authenticated = true;
            status.apiKey = config.api_key || config.OPENAI_API_KEY;
            return status;
          }
        } catch {
          // Try key=value format
          const match = content.match(/(?:api_key|OPENAI_API_KEY)\s*=\s*(.+)/);
          if (match) {
            status.installed = true;
            status.authenticated = true;
            status.apiKey = match[1].trim();
            return status;
          }
        }
      }
    } catch {
      // Continue
    }
  }

  // Check for openai CLI
  try {
    const { stdout } = await execAsync("openai --version 2>/dev/null || echo ''");
    if (stdout.includes("openai")) {
      status.installed = true;
      status.version = stdout.trim();
    }
  } catch {
    // Not installed
  }

  return status;
}

/**
 * Check Groq CLI / Environment
 */
async function checkGroqCLI(): Promise<CLIStatus> {
  const status: CLIStatus = {
    name: "Groq",
    installed: false,
    authenticated: false,
  };

  // Check environment variable
  if (process.env.GROQ_API_KEY) {
    status.authenticated = true;
    status.apiKey = process.env.GROQ_API_KEY;
    status.installed = true;
    return status;
  }

  // Check for Groq config
  const configPath = path.join(os.homedir(), ".groq", "config.json");
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (config.api_key) {
        status.installed = true;
        status.authenticated = true;
        status.apiKey = config.api_key;
        return status;
      }
    }
  } catch {
    // Continue
  }

  return status;
}

/**
 * Check Ollama CLI
 */
async function checkOllamaCLI(): Promise<CLIStatus> {
  const status: CLIStatus = {
    name: "Ollama",
    installed: false,
    authenticated: true, // Ollama doesn't need auth
  };

  try {
    // Check if ollama is installed
    const { stdout: versionOut } = await execAsync("ollama --version 2>/dev/null || echo ''");
    if (versionOut.includes("ollama")) {
      status.installed = true;
      status.version = versionOut.trim();
    }

    // Check if ollama server is running
    const { stdout: listOut } = await execAsync("ollama list 2>/dev/null || echo ''");
    if (listOut && !listOut.includes("error")) {
      status.authenticated = true; // Server is running
    }
  } catch {
    // Not installed or not running
  }

  return status;
}

/**
 * Check GitHub CLI
 */
async function checkGitHubCLI(): Promise<CLIStatus> {
  const status: CLIStatus = {
    name: "GitHub",
    installed: false,
    authenticated: false,
  };

  try {
    // Check if gh is installed
    const { stdout: versionOut } = await execAsync("gh --version 2>/dev/null || echo ''");
    if (versionOut.includes("gh version")) {
      status.installed = true;
      status.version = versionOut.split("\n")[0];
    }

    // Check authentication status
    const { stdout: authOut } = await execAsync("gh auth status 2>&1 || echo ''");
    if (authOut.includes("Logged in")) {
      status.authenticated = true;
      const userMatch = authOut.match(/Logged in to .+ as (\w+)/);
      if (userMatch) {
        status.apiKey = userMatch[1]; // Store username
      }
    }
  } catch {
    // Not installed
  }

  return status;
}

/**
 * Import API keys from CLIs into VS Code settings
 */
export async function importCLIConfigs(): Promise<{
  imported: string[];
  errors: string[];
}> {
  const imported: string[] = [];
  const errors: string[] = [];

  const statuses = await checkAllCLIs();
  const config = vscode.workspace.getConfiguration("claudeCode");

  for (const status of statuses) {
    if (status.authenticated && status.apiKey) {
      try {
        switch (status.name) {
          case "Anthropic":
            if (!config.get<string>("apiKey")) {
              await config.update("apiKey", status.apiKey, vscode.ConfigurationTarget.Global);
              imported.push("Anthropic API key");
            }
            break;
          case "OpenAI":
            if (!config.get<string>("openaiApiKey")) {
              await config.update("openaiApiKey", status.apiKey, vscode.ConfigurationTarget.Global);
              imported.push("OpenAI API key");
            }
            break;
          case "Groq":
            if (!config.get<string>("groqApiKey")) {
              await config.update("groqApiKey", status.apiKey, vscode.ConfigurationTarget.Global);
              imported.push("Groq API key");
            }
            break;
        }
      } catch (error) {
        errors.push(`Failed to import ${status.name}: ${error}`);
      }
    }
  }

  return { imported, errors };
}

/**
 * Get available Ollama models
 */
export async function getOllamaModels(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("ollama list 2>/dev/null || echo ''");
    if (!stdout || stdout.includes("error")) {
      return [];
    }

    const lines = stdout.trim().split("\n").slice(1); // Skip header
    return lines
      .map((line) => line.split(/\s+/)[0])
      .filter((name) => name && name.length > 0);
  } catch {
    return [];
  }
}

/**
 * Pull an Ollama model
 */
export async function pullOllamaModel(modelName: string): Promise<boolean> {
  try {
    await execAsync(`ollama pull ${modelName}`, { timeout: 300000 }); // 5 min timeout
    return true;
  } catch {
    return false;
  }
}

/**
 * Show CLI status in VS Code
 */
export async function showCLIStatus(): Promise<void> {
  const statuses = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Checking CLI configurations...",
    },
    () => checkAllCLIs()
  );

  const panel = vscode.window.createWebviewPanel(
    "cliStatus",
    "CLI Status",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = generateCLIStatusHTML(statuses);
}

function generateCLIStatusHTML(statuses: CLIStatus[]): string {
  const rows = statuses
    .map(
      (s) => `
      <tr class="${s.authenticated ? 'authenticated' : ''}">
        <td>${s.name}</td>
        <td>${s.installed ? '✅ Installed' : '❌ Not found'}</td>
        <td>${s.authenticated ? '🔐 Ready' : '⚠️ Not configured'}</td>
        <td>${s.version || '-'}</td>
      </tr>
    `
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
    h1 { color: #58a6ff; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #333; }
    th { background: #252526; color: #58a6ff; }
    .authenticated { background: rgba(63, 185, 80, 0.1); }
    .btn { 
      padding: 10px 20px; 
      background: #58a6ff; 
      color: white; 
      border: none; 
      border-radius: 6px; 
      cursor: pointer;
      margin-top: 20px;
    }
    .btn:hover { background: #79b8ff; }
    .info { margin-top: 20px; padding: 15px; background: #252526; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>🔧 CLI Integration Status</h1>
  
  <table>
    <tr><th>Provider</th><th>CLI Status</th><th>Auth Status</th><th>Version</th></tr>
    ${rows}
  </table>

  <div class="info">
    <h3>Setup Instructions</h3>
    <p><strong>Anthropic:</strong> Set ANTHROPIC_API_KEY environment variable or configure Claude CLI</p>
    <p><strong>OpenAI:</strong> Set OPENAI_API_KEY environment variable or run <code>openai configure</code></p>
    <p><strong>Groq:</strong> Set GROQ_API_KEY environment variable</p>
    <p><strong>Ollama:</strong> Install from <a href="https://ollama.ai">ollama.ai</a> and run <code>ollama serve</code></p>
    <p><strong>GitHub:</strong> Run <code>gh auth login</code> to authenticate</p>
  </div>

  <button class="btn" onclick="importConfigs()">Import Keys from CLIs</button>

  <script>
    const vscode = acquireVsCodeApi();
    function importConfigs() {
      vscode.postMessage({ type: 'import' });
    }
  </script>
</body>
</html>`;
}

/**
 * Setup wizard for new users
 */
export async function runSetupWizard(): Promise<void> {
  const statuses = await checkAllCLIs();
  
  // Check what's missing
  const anthropic = statuses.find((s) => s.name === "Anthropic");
  const ollama = statuses.find((s) => s.name === "Ollama");

  const steps: string[] = [];

  if (!anthropic?.authenticated) {
    steps.push("Set up Anthropic API key");
  }

  if (!ollama?.installed) {
    steps.push("Install Ollama for free local models");
  }

  if (steps.length === 0) {
    vscode.window.showInformationMessage("✅ MythaTron Code is fully configured!");
    return;
  }

  const result = await vscode.window.showInformationMessage(
    `MythaTron Code needs: ${steps.join(", ")}`,
    "Configure Now",
    "Skip"
  );

  if (result === "Configure Now") {
    // Open settings
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "mythaTron.apiKey"
    );
  }
}

// Export singleton functions
export { checkAllCLIs as getCLIStatuses };

// Re-export GitHub functions
export {
  checkGitHubAuth,
  createGitHubRepo,
  createRepoInteractive,
  quickPush,
  pushToGitHub,
  listRepos,
  cloneRepo,
} from "./github";
