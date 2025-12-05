/**
 * Context Awareness - Know everything about the user's state
 * Cursor position, selection, open files, edit history, terminal state
 */

import * as vscode from "vscode";
import * as path from "path";

export interface CursorPosition {
  file: string;
  line: number;
  character: number;
  lineContent: string;
}

export interface Selection {
  file: string;
  startLine: number;
  endLine: number;
  startCharacter: number;
  endCharacter: number;
  text: string;
}

export interface OpenFile {
  path: string;
  relativePath: string;
  language: string;
  isActive: boolean;
  isDirty: boolean;
  lineCount: number;
}

export interface EditEvent {
  file: string;
  timestamp: Date;
  type: "insert" | "delete" | "replace";
  range: {
    startLine: number;
    endLine: number;
  };
  text?: string;
}

export interface TerminalState {
  id: string;
  name: string;
  cwd?: string;
  lastCommand?: string;
  isActive: boolean;
}

export interface FullContext {
  cursor?: CursorPosition;
  selection?: Selection;
  activeFile?: OpenFile;
  openFiles: OpenFile[];
  recentlyViewedFiles: string[];
  recentEdits: EditEvent[];
  workspaceRoot: string;
  workspaceFolders: string[];
  terminals: TerminalState[];
  os: string;
  timestamp: Date;
}

