/**
 * Privacy Mode
 * 
 * Cursor sends telemetry and may use your code for training.
 * We give you full control over your data.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

interface PrivacyConfig {
  telemetryEnabled: boolean;
  sendCrashReports: boolean;
  allowCodeSharing: boolean;
  localOnlyMode: boolean;
  redactSecrets: boolean;
  excludePatterns: string[];
}

interface DataExport {
  conversations: Array<{ timestamp: number; messages: any[] }>;
  settings: Record<string, any>;
  memories: any[];
  rules: any[];
  costHistory: any[];
}

export class PrivacyMode {
  private config: PrivacyConfig = {
    telemetryEnabled: false,
    sendCrashReports: false,
    allowCodeSharing: false,
    localOnlyMode: false,
    redactSecrets: true,
    excludePatterns: [
      "*.env*",
      "*.key",
      "*.pem",
      "*.secret*",
      "*password*",
      "*credential*",
      "*.pfx",
      "*.p12",
    ],
  };

  // Patterns to redact
  private readonly SECRET_PATTERNS = [
    /(?:api[_-]?key|apikey)['":\s]*['"]?([a-zA-Z0-9_-]{20,})/gi,
    /(?:secret|token|password|passwd|pwd)['":\s]*['"]?([a-zA-Z0-9_-]{8,})/gi,
    /(?:aws[_-]?(?:access|secret)[_-]?(?:key)?[_-]?(?:id)?)['":\s]*['"]?([A-Z0-9]{16,})/gi,
    /(?:gh[ps]_[a-zA-Z0-9]{36})/g, // GitHub tokens
    /(?:sk-[a-zA-Z0-9]{48})/g, // OpenAI keys
    /(?:sk-ant-[a-zA-Z0-9-]{95})/g, // Anthropic keys
    /(?:Bearer\s+)[a-zA-Z0-9_-]+/gi,
    /(?:-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----)/g,
  ];

  /**
   * Redact secrets from text
   */
  redactSecrets(text: string): string {
    if (!this.config.redactSecrets) return text;

    let redacted = text;
    for (const pattern of this.SECRET_PATTERNS) {
      redacted = redacted.replace(pattern, (match) => {
        // Keep first 4 chars, redact rest
        if (match.length > 8) {
          return match.slice(0, 4) + "[REDACTED]";
        }
        return "[REDACTED]";
      });
    }
    return redacted;
  }

  /**
   * Check if file should be excluded
   */
  shouldExcludeFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    
    for (const pattern of this.config.excludePatterns) {
      const regex = new RegExp(
        "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
        "i"
      );
      if (regex.test(fileName)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Sanitize content before sending to API
   */
  sanitize(content: string, filePath?: string): string {
    if (filePath && this.shouldExcludeFile(filePath)) {
      return "[FILE EXCLUDED BY PRIVACY SETTINGS]";
    }
    return this.redactSecrets(content);
  }

  /**
   * Export all user data
   */
  async exportData(): Promise<string> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      throw new Error("No workspace open");
    }

    const claudeCodeDir = path.join(workspaceFolder, ".mythatron");
    const exportData: DataExport = {
      conversations: [],
      settings: {},
      memories: [],
      rules: [],
      costHistory: [],
    };

    // Export conversations
    const historyPath = path.join(claudeCodeDir, "history.json");
    if (fs.existsSync(historyPath)) {
      try {
        exportData.conversations = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
      } catch {}
    }

    // Export memories
    const memoriesPath = path.join(claudeCodeDir, "memories.json");
    if (fs.existsSync(memoriesPath)) {
      try {
        exportData.memories = JSON.parse(fs.readFileSync(memoriesPath, "utf-8"));
      } catch {}
    }

    // Export rules
    const rulesPath = path.join(claudeCodeDir, "rules.json");
    if (fs.existsSync(rulesPath)) {
      try {
        exportData.rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
      } catch {}
    }

    // Export VS Code settings
    const config = vscode.workspace.getConfiguration("claudeCode");
    exportData.settings = {
      provider: config.get("provider"),
      model: config.get("model"),
      smartRouting: config.get("smartRouting"),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Delete all user data
   */
  async deleteAllData(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) return;

    const claudeCodeDir = path.join(workspaceFolder, ".mythatron");
    
    const filesToDelete = [
      "history.json",
      "memories.json",
      "cache.json",
    ];

    for (const file of filesToDelete) {
      const filePath = path.join(claudeCodeDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  /**
   * Configure privacy settings
   */
  configure(config: Partial<PrivacyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current config
   */
  getConfig(): PrivacyConfig {
    return { ...this.config };
  }

  /**
   * Check if we can send data externally
   */
  canSendToCloud(): boolean {
    return !this.config.localOnlyMode;
  }
}

export const privacyMode = new PrivacyMode();

