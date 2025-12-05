/**
 * Continuous Validation System
 * 
 * The key insight: Don't let problems accumulate!
 * 
 * This system:
 * 1. Validates after EVERY file save
 * 2. Catches TypeScript errors immediately
 * 3. Warns about breaking changes before they compound
 * 4. Runs "human tests" at key checkpoints
 */

import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface ValidationState {
  lastCheck: Date;
  errors: Map<string, string[]>;
  warnings: Map<string, string[]>;
  score: number;
}

let state: ValidationState = {
  lastCheck: new Date(),
  errors: new Map(),
  warnings: new Map(),
  score: 100,
};

let statusBarItem: vscode.StatusBarItem;
let diagnosticCollection: vscode.DiagnosticCollection;
let debounceTimer: NodeJS.Timeout | null = null;

/**
 * Initialize continuous validation
 */
export function initContinuousValidation(context: vscode.ExtensionContext): void {
  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = "claudeCode.showPreflightReport";
  updateStatusBar();
  statusBarItem.show();

  // Create diagnostic collection
  diagnosticCollection = vscode.languages.createDiagnosticCollection("claudeCode");

  // Watch for file saves
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      onFileSave(doc);
    })
  );

  // Watch for file changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      // Debounce to avoid excessive checks
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        onFileChange(e.document);
      }, 1000);
    })
  );

  // Watch for active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        checkCurrentFile(editor.document);
      }
    })
  );

  // Initial check
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspacePath) {
    runBackgroundTypeCheck(workspacePath);
  }

  context.subscriptions.push(statusBarItem, diagnosticCollection);
}

/**
 * Handle file save - run validation
 */
async function onFileSave(document: vscode.TextDocument): Promise<void> {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) return;

  const ext = path.extname(document.fileName);

  // TypeScript/JavaScript - run type check
  if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
    await runBackgroundTypeCheck(workspacePath);
  }

  // Package.json changed - check dependencies
  if (document.fileName.endsWith("package.json")) {
    await checkDependencies(workspacePath);
  }

  updateStatusBar();
}

/**
 * Handle file change (debounced)
 */
async function onFileChange(document: vscode.TextDocument): Promise<void> {
  // Quick syntax check for current file
  checkCurrentFile(document);
}

/**
 * Run TypeScript check in background
 */
async function runBackgroundTypeCheck(workspacePath: string): Promise<void> {
  try {
    statusBarItem.text = "$(sync~spin) Checking...";

    const { stderr } = await execAsync(
      "npx tsc --noEmit --pretty false 2>&1 || true",
      { cwd: workspacePath, timeout: 30000 }
    );

    // Parse errors
    const errors = parseTypeScriptErrors(stderr);
    
    // Update state
    state.errors.clear();
    state.lastCheck = new Date();

    for (const error of errors) {
      const existing = state.errors.get(error.file) || [];
      existing.push(error.message);
      state.errors.set(error.file, existing);
    }

    // Update diagnostics
    updateDiagnostics(errors);

    // Calculate score
    const totalErrors = errors.length;
    state.score = Math.max(0, 100 - totalErrors * 5);

    updateStatusBar();

    // Show notification if errors increased significantly
    if (totalErrors > 5) {
      vscode.window.showWarningMessage(
        `${totalErrors} TypeScript errors detected. Fix early to avoid debugging hell!`,
        "Show Errors"
      ).then((choice) => {
        if (choice === "Show Errors") {
          vscode.commands.executeCommand("workbench.actions.view.problems");
        }
      });
    }
  } catch {
    // Type check failed to run, that's okay
    updateStatusBar();
  }
}

interface TSError {
  file: string;
  line: number;
  column: number;
  message: string;
  code: string;
}

function parseTypeScriptErrors(output: string): TSError[] {
  const errors: TSError[] = [];
  const regex = /(.+)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)/g;

  let match;
  while ((match = regex.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      code: match[4],
      message: match[5],
    });
  }

  return errors;
}

