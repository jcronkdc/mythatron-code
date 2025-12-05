/**
 * Diff Preview - Show changes before applying them
 * Visual diff view with accept/reject
 */

import * as vscode from "vscode";
import * as path from "path";

export interface DiffChange {
  file: string;
  originalContent: string;
  modifiedContent: string;
  description?: string;
}

export interface DiffResult {
  accepted: boolean;
  file: string;
}

/**
 * Show a diff preview and let user accept/reject
 */
export async function showDiffPreview(change: DiffChange): Promise<DiffResult> {
  const originalUri = vscode.Uri.parse(`mythatron-code-original:${change.file}`);
  const modifiedUri = vscode.Uri.parse(`mythatron-code-modified:${change.file}`);

  const originalProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(): string {
      return change.originalContent;
    }
  })();

  const modifiedProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(): string {
      return change.modifiedContent;
    }
  })();

  const disposables = [
    vscode.workspace.registerTextDocumentContentProvider("mythatron-code-original", originalProvider),
    vscode.workspace.registerTextDocumentContentProvider("mythatron-code-modified", modifiedProvider),
  ];

  try {
    const title = `${path.basename(change.file)}: Proposed Changes`;
    await vscode.commands.executeCommand("vscode.diff", originalUri, modifiedUri, title, { preview: true });

    const result = await vscode.window.showInformationMessage(
      change.description || "Accept these changes?",
      { modal: false },
      "Accept",
      "Reject"
    );

    return {
      accepted: result === "Accept",
      file: change.file,
    };
  } finally {
    for (const d of disposables) {
      d.dispose();
    }
  }
}

/**
 * Show multiple diffs sequentially
 */
export async function showMultipleDiffPreviews(changes: DiffChange[]): Promise<DiffResult[]> {
  const results: DiffResult[] = [];

  if (changes.length > 1) {
    const choice = await vscode.window.showQuickPick(
      [
        { label: "Review each change", value: "each" },
        { label: "Accept all changes", value: "all" },
        { label: "Reject all changes", value: "none" },
      ],
      { placeHolder: `${changes.length} files will be modified` }
    );

    if (!choice) {
      return changes.map((c) => ({ accepted: false, file: c.file }));
    }

    if (choice.value === "all") {
      return changes.map((c) => ({ accepted: true, file: c.file }));
    }

    if (choice.value === "none") {
      return changes.map((c) => ({ accepted: false, file: c.file }));
    }
  }

  for (const change of changes) {
    const result = await showDiffPreview(change);
    results.push(result);

    if (!result.accepted && changes.length > 1) {
      const shouldContinue = await vscode.window.showQuickPick(
        [
          { label: "Continue reviewing", value: true },
          { label: "Reject remaining", value: false },
        ],
        { placeHolder: "Continue reviewing remaining changes?" }
      );

      if (!shouldContinue?.value) {
        for (let i = results.length; i < changes.length; i++) {
          results.push({ accepted: false, file: changes[i].file });
        }
        break;
      }
    }
  }

  return results;
}

/**
 * Generate a unified diff string
 */
export function generateUnifiedDiff(
  originalContent: string,
  modifiedContent: string,
  fileName: string
): string {
  const originalLines = originalContent.split("\n");
  const modifiedLines = modifiedContent.split("\n");

  const diff: string[] = [`--- a/${fileName}`, `+++ b/${fileName}`];

  let i = 0;
  let j = 0;

  while (i < originalLines.length || j < modifiedLines.length) {
    const origLine = originalLines[i];
    const modLine = modifiedLines[j];

    if (origLine === modLine) {
      diff.push(` ${origLine || ""}`);
      i++;
      j++;
    } else if (origLine !== undefined && modLine !== undefined) {
      diff.push(`-${origLine}`);
      diff.push(`+${modLine}`);
      i++;
      j++;
    } else if (origLine !== undefined) {
      diff.push(`-${origLine}`);
      i++;
    } else {
      diff.push(`+${modLine}`);
      j++;
    }
  }

  return diff.join("\n");
}

/**
 * Apply changes if user accepts the diff
 */
export async function applyDiffIfAccepted(change: DiffChange): Promise<boolean> {
  const result = await showDiffPreview(change);

  if (result.accepted) {
    const uri = vscode.Uri.file(change.file);
    const edit = new vscode.WorkspaceEdit();
    
    const document = await vscode.workspace.openTextDocument(uri);
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    edit.replace(uri, fullRange, change.modifiedContent);
    await vscode.workspace.applyEdit(edit);
    await vscode.window.showTextDocument(document);

    return true;
  }

  return false;
}

