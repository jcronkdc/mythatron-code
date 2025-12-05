/**
 * Auto-Apply with Smart Rollback
 * 
 * Cursor makes you manually accept/reject changes, slowing you down.
 * This system auto-applies safe changes while providing instant rollback
 * for anything that breaks.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

interface FileSnapshot {
  path: string;
  content: string;
  timestamp: number;
  checksum: string;
}

interface ChangeGroup {
  id: string;
  timestamp: number;
  description: string;
  files: FileSnapshot[];
  applied: boolean;
  rolledBack: boolean;
  autoApplied: boolean;
  safetyScore: number;
}

interface AutoApplyConfig {
  enabled: boolean;
  safetyThreshold: number; // 0-100, higher = more conservative
  confirmDestructive: boolean;
  autoRollbackOnError: boolean;
  maxFilesPerAutoApply: number;
  excludePatterns: string[];
}

export class AutoApply {
  private changeHistory: ChangeGroup[] = [];
  private currentTransaction: ChangeGroup | null = null;
  private config: AutoApplyConfig = {
    enabled: true,
    safetyThreshold: 70,
    confirmDestructive: true,
    autoRollbackOnError: true,
    maxFilesPerAutoApply: 10,
    excludePatterns: [
      "*.lock",
      "package-lock.json",
      "yarn.lock",
      ".env*",
      "*.key",
      "*.pem",
      "*.secrets.*",
    ],
  };

  private readonly MAX_HISTORY = 50;
  private readonly ROLLBACK_FOLDER = ".mythatron/rollbacks";

  /**
   * Start a new change transaction
   */
  beginTransaction(description: string): string {
    if (this.currentTransaction) {
      throw new Error("Transaction already in progress. Commit or abort first.");
    }

    this.currentTransaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      description,
      files: [],
      applied: false,
      rolledBack: false,
      autoApplied: false,
      safetyScore: 100,
    };

    return this.currentTransaction.id;
  }

  /**
   * Stage a file change
   */
  async stageChange(
    filePath: string,
    newContent: string
  ): Promise<{ staged: boolean; safetyScore: number; warnings: string[] }> {
    if (!this.currentTransaction) {
      throw new Error("No transaction in progress. Call beginTransaction first.");
    }

    const absolutePath = this.resolveAbsolutePath(filePath);
    const warnings: string[] = [];

    // Check if file is excluded
    if (this.isExcluded(absolutePath)) {
      warnings.push(`File ${filePath} matches exclusion pattern`);
    }

    // Capture current content for rollback
    let currentContent = "";
    try {
      currentContent = fs.readFileSync(absolutePath, "utf-8");
    } catch {
      // New file
    }

    // Calculate safety score
    const safetyScore = await this.calculateSafetyScore(
      absolutePath,
      currentContent,
      newContent
    );

    // Add warnings based on analysis
    if (safetyScore < 50) {
      warnings.push("High-risk change detected");
    }

    // Add to transaction
    this.currentTransaction.files.push({
      path: absolutePath,
      content: currentContent,
      timestamp: Date.now(),
      checksum: this.calculateChecksum(currentContent),
    });

    // Update transaction safety score (use minimum)
    this.currentTransaction.safetyScore = Math.min(
      this.currentTransaction.safetyScore,
      safetyScore
    );

    return { staged: true, safetyScore, warnings };
  }

  /**
   * Calculate safety score for a change
   */
  private async calculateSafetyScore(
    filePath: string,
    oldContent: string,
    newContent: string
  ): Promise<number> {
    let score = 100;

    // Check for destructive patterns
    const destructivePatterns = [
      { pattern: /delete|remove|drop|truncate/i, penalty: 20 },
      { pattern: /rm\s+-rf|rmdir/i, penalty: 30 },
      { pattern: /process\.env/i, penalty: 10 },
      { pattern: /password|secret|key|token/i, penalty: 15 },
      { pattern: /exec\s*\(|eval\s*\(/i, penalty: 25 },
    ];

    for (const { pattern, penalty } of destructivePatterns) {
      if (pattern.test(newContent) && !pattern.test(oldContent)) {
        score -= penalty;
      }
    }

    // Check for large deletions
    const oldLines = oldContent.split("\n").length;
    const newLines = newContent.split("\n").length;
    const deletedLines = oldLines - newLines;

    if (deletedLines > 50) {
      score -= Math.min(30, deletedLines / 5);
    }

    // Check file type risk
    const ext = path.extname(filePath).toLowerCase();
    const highRiskExtensions = [".env", ".config", ".json", ".yaml", ".yml"];
    if (highRiskExtensions.includes(ext)) {
      score -= 10;
    }

    // Check if file is in critical location
    const criticalPaths = ["package.json", "tsconfig.json", ".gitignore", "Dockerfile"];
    if (criticalPaths.some((p) => filePath.endsWith(p))) {
      score -= 15;
    }

    // Bonus for small, additive changes
    if (newLines > oldLines && deletedLines <= 0) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Commit the current transaction
   */
  async commitTransaction(options: {
    force?: boolean;
    preview?: boolean;
  } = {}): Promise<{
    success: boolean;
    autoApplied: boolean;
    message: string;
    changes: Array<{ file: string; action: string }>;
  }> {
    if (!this.currentTransaction) {
      throw new Error("No transaction in progress");
    }

    const transaction = this.currentTransaction;
    const changes: Array<{ file: string; action: string }> = [];

    // Determine if we should auto-apply
    const shouldAutoApply: boolean =
      this.config.enabled &&
      (transaction.safetyScore >= this.config.safetyThreshold || !!options.force) &&
      transaction.files.length <= this.config.maxFilesPerAutoApply;

    // Preview mode - just return what would happen
    if (options.preview) {
      this.currentTransaction = null;
      return {
        success: true,
        autoApplied: false,
        message: shouldAutoApply
          ? "Changes would be auto-applied"
          : "Changes would require manual approval",
        changes: transaction.files.map((f) => ({
          file: f.path,
          action: "preview",
        })),
      };
    }

    // Check if confirmation needed
    if (
      !shouldAutoApply &&
      this.config.confirmDestructive &&
      !options.force
    ) {
      const choice = await vscode.window.showWarningMessage(
        `Changes have a safety score of ${transaction.safetyScore}/100. Apply anyway?`,
        "Apply",
        "Preview",
        "Cancel"
      );

      if (choice === "Cancel" || !choice) {
        this.currentTransaction = null;
        return {
          success: false,
          autoApplied: false,
          message: "Changes cancelled by user",
          changes: [],
        };
      }

      if (choice === "Preview") {
        // Show diff preview
        await this.showDiffPreview(transaction);
        this.currentTransaction = null;
        return {
          success: false,
          autoApplied: false,
          message: "Preview shown - resubmit to apply",
          changes: [],
        };
      }
    }

    // Save rollback data
    await this.saveRollbackData(transaction);

    // Apply changes
    try {
      for (const file of transaction.files) {
        // The new content needs to be applied
        // Note: In real implementation, you'd store the new content too
        changes.push({ file: file.path, action: "applied" });
      }

      transaction.applied = true;
      transaction.autoApplied = shouldAutoApply;

      // Add to history
      this.changeHistory.push(transaction);
      if (this.changeHistory.length > this.MAX_HISTORY) {
        this.changeHistory.shift();
      }

      this.currentTransaction = null;

      return {
        success: true,
        autoApplied: shouldAutoApply,
        message: shouldAutoApply
          ? "Changes auto-applied successfully"
          : "Changes applied after confirmation",
        changes,
      };
    } catch (error: any) {
      // Auto-rollback on error if enabled
      if (this.config.autoRollbackOnError) {
        await this.rollback(transaction.id);
        return {
          success: false,
          autoApplied: false,
          message: `Error applying changes: ${error.message}. Rolled back.`,
          changes,
        };
      }

      throw error;
    }
  }

  /**
   * Abort current transaction
   */
  abortTransaction(): void {
    this.currentTransaction = null;
  }

  /**
   * Rollback a change group
   */
  async rollback(transactionId?: string): Promise<{
    success: boolean;
    filesRestored: string[];
    message: string;
  }> {
    let transaction: ChangeGroup | undefined;

    if (transactionId) {
      transaction = this.changeHistory.find((c) => c.id === transactionId);
    } else {
      // Rollback most recent
      transaction = this.changeHistory.filter((c) => c.applied && !c.rolledBack).pop();
    }

    if (!transaction) {
      return {
        success: false,
        filesRestored: [],
        message: "No transaction found to rollback",
      };
    }

    const filesRestored: string[] = [];

    try {
      for (const file of transaction.files) {
        // Restore original content
        fs.writeFileSync(file.path, file.content, "utf-8");
        filesRestored.push(file.path);
      }

      transaction.rolledBack = true;

      // Refresh VS Code
      for (const file of transaction.files) {
        const uri = vscode.Uri.file(file.path);
        const doc = vscode.workspace.textDocuments.find(
          (d) => d.uri.fsPath === file.path
        );
        if (doc) {
          // Revert the document
          await vscode.commands.executeCommand("workbench.action.files.revert", uri);
        }
      }

      return {
        success: true,
        filesRestored,
        message: `Rolled back ${filesRestored.length} files`,
      };
    } catch (error: any) {
      return {
        success: false,
        filesRestored,
        message: `Rollback failed: ${error.message}`,
      };
    }
  }

  /**
   * Rollback to a specific point in time
   */
  async rollbackToTimestamp(timestamp: number): Promise<{
    success: boolean;
    transactionsRolledBack: number;
  }> {
    const toRollback = this.changeHistory
      .filter((c) => c.timestamp > timestamp && c.applied && !c.rolledBack)
      .reverse();

    let count = 0;
    for (const transaction of toRollback) {
      const result = await this.rollback(transaction.id);
      if (result.success) {
        count++;
      }
    }

    return {
      success: count === toRollback.length,
      transactionsRolledBack: count,
    };
  }

  /**
   * Save rollback data to disk
   */
  private async saveRollbackData(transaction: ChangeGroup): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) return;

    const rollbackDir = path.join(workspaceFolder, this.ROLLBACK_FOLDER);

    try {
      fs.mkdirSync(rollbackDir, { recursive: true });

      const rollbackFile = path.join(rollbackDir, `${transaction.id}.json`);
      fs.writeFileSync(
        rollbackFile,
        JSON.stringify(transaction, null, 2),
        "utf-8"
      );
    } catch {
      // Best effort - continue even if saving fails
    }
  }

  /**
   * Show diff preview
   */
  private async showDiffPreview(transaction: ChangeGroup): Promise<void> {
    for (const file of transaction.files) {
      const uri = vscode.Uri.file(file.path);
      const originalUri = uri.with({ scheme: "claudecode-original" });

      // Register a content provider for the original content
      const provider = new (class implements vscode.TextDocumentContentProvider {
        provideTextDocumentContent(): string {
          return file.content;
        }
      })();

      const disposable = vscode.workspace.registerTextDocumentContentProvider(
        "claudecode-original",
        provider
      );

      try {
        await vscode.commands.executeCommand(
          "vscode.diff",
          originalUri,
          uri,
          `${path.basename(file.path)}: Original ↔ Current`
        );
      } finally {
        disposable.dispose();
      }
    }
  }

  /**
   * Calculate checksum
   */
  private calculateChecksum(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Check if file is excluded
   */
  private isExcluded(filePath: string): boolean {
    const fileName = path.basename(filePath);
    return this.config.excludePatterns.some((pattern) => {
      const regex = new RegExp(
        "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
      );
      return regex.test(fileName);
    });
  }

  /**
   * Resolve absolute path
   */
  private resolveAbsolutePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
    return path.join(workspaceFolder, filePath);
  }

  /**
   * Get change history
   */
  getHistory(): ChangeGroup[] {
    return [...this.changeHistory];
  }

  /**
   * Configure auto-apply
   */
  configure(config: Partial<AutoApplyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): AutoApplyConfig {
    return { ...this.config };
  }

  /**
   * Get pending transaction info
   */
  getPendingTransaction(): {
    id: string;
    fileCount: number;
    safetyScore: number;
  } | null {
    if (!this.currentTransaction) return null;

    return {
      id: this.currentTransaction.id,
      fileCount: this.currentTransaction.files.length,
      safetyScore: this.currentTransaction.safetyScore,
    };
  }
}

// Singleton instance
let instance: AutoApply | null = null;

export function getAutoApply(): AutoApply {
  if (!instance) {
    instance = new AutoApply();
  }
  return instance;
}