export class ContextTracker {
  private workspaceRoot: string;
  private recentlyViewedFiles: string[] = [];
  private recentEdits: EditEvent[] = [];
  private maxRecentFiles = 20;
  private maxRecentEdits = 50;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.workspaceRoot =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    
    this.setupListeners();
  }

  private setupListeners(): void {
    // Track file views
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document.uri.scheme === "file") {
          this.trackFileView(editor.document.uri.fsPath);
        }
      })
    );

    // Track edits
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.scheme === "file" && e.contentChanges.length > 0) {
          this.trackEdit(e);
        }
      })
    );
  }

  private trackFileView(filePath: string): void {
    this.recentlyViewedFiles = this.recentlyViewedFiles.filter(
      (f) => f !== filePath
    );
    this.recentlyViewedFiles.unshift(filePath);
    
    if (this.recentlyViewedFiles.length > this.maxRecentFiles) {
      this.recentlyViewedFiles = this.recentlyViewedFiles.slice(0, this.maxRecentFiles);
    }
  }

  private trackEdit(e: vscode.TextDocumentChangeEvent): void {
    for (const change of e.contentChanges) {
      const edit: EditEvent = {
        file: e.document.uri.fsPath,
        timestamp: new Date(),
        type:
          change.text.length === 0
            ? "delete"
            : change.rangeLength === 0
            ? "insert"
            : "replace",
        range: {
          startLine: change.range.start.line + 1,
          endLine: change.range.end.line + 1,
        },
        text: change.text.length <= 100 ? change.text : change.text.slice(0, 100) + "...",
      };

      this.recentEdits.unshift(edit);
    }

    if (this.recentEdits.length > this.maxRecentEdits) {
      this.recentEdits = this.recentEdits.slice(0, this.maxRecentEdits);
    }
  }

  /**
   * Get the full current context
   */
  getFullContext(): FullContext {
    const editor = vscode.window.activeTextEditor;

    return {
      cursor: this.getCursorPosition(editor),
      selection: this.getSelection(editor),
      activeFile: editor ? this.getFileInfo(editor.document, true) : undefined,
      openFiles: this.getOpenFiles(),
      recentlyViewedFiles: this.recentlyViewedFiles.slice(0, 10),
      recentEdits: this.recentEdits.slice(0, 20),
      workspaceRoot: this.workspaceRoot,
      workspaceFolders: vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) || [],
      terminals: this.getTerminalStates(),
      os: process.platform,
      timestamp: new Date(),
    };
  }

  private getCursorPosition(editor?: vscode.TextEditor): CursorPosition | undefined {
    if (!editor) return undefined;

    const position = editor.selection.active;
    const line = editor.document.lineAt(position.line);

    return {
      file: editor.document.uri.fsPath,
      line: position.line + 1,
      character: position.character,
      lineContent: line.text,
    };
  }

  private getSelection(editor?: vscode.TextEditor): Selection | undefined {
    if (!editor || editor.selection.isEmpty) return undefined;

    const selection = editor.selection;
    return {
      file: editor.document.uri.fsPath,
      startLine: selection.start.line + 1,
      endLine: selection.end.line + 1,
      startCharacter: selection.start.character,
      endCharacter: selection.end.character,
      text: editor.document.getText(selection),
    };
  }

  private getFileInfo(document: vscode.TextDocument, isActive: boolean): OpenFile {
    return {
      path: document.uri.fsPath,
      relativePath: path.relative(this.workspaceRoot, document.uri.fsPath),
      language: document.languageId,
      isActive,
      isDirty: document.isDirty,
      lineCount: document.lineCount,
    };
  }

  private getOpenFiles(): OpenFile[] {
    const activeEditor = vscode.window.activeTextEditor;
    const activeUri = activeEditor?.document.uri.fsPath;

    return vscode.workspace.textDocuments
      .filter((doc) => doc.uri.scheme === "file" && !doc.isUntitled)
      .map((doc) => this.getFileInfo(doc, doc.uri.fsPath === activeUri));
  }

  private getTerminalStates(): TerminalState[] {
    return vscode.window.terminals.map((terminal, i) => ({
      id: `terminal-${i}`,
      name: terminal.name,
      isActive: terminal === vscode.window.activeTerminal,
    }));
  }

  /**
   * Build context string for the AI
   */
  buildContextString(): string {
    const ctx = this.getFullContext();
    const lines: string[] = [];

    lines.push("<user_context>");
    lines.push(`OS: ${ctx.os}`);
    lines.push(`Workspace: ${ctx.workspaceRoot}`);
    lines.push(`Time: ${ctx.timestamp.toISOString()}`);

    if (ctx.cursor) {
      lines.push(`\nCursor: ${path.relative(this.workspaceRoot, ctx.cursor.file)}:${ctx.cursor.line}:${ctx.cursor.character}`);
      lines.push(`Line: ${ctx.cursor.lineContent}`);
    }

    if (ctx.selection) {
      lines.push(`\nSelection: ${path.relative(this.workspaceRoot, ctx.selection.file)} lines ${ctx.selection.startLine}-${ctx.selection.endLine}`);
      if (ctx.selection.text.length <= 500) {
        lines.push(`Selected:\n${ctx.selection.text}`);
      }
    }

    if (ctx.openFiles.length > 0) {
      lines.push("\nOpen files:");
      for (const file of ctx.openFiles) {
        const marker = file.isActive ? "→" : " ";
        const dirty = file.isDirty ? "*" : "";
        lines.push(`${marker} ${file.relativePath}${dirty} (${file.language})`);
      }
    }

    if (ctx.recentlyViewedFiles.length > 0) {
      lines.push("\nRecently viewed:");
      for (const file of ctx.recentlyViewedFiles.slice(0, 5)) {
        lines.push(`  ${path.relative(this.workspaceRoot, file)}`);
      }
    }

    if (ctx.recentEdits.length > 0) {
      lines.push("\nRecent edits:");
      for (const edit of ctx.recentEdits.slice(0, 5)) {
        const file = path.relative(this.workspaceRoot, edit.file);
        lines.push(`  ${edit.type} at ${file}:${edit.range.startLine}`);
      }
    }

    if (ctx.terminals.length > 0) {
      lines.push("\nTerminals:");
      for (const term of ctx.terminals) {
        const marker = term.isActive ? "→" : " ";
        lines.push(`${marker} ${term.name}`);
      }
    }

    lines.push("</user_context>");

    return lines.join("\n");
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

// Singleton
let contextTracker: ContextTracker | null = null;

export function getContextTracker(): ContextTracker {
  if (!contextTracker) {
    contextTracker = new ContextTracker();
  }
  return contextTracker;
}

