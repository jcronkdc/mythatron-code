/**
 * Tool Executor - Implements ALL AI tools
 * Complete replication of Cursor's capabilities + extras
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { exec, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import { glob } from "glob";
import ignore from "ignore";
import type { ToolName, ToolInput } from "./definitions";
import { getTerminalManager, TerminalPermission } from "../terminal";
import { getSemanticSearch } from "../search/semantic";
import { getWebSearch } from "../search/web";
import { getMemoryManager } from "../memory";
import { getMCPManager } from "../mcp";
import { getContextTracker } from "../features/context";
import { isImageFile, readImageAsBase64 } from "../features/vision";
import {
  editNotebookCell,
  createNotebookCell,
} from "../features/notebooks";

const execAsync = promisify(exec);

let taskStore: Array<{ id: string; content: string; status: string }> = [];

// Checkpoint storage
interface Checkpoint {
  id: string;
  name: string;
  timestamp: Date;
  files: Map<string, string>;
}
let checkpoints: Checkpoint[] = [];

export class ToolExecutor {
  private workspaceRoot: string;
  private gitignore: ReturnType<typeof ignore> | null = null;

  constructor() {
    this.workspaceRoot =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    this.loadGitignore();
  }

  private loadGitignore(): void {
    try {
      const gitignorePath = path.join(this.workspaceRoot, ".gitignore");
      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, "utf-8");
        this.gitignore = ignore().add(content);
      }
    } catch {
      // Ignore
    }
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.join(this.workspaceRoot, filePath);
  }

  private formatWithLineNumbers(content: string, startLine = 1): string {
    return content
      .split("\n")
      .map((line, i) => `${(startLine + i).toString().padStart(6, " ")}|${line}`)
      .join("\n");
  }

  async execute(toolName: ToolName, input: ToolInput): Promise<string> {
    try {
      switch (toolName) {
        // File operations
        case "read_file": return await this.readFile(input);
        case "write_file": return await this.writeFile(input);
        case "edit_file": return await this.editFile(input);
        case "multi_edit": return await this.multiEdit(input);
        case "list_directory": return await this.listDirectory(input);
        case "create_directory": return await this.createDirectory(input);
        case "delete_file": return await this.deleteFile(input);
        case "rename_file": return await this.renameFile(input);
        case "copy_file": return await this.copyFile(input);

        // Notebook
        case "edit_notebook": return await this.editNotebook(input);

        // Search
        case "codebase_search": return await this.codebaseSearch(input);
        case "grep": return await this.grep(input);
        case "search_files": return await this.searchFiles(input);
        case "web_search": return await this.webSearch(input);
        case "fetch_url": return await this.fetchUrl(input);

        // Terminal
        case "run_terminal_command": return await this.runTerminalCommand(input);
        case "list_running_jobs": return await this.listRunningJobs();
        case "kill_job": return await this.killJob(input);
        case "read_terminal_output": return await this.readTerminalOutput(input);

        // Code intelligence (basic)
        case "get_diagnostics": return await this.getDiagnostics(input);
        case "get_definition": return await this.getDefinition(input);
        case "get_references": return await this.getReferences(input);
        case "get_hover_info": return await this.getHoverInfo(input);

        // Code intelligence (advanced)
        case "rename_symbol": return await this.renameSymbol(input);
        case "find_implementations": return await this.findImplementations(input);
        case "workspace_symbols": return await this.workspaceSymbols(input);
        case "document_symbols": return await this.documentSymbols(input);
        case "call_hierarchy": return await this.callHierarchy(input);
        case "type_hierarchy": return await this.typeHierarchy(input);
        case "get_code_actions": return await this.getCodeActions(input);
        case "apply_code_action": return await this.applyCodeAction(input);
        case "format_document": return await this.formatDocument(input);

        // Git (basic)
        case "get_git_status": return await this.getGitStatus(input);
        case "git_diff": return await this.gitDiff(input);
        case "apply_diff": return await this.applyDiff(input);

        // Git (full)
        case "git_log": return await this.gitLog(input);
        case "git_commit": return await this.gitCommit(input);
        case "git_push": return await this.gitPush(input);
        case "git_pull": return await this.gitPull(input);
        case "git_branch": return await this.gitBranch(input);
        case "git_checkout": return await this.gitCheckout(input);
        case "git_stash": return await this.gitStash(input);
        case "git_blame": return await this.gitBlame(input);
        case "git_add": return await this.gitAdd(input);
        case "git_reset": return await this.gitReset(input);

        // Memory
        case "update_memory": return await this.updateMemory(input);
        case "search_memories": return await this.searchMemories(input);
        case "list_memories": return await this.listMemories();

        // Workspace & Context
        case "get_workspace_info": return await this.getWorkspaceInfo();
        case "get_context": return await this.getContext();
        case "get_open_files": return await this.getOpenFiles();
        case "get_selection": return await this.getSelection();

        // Tasks
        case "todo_write": return await this.todoWrite(input);

        // Browser
        case "browser_navigate": return await this.browserNavigate(input);
        case "browser_snapshot": return await this.browserSnapshot();
        case "browser_click": return await this.browserClick(input);
        case "browser_type": return await this.browserType(input);
        case "browser_screenshot": return await this.browserScreenshot(input);
        case "browser_console": return await this.browserConsole();
        case "browser_network": return await this.browserNetwork();

        // MCP
        case "mcp_call": return await this.mcpCall(input);
        case "mcp_list_tools": return await this.mcpListTools();

        // Checkpoints
        case "create_checkpoint": return await this.createCheckpoint(input);
        case "restore_checkpoint": return await this.restoreCheckpoint(input);
        case "list_checkpoints": return await this.listCheckpoints();

        default:
          return `Unknown tool: ${toolName}`;
      }
    } catch (error) {
      return `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // ============================================
  // FILE OPERATIONS
  // ============================================

  private async readFile(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);

    if (!fs.existsSync(filePath)) {
      return `File not found: ${filePath}`;
    }

    if (isImageFile(filePath)) {
      const imageData = readImageAsBase64(filePath);
      if (imageData) {
        return `[Image: ${path.basename(filePath)}]\nType: ${imageData.mediaType}\nSize: ${imageData.data.length} bytes (base64)`;
      }
      return `Failed to read image: ${filePath}`;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const startLine = (input.start_line as number) || 1;
    const endLine = input.end_line as number | undefined;

    if (endLine) {
      const lines = content.split("\n").slice(startLine - 1, endLine);
      return this.formatWithLineNumbers(lines.join("\n"), startLine);
    }

    return this.formatWithLineNumbers(content, startLine);
  }

  private async writeFile(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const content = input.content as string;

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, "utf-8");

    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);

    return `Wrote ${content.split("\n").length} lines to ${filePath}`;
  }

  private async editFile(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const oldString = input.old_string as string;
    const newString = input.new_string as string;
    const replaceAll = input.replace_all as boolean;

    if (!fs.existsSync(filePath)) {
      return `File not found: ${filePath}`;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const occurrences = content.split(oldString).length - 1;

    if (occurrences === 0) {
      return `Error: Could not find text in ${filePath}`;
    }

    if (!replaceAll && occurrences > 1) {
      return `Error: Found ${occurrences} occurrences. Use replace_all or provide more context.`;
    }

    const newContent = replaceAll
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString);

    fs.writeFileSync(filePath, newContent, "utf-8");

    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);

    return `Edited ${filePath}${replaceAll ? ` (${occurrences} replacements)` : ""}`;
  }

  private async multiEdit(input: ToolInput): Promise<string> {
    const edits = input.edits as Array<{ path: string; old_string: string; new_string: string }>;
    const results: string[] = [];

    for (const edit of edits) {
      const result = await this.editFile(edit);
      results.push(result);
    }

    return results.join("\n");
  }

  private async listDirectory(input: ToolInput): Promise<string> {
    const dirPath = this.resolvePath(input.path as string);
    const recursive = (input.recursive as boolean) || false;
    const maxDepth = (input.max_depth as number) || 3;
    const pattern = input.pattern as string | undefined;

    if (!fs.existsSync(dirPath)) {
      return `Directory not found: ${dirPath}`;
    }

    const results: string[] = [];

    const listDir = (currentPath: string, depth: number, prefix = ""): void => {
      if (depth > maxDepth) return;

      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

        const relativePath = path.relative(this.workspaceRoot, path.join(currentPath, entry.name));
        if (this.gitignore?.ignores(relativePath)) continue;

        if (pattern && !entry.name.match(new RegExp(pattern.replace(/\*/g, ".*")))) continue;

        const icon = entry.isDirectory() ? "📁" : "📄";
        results.push(`${prefix}${icon} ${entry.name}`);

        if (recursive && entry.isDirectory()) {
          listDir(path.join(currentPath, entry.name), depth + 1, prefix + "  ");
        }
      }
    };

    listDir(dirPath, 0);
    return results.join("\n") || "Directory is empty";
  }

  private async createDirectory(input: ToolInput): Promise<string> {
    const dirPath = this.resolvePath(input.path as string);
    if (fs.existsSync(dirPath)) return `Directory exists: ${dirPath}`;
    fs.mkdirSync(dirPath, { recursive: true });
    return `Created: ${dirPath}`;
  }

  private async deleteFile(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const recursive = (input.recursive as boolean) || false;

    if (!fs.existsSync(filePath)) return `Not found: ${filePath}`;

    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      fs.rmSync(filePath, { recursive });
    } else {
      fs.unlinkSync(filePath);
    }
    return `Deleted: ${filePath}`;
  }

  private async renameFile(input: ToolInput): Promise<string> {
    const oldPath = this.resolvePath(input.old_path as string);
    const newPath = this.resolvePath(input.new_path as string);

    if (!fs.existsSync(oldPath)) return `Not found: ${oldPath}`;

    const newDir = path.dirname(newPath);
    if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });

    fs.renameSync(oldPath, newPath);
    return `Renamed: ${oldPath} → ${newPath}`;
  }

  private async copyFile(input: ToolInput): Promise<string> {
    const source = this.resolvePath(input.source as string);
    const dest = this.resolvePath(input.destination as string);

    if (!fs.existsSync(source)) return `Not found: ${source}`;

    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    fs.copyFileSync(source, dest);
    return `Copied: ${source} → ${dest}`;
  }

  // ============================================
  // NOTEBOOK
  // ============================================

  private async editNotebook(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const cellIndex = input.cell_index as number;
    const isNewCell = input.is_new_cell as boolean;
    const cellType = (input.cell_type as "code" | "markdown" | "raw") || "code";
    const oldString = input.old_string as string;
    const newString = input.new_string as string;

    if (!fs.existsSync(filePath)) {
      return `Notebook not found: ${filePath}`;
    }

    if (isNewCell) {
      const result = createNotebookCell(filePath, cellIndex, cellType, newString);
      return result.success ? `Created cell ${cellIndex}` : `Error: ${result.error}`;
    } else {
      const result = editNotebookCell(filePath, cellIndex, oldString, newString);
      return result.success ? `Edited cell ${cellIndex}` : `Error: ${result.error}`;
    }
  }

  // ============================================
  // SEARCH
  // ============================================

  private async codebaseSearch(input: ToolInput): Promise<string> {
    const query = input.query as string;
    const maxResults = (input.max_results as number) || 20;

    const search = getSemanticSearch();
    const results = await search.search(query, maxResults);

    if (results.length === 0) return `No results for: ${query}`;

    return results
      .map((r, i) => {
        const preview = r.content.length > 300 ? r.content.slice(0, 300) + "..." : r.content;
        return `[${i + 1}] ${r.relativePath}:${r.startLine}-${r.endLine}\n${preview}`;
      })
      .join("\n\n---\n\n");
  }

  private async grep(input: ToolInput): Promise<string> {
    const pattern = input.pattern as string;
    const directory = input.directory ? this.resolvePath(input.directory as string) : this.workspaceRoot;
    const filePattern = (input.file_pattern as string) || "*";
    const caseSensitive = input.case_sensitive !== false;
    const contextLines = (input.context_lines as number) || 0;
    const maxResults = (input.max_results as number) || 100;

    try {
      const flags = caseSensitive ? "" : "-i";
      const ctx = contextLines > 0 ? `-C ${contextLines}` : "";

      const { stdout } = await execAsync(
        `grep -rn ${flags} ${ctx} --include="${filePattern}" "${pattern}" "${directory}" 2>/dev/null | head -${maxResults}`,
        { maxBuffer: 10 * 1024 * 1024 }
      );

      return stdout.trim() || `No matches for: ${pattern}`;
    } catch {
      return `No matches for: ${pattern}`;
    }
  }

  private async searchFiles(input: ToolInput): Promise<string> {
    const pattern = input.pattern as string;
    const directory = input.directory ? this.resolvePath(input.directory as string) : this.workspaceRoot;

    const files = await glob(pattern, {
      cwd: directory,
      ignore: ["**/node_modules/**", "**/.git/**"],
      nodir: true,
    });

    if (files.length === 0) return `No files matching: ${pattern}`;

    return files.slice(0, 100).join("\n") + (files.length > 100 ? `\n... +${files.length - 100} more` : "");
  }

  private async webSearch(input: ToolInput): Promise<string> {
    const query = input.query as string;
    const maxResults = (input.max_results as number) || 5;

    const search = getWebSearch();
    const results = await search.search(query, { maxResults });

    if (results.length === 0) return `No results for: ${query}`;

    return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
  }

  private async fetchUrl(input: ToolInput): Promise<string> {
    const url = input.url as string;
    const extractText = input.extract_text !== false;

    const search = getWebSearch();
    const content = await search.fetchPage(url);

    return extractText ? content : `Fetched ${url}`;
  }

  // ============================================
  // TERMINAL
  // ============================================

  private async runTerminalCommand(input: ToolInput): Promise<string> {
    const command = input.command as string;
    const cwd = input.cwd ? this.resolvePath(input.cwd as string) : this.workspaceRoot;
    const timeout = (input.timeout as number) || 60000;
    const isBackground = (input.is_background as boolean) || false;
    const permissions = (input.permissions as TerminalPermission[]) || [];

    const terminal = getTerminalManager();
    const job = await terminal.run(command, { cwd, timeout, isBackground, permissions });

    if (isBackground) {
      return `Background job ${job.id} started\nCommand: ${job.command}\nPID: ${job.pid || "N/A"}`;
    }

    let result = "";
    if (job.output) result += job.output;
    if (job.error) result += (result ? "\n" : "") + `STDERR: ${job.error}`;
    if (job.status === "failed") result += `\nExit: ${job.exitCode}`;

    return result || "Command completed";
  }

  private async listRunningJobs(): Promise<string> {
    const terminal = getTerminalManager();
    const jobs = terminal.getRunningJobs();

    if (jobs.length === 0) return "No running jobs";

    return jobs.map((j) => `${j.id}: ${j.command} (PID: ${j.pid})`).join("\n");
  }

  private async killJob(input: ToolInput): Promise<string> {
    const jobId = input.job_id as string;
    const terminal = getTerminalManager();
    const killed = await terminal.kill(jobId);
    return killed ? `Killed: ${jobId}` : `Not found: ${jobId}`;
  }

  private async readTerminalOutput(input: ToolInput): Promise<string> {
    // Read from VS Code terminal
    const terminals = vscode.window.terminals;
    if (terminals.length === 0) return "No terminals open";

    const active = vscode.window.activeTerminal;
    return `Active terminal: ${active?.name || "none"}\nTotal terminals: ${terminals.length}`;
  }

  // ============================================
  // CODE INTELLIGENCE (BASIC)
  // ============================================

  private async getDiagnostics(input: ToolInput): Promise<string> {
    const filePath = input.path ? this.resolvePath(input.path as string) : undefined;

    const diagnostics = filePath
      ? vscode.languages.getDiagnostics(vscode.Uri.file(filePath))
      : vscode.languages.getDiagnostics();

    const format = (uri: vscode.Uri, diags: vscode.Diagnostic[]): string => {
      return diags
        .map((d) => {
          const sev = ["Error", "Warning", "Info", "Hint"][d.severity || 0];
          return `${path.relative(this.workspaceRoot, uri.fsPath)}:${d.range.start.line + 1} [${sev}] ${d.message}`;
        })
        .join("\n");
    };

    if (filePath) {
      const uri = vscode.Uri.file(filePath);
      const diags = vscode.languages.getDiagnostics(uri);
      return format(uri, diags) || "No diagnostics";
    }

    const all = diagnostics as [vscode.Uri, vscode.Diagnostic[]][];
    return all.filter(([, d]) => d.length > 0).map(([u, d]) => format(u, d)).join("\n") || "No diagnostics";
  }

  private async getDefinition(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const line = (input.line as number) - 1;
    const char = input.character as number;

    const defs = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      vscode.Uri.file(filePath),
      new vscode.Position(line, char)
    );

    if (!defs || defs.length === 0) return "No definition found";

    return defs
      .map((d) => `${path.relative(this.workspaceRoot, d.uri.fsPath)}:${d.range.start.line + 1}`)
      .join("\n");
  }

  private async getReferences(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const line = (input.line as number) - 1;
    const char = input.character as number;

    const refs = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      vscode.Uri.file(filePath),
      new vscode.Position(line, char)
    );

    if (!refs || refs.length === 0) return "No references found";

    return refs
      .slice(0, 50)
      .map((r) => `${path.relative(this.workspaceRoot, r.uri.fsPath)}:${r.range.start.line + 1}`)
      .join("\n") + (refs.length > 50 ? `\n... +${refs.length - 50} more` : "");
  }

  private async getHoverInfo(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const line = (input.line as number) - 1;
    const char = input.character as number;

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      vscode.Uri.file(filePath),
      new vscode.Position(line, char)
    );

    if (!hovers || hovers.length === 0) return "No hover info";

    return hovers
      .map((h) =>
        h.contents.map((c) => (typeof c === "string" ? c : "value" in c ? c.value : String(c))).join("\n")
      )
      .join("\n---\n");
  }

  // ============================================
  // CODE INTELLIGENCE (ADVANCED)
  // ============================================

  private async renameSymbol(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const line = (input.line as number) - 1;
    const char = input.character as number;
    const newName = input.new_name as string;

    const uri = vscode.Uri.file(filePath);
    const position = new vscode.Position(line, char);

    const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
      "vscode.executeDocumentRenameProvider",
      uri,
      position,
      newName
    );

    if (!edit || edit.size === 0) return "Could not rename symbol";

    await vscode.workspace.applyEdit(edit);
    return `Renamed to "${newName}" in ${edit.size} locations`;
  }

  private async findImplementations(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const line = (input.line as number) - 1;
    const char = input.character as number;

    const impls = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeImplementationProvider",
      vscode.Uri.file(filePath),
      new vscode.Position(line, char)
    );

    if (!impls || impls.length === 0) return "No implementations found";

    return impls
      .map((i) => `${path.relative(this.workspaceRoot, i.uri.fsPath)}:${i.range.start.line + 1}`)
      .join("\n");
  }

  private async workspaceSymbols(input: ToolInput): Promise<string> {
    const query = input.query as string;

    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      query
    );

    if (!symbols || symbols.length === 0) return `No symbols matching: ${query}`;

    return symbols
      .slice(0, 50)
      .map((s) => `${s.name} (${vscode.SymbolKind[s.kind]}) - ${path.relative(this.workspaceRoot, s.location.uri.fsPath)}`)
      .join("\n");
  }

  private async documentSymbols(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      vscode.Uri.file(filePath)
    );

    if (!symbols || symbols.length === 0) return "No symbols found";

    const formatSymbols = (syms: vscode.DocumentSymbol[], indent = 0): string => {
      return syms
        .map((s) => {
          const prefix = "  ".repeat(indent);
          const children = s.children?.length ? "\n" + formatSymbols(s.children, indent + 1) : "";
          return `${prefix}${s.name} (${vscode.SymbolKind[s.kind]}) :${s.range.start.line + 1}${children}`;
        })
        .join("\n");
    };

    return formatSymbols(symbols);
  }

  private async callHierarchy(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const line = (input.line as number) - 1;
    const char = input.character as number;
    const direction = (input.direction as "incoming" | "outgoing") || "incoming";

    const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
      "vscode.prepareCallHierarchy",
      vscode.Uri.file(filePath),
      new vscode.Position(line, char)
    );

    if (!items || items.length === 0) return "No call hierarchy found";

    const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[] | vscode.CallHierarchyOutgoingCall[]>(
      direction === "incoming" ? "vscode.provideIncomingCalls" : "vscode.provideOutgoingCalls",
      items[0]
    );

    if (!calls || calls.length === 0) return `No ${direction} calls found`;

    return calls
      .map((c) => {
        const item = "from" in c ? c.from : c.to;
        return `${item.name} - ${path.relative(this.workspaceRoot, item.uri.fsPath)}:${item.range.start.line + 1}`;
      })
      .join("\n");
  }

  private async typeHierarchy(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const line = (input.line as number) - 1;
    const char = input.character as number;
    const direction = (input.direction as "supertypes" | "subtypes") || "supertypes";

    const items = await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
      "vscode.prepareTypeHierarchy",
      vscode.Uri.file(filePath),
      new vscode.Position(line, char)
    );

    if (!items || items.length === 0) return "No type hierarchy found";

    const types = await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
      direction === "supertypes" ? "vscode.provideSupertypes" : "vscode.provideSubtypes",
      items[0]
    );

    if (!types || types.length === 0) return `No ${direction} found`;

    return types
      .map((t) => `${t.name} - ${path.relative(this.workspaceRoot, t.uri.fsPath)}:${t.range.start.line + 1}`)
      .join("\n");
  }

  private async getCodeActions(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const line = (input.line as number) - 1;
    const char = input.character as number;

    const doc = await vscode.workspace.openTextDocument(filePath);
    const range = new vscode.Range(line, char, line, char + 1);

    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      "vscode.executeCodeActionProvider",
      doc.uri,
      range
    );

    if (!actions || actions.length === 0) return "No code actions available";

    return actions
      .map((a, i) => `[${i}] ${a.title} (${a.kind?.value || "unknown"})`)
      .join("\n");
  }

  private async applyCodeAction(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const line = (input.line as number) - 1;
    const char = input.character as number;
    const actionTitle = input.action_title as string;

    const doc = await vscode.workspace.openTextDocument(filePath);
    const range = new vscode.Range(line, char, line, char + 1);

    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      "vscode.executeCodeActionProvider",
      doc.uri,
      range
    );

    const action = actions?.find((a) => a.title === actionTitle);
    if (!action) return `Code action not found: ${actionTitle}`;

    if (action.edit) {
      await vscode.workspace.applyEdit(action.edit);
    }
    if (action.command) {
      await vscode.commands.executeCommand(action.command.command, ...(action.command.arguments || []));
    }

    return `Applied: ${actionTitle}`;
  }

  private async formatDocument(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const doc = await vscode.workspace.openTextDocument(filePath);
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      "vscode.executeFormatDocumentProvider",
      doc.uri
    );

    if (!edits || edits.length === 0) return "No formatting changes";

    const edit = new vscode.WorkspaceEdit();
    for (const e of edits) {
      edit.replace(doc.uri, e.range, e.newText);
    }
    await vscode.workspace.applyEdit(edit);

    return `Formatted ${path.basename(filePath)}`;
  }

  // ============================================
  // GIT (FULL)
  // ============================================

  private async getGitStatus(input: ToolInput): Promise<string> {
    const dir = input.path ? this.resolvePath(input.path as string) : this.workspaceRoot;

    try {
      const { stdout } = await execAsync("git status --porcelain -b", { cwd: dir });
      if (!stdout.trim()) return "Working directory clean";

      const lines = stdout.trim().split("\n");
      const branch = lines[0].replace("## ", "");
      const files = lines.slice(1);

      let result = `Branch: ${branch}\n`;
      const staged = files.filter((f) => f[0] !== " " && f[0] !== "?");
      const modified = files.filter((f) => f[1] === "M");
      const untracked = files.filter((f) => f.startsWith("??"));

      if (staged.length) result += `\nStaged (${staged.length}):\n${staged.map((f) => `  ${f}`).join("\n")}`;
      if (modified.length) result += `\nModified (${modified.length}):\n${modified.map((f) => `  ${f}`).join("\n")}`;
      if (untracked.length) result += `\nUntracked (${untracked.length}):\n${untracked.map((f) => `  ${f}`).join("\n")}`;

      return result;
    } catch {
      return "Not a git repository";
    }
  }

  private async gitDiff(input: ToolInput): Promise<string> {
    const filePath = input.path as string | undefined;
    const staged = (input.staged as boolean) || false;
    const commit = input.commit as string | undefined;

    let cmd = "git diff";
    if (staged) cmd += " --staged";
    if (commit) cmd += ` ${commit}`;
    if (filePath) cmd += ` -- "${this.resolvePath(filePath)}"`;

    try {
      const { stdout } = await execAsync(cmd, { cwd: this.workspaceRoot, maxBuffer: 10 * 1024 * 1024 });
      return stdout || "No changes";
    } catch {
      return "Not a git repository";
    }
  }

  private async gitLog(input: ToolInput): Promise<string> {
    const filePath = input.path as string | undefined;
    const maxCount = (input.max_count as number) || 20;
    const author = input.author as string | undefined;
    const since = input.since as string | undefined;

    let cmd = `git log --oneline -n ${maxCount}`;
    if (author) cmd += ` --author="${author}"`;
    if (since) cmd += ` --since="${since}"`;
    if (filePath) cmd += ` -- "${this.resolvePath(filePath)}"`;

    try {
      const { stdout } = await execAsync(cmd, { cwd: this.workspaceRoot });
      return stdout || "No commits found";
    } catch {
      return "Not a git repository";
    }
  }

  private async gitCommit(input: ToolInput): Promise<string> {
    const message = input.message as string;
    const files = input.files as string[] | undefined;

    try {
      if (files && files.length > 0) {
        await execAsync(`git add ${files.map((f) => `"${this.resolvePath(f)}"`).join(" ")}`, { cwd: this.workspaceRoot });
      }

      const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: this.workspaceRoot });
      return stdout;
    } catch (error) {
      return `Commit failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async gitPush(input: ToolInput): Promise<string> {
    const remote = (input.remote as string) || "origin";
    const branch = input.branch as string | undefined;
    const force = (input.force as boolean) || false;

    let cmd = `git push ${remote}`;
    if (branch) cmd += ` ${branch}`;
    if (force) cmd += " --force";

    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd: this.workspaceRoot });
      return stdout || stderr || "Pushed successfully";
    } catch (error) {
      return `Push failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async gitPull(input: ToolInput): Promise<string> {
    const remote = (input.remote as string) || "origin";
    const branch = input.branch as string | undefined;
    const rebase = (input.rebase as boolean) || false;

    let cmd = `git pull ${remote}`;
    if (branch) cmd += ` ${branch}`;
    if (rebase) cmd += " --rebase";

    try {
      const { stdout } = await execAsync(cmd, { cwd: this.workspaceRoot });
      return stdout || "Already up to date";
    } catch (error) {
      return `Pull failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async gitBranch(input: ToolInput): Promise<string> {
    const action = input.action as "create" | "list" | "delete";
    const name = input.name as string | undefined;

    try {
      switch (action) {
        case "list": {
          const { stdout } = await execAsync("git branch -a", { cwd: this.workspaceRoot });
          return stdout;
        }
        case "create": {
          if (!name) return "Branch name required";
          await execAsync(`git branch "${name}"`, { cwd: this.workspaceRoot });
          return `Created branch: ${name}`;
        }
        case "delete": {
          if (!name) return "Branch name required";
          await execAsync(`git branch -d "${name}"`, { cwd: this.workspaceRoot });
          return `Deleted branch: ${name}`;
        }
      }
    } catch (error) {
      return `Branch operation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async gitCheckout(input: ToolInput): Promise<string> {
    const target = input.target as string;
    const create = (input.create as boolean) || false;
    const files = input.files as string[] | undefined;

    try {
      if (files && files.length > 0) {
        await execAsync(`git checkout -- ${files.map((f) => `"${this.resolvePath(f)}"`).join(" ")}`, { cwd: this.workspaceRoot });
        return `Restored ${files.length} file(s)`;
      }

      const flag = create ? "-b" : "";
      await execAsync(`git checkout ${flag} "${target}"`, { cwd: this.workspaceRoot });
      return `Switched to ${target}`;
    } catch (error) {
      return `Checkout failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async gitStash(input: ToolInput): Promise<string> {
    const action = input.action as "push" | "pop" | "list" | "drop";
    const message = input.message as string | undefined;
    const index = input.index as number | undefined;

    try {
      switch (action) {
        case "push": {
          const msg = message ? `-m "${message}"` : "";
          await execAsync(`git stash push ${msg}`, { cwd: this.workspaceRoot });
          return "Changes stashed";
        }
        case "pop": {
          const idx = index !== undefined ? `stash@{${index}}` : "";
          await execAsync(`git stash pop ${idx}`, { cwd: this.workspaceRoot });
          return "Stash applied and dropped";
        }
        case "list": {
          const { stdout } = await execAsync("git stash list", { cwd: this.workspaceRoot });
          return stdout || "No stashes";
        }
        case "drop": {
          const idx = index !== undefined ? `stash@{${index}}` : "";
          await execAsync(`git stash drop ${idx}`, { cwd: this.workspaceRoot });
          return "Stash dropped";
        }
      }
    } catch (error) {
      return `Stash operation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async gitBlame(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const lineStart = input.line_start as number | undefined;
    const lineEnd = input.line_end as number | undefined;

    let cmd = `git blame "${filePath}"`;
    if (lineStart && lineEnd) {
      cmd += ` -L ${lineStart},${lineEnd}`;
    }

    try {
      const { stdout } = await execAsync(cmd, { cwd: this.workspaceRoot });
      return stdout;
    } catch (error) {
      return `Blame failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async gitAdd(input: ToolInput): Promise<string> {
    const files = input.files as string[] | undefined;
    const all = (input.all as boolean) || false;

    try {
      if (all) {
        await execAsync("git add -A", { cwd: this.workspaceRoot });
        return "All changes staged";
      }

      if (!files || files.length === 0) return "No files specified";

      await execAsync(`git add ${files.map((f) => `"${this.resolvePath(f)}"`).join(" ")}`, { cwd: this.workspaceRoot });
      return `Staged ${files.length} file(s)`;
    } catch (error) {
      return `Add failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async gitReset(input: ToolInput): Promise<string> {
    const files = input.files as string[] | undefined;
    const commit = input.commit as string | undefined;
    const mode = (input.mode as "soft" | "mixed" | "hard") || "mixed";

    try {
      if (files && files.length > 0) {
        await execAsync(`git reset ${files.map((f) => `"${this.resolvePath(f)}"`).join(" ")}`, { cwd: this.workspaceRoot });
        return `Unstaged ${files.length} file(s)`;
      }

      if (commit) {
        await execAsync(`git reset --${mode} ${commit}`, { cwd: this.workspaceRoot });
        return `Reset to ${commit} (${mode})`;
      }

      await execAsync("git reset", { cwd: this.workspaceRoot });
      return "Unstaged all changes";
    } catch (error) {
      return `Reset failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async applyDiff(input: ToolInput): Promise<string> {
    const filePath = this.resolvePath(input.path as string);
    const diff = input.diff as string;
    const tempPath = path.join(this.workspaceRoot, ".claude-code-temp.diff");

    try {
      fs.writeFileSync(tempPath, diff);
      await execAsync(`patch "${filePath}" < "${tempPath}"`, { cwd: this.workspaceRoot });
      fs.unlinkSync(tempPath);

      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc);

      return `Applied diff to ${filePath}`;
    } catch (error) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      throw error;
    }
  }

  // ============================================
  // MEMORY
  // ============================================

  private async updateMemory(input: ToolInput): Promise<string> {
    const action = input.action as "create" | "update" | "delete";
    const id = input.id as string | undefined;
    const title = input.title as string | undefined;
    const content = input.content as string | undefined;
    const tags = input.tags as string[] | undefined;

    const mm = getMemoryManager();

    switch (action) {
      case "create":
        if (!title || !content) return "Error: title and content required";
        const mem = mm.createMemory(title, content, tags);
        return `Created memory: ${mem.id}`;
      case "update":
        if (!id) return "Error: id required";
        const updated = mm.updateMemory(id, { title, content, tags });
        return updated ? `Updated: ${id}` : `Not found: ${id}`;
      case "delete":
        if (!id) return "Error: id required";
        return mm.deleteMemory(id) ? `Deleted: ${id}` : `Not found: ${id}`;
      default:
        return `Unknown action: ${action}`;
    }
  }

  private async searchMemories(input: ToolInput): Promise<string> {
    const query = input.query as string;
    const memories = getMemoryManager().searchMemories(query);

    if (memories.length === 0) return "No memories found";

    return memories.map((m) => `[[memory:${m.id}]] ${m.title}\n${m.content}`).join("\n\n");
  }

  private async listMemories(): Promise<string> {
    const memories = getMemoryManager().getAllMemories();

    if (memories.length === 0) return "No memories stored";

    return memories.map((m) => `[[memory:${m.id}]] ${m.title}`).join("\n");
  }

  // ============================================
  // WORKSPACE & CONTEXT
  // ============================================

  private async getWorkspaceInfo(): Promise<string> {
    const info: string[] = [`Workspace: ${this.workspaceRoot}`];

    const docs = vscode.workspace.textDocuments
      .filter((d) => d.uri.scheme === "file" && !d.isUntitled)
      .map((d) => path.relative(this.workspaceRoot, d.uri.fsPath));

    if (docs.length) info.push(`\nOpen files:\n${docs.map((f) => `  - ${f}`).join("\n")}`);

    try {
      const top = fs
        .readdirSync(this.workspaceRoot, { withFileTypes: true })
        .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
        .slice(0, 20)
        .map((e) => `  ${e.isDirectory() ? "📁" : "📄"} ${e.name}`);
      info.push(`\nStructure:\n${top.join("\n")}`);
    } catch { }

    try {
      const { stdout } = await execAsync("git branch --show-current", { cwd: this.workspaceRoot });
      info.push(`\nBranch: ${stdout.trim()}`);
    } catch { }

    return info.join("\n");
  }

  private async getContext(): Promise<string> {
    const tracker = getContextTracker();
    return tracker.buildContextString();
  }

  private async getOpenFiles(): Promise<string> {
    const docs = vscode.workspace.textDocuments
      .filter((d) => d.uri.scheme === "file" && !d.isUntitled);

    if (docs.length === 0) return "No files open";

    return docs
      .map((d) => {
        const rel = path.relative(this.workspaceRoot, d.uri.fsPath);
        const dirty = d.isDirty ? " *" : "";
        return `${rel}${dirty} (${d.languageId})`;
      })
      .join("\n");
  }

  private async getSelection(): Promise<string> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return "No active editor";
    if (editor.selection.isEmpty) return "No selection";

    const text = editor.document.getText(editor.selection);
    return text;
  }

  // ============================================
  // TASKS
  // ============================================

  private async todoWrite(input: ToolInput): Promise<string> {
    const todos = input.todos as Array<{ id: string; content: string; status: string }>;
    const merge = input.merge as boolean;

    if (merge) {
      for (const todo of todos) {
        const idx = taskStore.findIndex((t) => t.id === todo.id);
        if (idx >= 0) taskStore[idx] = { ...taskStore[idx], ...todo };
        else taskStore.push(todo);
      }
    } else {
      taskStore = todos;
    }

    return taskStore
      .map((t) => {
        const icon = t.status === "completed" ? "✅" : t.status === "in_progress" ? "🔄" : t.status === "cancelled" ? "❌" : "⬜";
        return `${icon} [${t.id}] ${t.content}`;
      })
      .join("\n");
  }

  // ============================================
  // BROWSER (via MCP or stub)
  // ============================================

  private async browserNavigate(input: ToolInput): Promise<string> {
    const url = input.url as string;
    // Try MCP first, fall back to opening in default browser
    try {
      const mcp = getMCPManager();
      await mcp.callTool("browser", "browser_navigate", { url });
      return `Navigated to ${url}`;
    } catch {
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return `Opened ${url} in default browser`;
    }
  }

  private async browserSnapshot(): Promise<string> {
    try {
      const mcp = getMCPManager();
      const result = await mcp.callTool("browser", "browser_snapshot", {});
      return result.content.map((c) => c.text || "").join("\n");
    } catch {
      return "Browser MCP not connected. Configure in .claudecode/mcp.json";
    }
  }

  private async browserClick(input: ToolInput): Promise<string> {
    try {
      const mcp = getMCPManager();
      await mcp.callTool("browser", "browser_click", input);
      return `Clicked: ${input.element}`;
    } catch {
      return "Browser MCP not connected";
    }
  }

  private async browserType(input: ToolInput): Promise<string> {
    try {
      const mcp = getMCPManager();
      await mcp.callTool("browser", "browser_type", input);
      return `Typed in: ${input.element}`;
    } catch {
      return "Browser MCP not connected";
    }
  }

  private async browserScreenshot(input: ToolInput): Promise<string> {
    try {
      const mcp = getMCPManager();
      const result = await mcp.callTool("browser", "browser_take_screenshot", input);
      return `Screenshot taken`;
    } catch {
      return "Browser MCP not connected";
    }
  }

  private async browserConsole(): Promise<string> {
    try {
      const mcp = getMCPManager();
      const result = await mcp.callTool("browser", "browser_console_messages", {});
      return result.content.map((c) => c.text || "").join("\n");
    } catch {
      return "Browser MCP not connected";
    }
  }

  private async browserNetwork(): Promise<string> {
    try {
      const mcp = getMCPManager();
      const result = await mcp.callTool("browser", "browser_network_requests", {});
      return result.content.map((c) => c.text || "").join("\n");
    } catch {
      return "Browser MCP not connected";
    }
  }

  // ============================================
  // MCP
  // ============================================

  private async mcpCall(input: ToolInput): Promise<string> {
    const server = input.server as string;
    const tool = input.tool as string;
    const args = (input.arguments as Record<string, unknown>) || {};

    const mcp = getMCPManager();
    try {
      const result = await mcp.callTool(server, tool, args);
      return result.content.map((c) => c.text || "[binary]").join("\n");
    } catch (error) {
      return `MCP error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async mcpListTools(): Promise<string> {
    const mcp = getMCPManager();
    const tools = mcp.getAllTools();

    if (tools.length === 0) {
      return "No MCP tools available. Configure servers in .claudecode/mcp.json";
    }

    return tools
      .map((t) => `[${t.server}] ${t.tool.name}: ${t.tool.description || "No description"}`)
      .join("\n");
  }

  // ============================================
  // CHECKPOINTS
  // ============================================

  private async createCheckpoint(input: ToolInput): Promise<string> {
    const name = input.name as string;
    const id = `checkpoint-${Date.now()}`;

    // Save current state of modified files
    const files = new Map<string, string>();
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === "file" && doc.isDirty) {
        files.set(doc.uri.fsPath, doc.getText());
      }
    }

    checkpoints.push({
      id,
      name,
      timestamp: new Date(),
      files,
    });

    // Keep only last 10 checkpoints
    if (checkpoints.length > 10) {
      checkpoints = checkpoints.slice(-10);
    }

    return `Checkpoint created: ${name} (${id})`;
  }

  private async restoreCheckpoint(input: ToolInput): Promise<string> {
    const id = input.id as string;
    const checkpoint = checkpoints.find((c) => c.id === id);

    if (!checkpoint) return `Checkpoint not found: ${id}`;

    for (const [filePath, content] of checkpoint.files) {
      fs.writeFileSync(filePath, content, "utf-8");
    }

    return `Restored checkpoint: ${checkpoint.name}`;
  }

  private async listCheckpoints(): Promise<string> {
    if (checkpoints.length === 0) return "No checkpoints";

    return checkpoints
      .map((c) => `${c.id}: ${c.name} (${c.timestamp.toISOString()}) - ${c.files.size} files`)
      .join("\n");
  }
}