function updateDiagnostics(errors: TSError[]): void {
  diagnosticCollection.clear();

  const byFile = new Map<string, vscode.Diagnostic[]>();

  for (const error of errors) {
    const uri = vscode.Uri.file(error.file);
    const diagnostics = byFile.get(error.file) || [];

    const range = new vscode.Range(
      error.line - 1,
      error.column - 1,
      error.line - 1,
      error.column + 20
    );

    const diagnostic = new vscode.Diagnostic(
      range,
      `${error.code}: ${error.message}`,
      vscode.DiagnosticSeverity.Error
    );

    diagnostic.source = "Claude Code";
    diagnostics.push(diagnostic);
    byFile.set(error.file, diagnostics);
  }

  for (const [file, diagnostics] of byFile) {
    diagnosticCollection.set(vscode.Uri.file(file), diagnostics);
  }
}

/**
 * Quick check for current file
 */
function checkCurrentFile(document: vscode.TextDocument): void {
  const ext = path.extname(document.fileName);

  if (![".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
    return;
  }

  // Get existing diagnostics from language server
  const diagnostics = vscode.languages.getDiagnostics(document.uri);
  const errors = diagnostics.filter(
    (d) => d.severity === vscode.DiagnosticSeverity.Error
  );

  if (errors.length > 0 && errors.length <= 3) {
    // Small number of errors - offer quick fix
    const firstError = errors[0];
    vscode.window
      .showInformationMessage(
        `Error on line ${firstError.range.start.line + 1}: ${firstError.message.slice(0, 60)}...`,
        "Go to Error",
        "Dismiss"
      )
      .then((choice) => {
        if (choice === "Go to Error") {
          vscode.window.activeTextEditor?.revealRange(
            firstError.range,
            vscode.TextEditorRevealType.InCenter
          );
        }
      });
  }
}

/**
 * Check dependencies
 */
async function checkDependencies(workspacePath: string): Promise<void> {
  try {
    await execAsync("npm ls --depth=0 2>&1 || true", {
      cwd: workspacePath,
      timeout: 30000,
    });
  } catch {
    // Dependencies might be missing
    vscode.window.showWarningMessage(
      "Some dependencies may be missing. Run npm install?",
      "Install"
    ).then((choice) => {
      if (choice === "Install") {
        const terminal = vscode.window.createTerminal("npm install");
        terminal.show();
        terminal.sendText("npm install");
      }
    });
  }
}

/**
 * Update status bar
 */
function updateStatusBar(): void {
  const errorCount = Array.from(state.errors.values()).flat().length;

  if (errorCount === 0) {
    statusBarItem.text = "$(check) Health: 100%";
    statusBarItem.backgroundColor = undefined;
    statusBarItem.tooltip = "All checks passing - you're good to go!";
  } else if (errorCount <= 3) {
    statusBarItem.text = `$(warning) ${errorCount} issue${errorCount > 1 ? "s" : ""}`;
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
    statusBarItem.tooltip = `${errorCount} issue(s) detected. Click to view.`;
  } else {
    statusBarItem.text = `$(error) ${errorCount} errors`;
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground"
    );
    statusBarItem.tooltip = `${errorCount} errors! Fix these before continuing.`;
  }
}

/**
 * Get current validation state
 */
export function getValidationState(): ValidationState {
  return state;
}

/**
 * Force a full validation
 */
export async function forceValidation(): Promise<void> {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspacePath) {
    await runBackgroundTypeCheck(workspacePath);
  }
}

/**
 * Human Test Checkpoint
 * 
 * Call this at key points to ensure everything is working
 * before moving on to the next phase.
 */
export async function humanTestCheckpoint(
  checkpointName: string,
  checks: Array<{ name: string; test: () => Promise<boolean> }>
): Promise<boolean> {
  const results: Array<{ name: string; passed: boolean }> = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Running checkpoint: ${checkpointName}`,
    },
    async (progress) => {
      for (let i = 0; i < checks.length; i++) {
        const check = checks[i];
        progress.report({
          message: check.name,
          increment: (100 / checks.length),
        });

        try {
          const passed = await check.test();
          results.push({ name: check.name, passed });
        } catch {
          results.push({ name: check.name, passed: false });
        }
      }
    }
  );

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const allPassed = passed === total;

  if (allPassed) {
    vscode.window.showInformationMessage(
      `✅ Checkpoint "${checkpointName}": ${passed}/${total} tests passed!`
    );
  } else {
    const failed = results
      .filter((r) => !r.passed)
      .map((r) => r.name)
      .join(", ");

    vscode.window.showErrorMessage(
      `❌ Checkpoint "${checkpointName}": ${passed}/${total} passed. Failed: ${failed}`
    );
  }

  return allPassed;
}
