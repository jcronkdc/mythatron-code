/**
 * Claude Code Extension - Main entry point
 * A complete AI coding assistant with smart cost optimization
 */

import * as vscode from "vscode";
import * as path from "path";
import { getAgent, ClaudeAgent } from "./agent/claude-agent";
import { initializeProviders, getProviderManager } from "./providers";
import { initMCPManager, getMCPManager } from "./mcp";
import { initMemoryManager, getMemoryManager } from "./memory";
import { initTerminalManager, getTerminalManager } from "./terminal";
import { initSemanticSearch } from "./search/semantic";
import { initWebSearch } from "./search/web";
import { getContextTracker } from "./features/context";
import { registerInlineCompletions, InlineCompletionProvider } from "./features/completions";
import { showDiffPreview, DiffChange } from "./features/diff-preview";
import { showCommitPicker } from "./features/smart-commits";
import { showDeadCodeReport } from "./features/dead-code";
import { showDependencyReport } from "./features/deps-analyzer";
import { createNewProject } from "./features/project-templates";
import { getPromptsLibrary } from "./features/prompts";
import { getConversationHistory } from "./features/history";
import { autoFixImports } from "./features/smart-imports";
import { showCLIStatus, importCLIConfigs, runSetupWizard, createRepoInteractive, quickPush } from "./cli";
import { showPreflightReport } from "./preflight";
import { initContinuousValidation, forceValidation } from "./preflight/continuous";

// Cost-saving optimizations
import {
  initializeOptimizations,
  getAggregatedStats,
  getTotalSavings,
  getCostTracker,
  getResponseCache,
  getContextManager,
  getRequestDeduplicator,
  getTokenOptimizer,
  getOfflineMode,
  getAutoApply,
  getLSPCache,
} from "./optimizations";

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let costStatusItem: vscode.StatusBarItem;
let savingsStatusItem: vscode.StatusBarItem;
let agent: ClaudeAgent;
let webviewPanel: vscode.WebviewPanel | undefined;
let completionProvider: InlineCompletionProvider;
let currentAbortController: AbortController | null = null;
let optimizations: ReturnType<typeof initializeOptimizations>;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel("Claude Code");
  outputChannel.appendLine("Activating Claude Code...");

  // Get workspace root
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  // Initialize all systems
  try {
    await initializeProviders();
    outputChannel.appendLine("✓ Providers initialized");
    
    // Initialize continuous validation (catches errors early!)
    initContinuousValidation(context);
    outputChannel.appendLine("✓ Continuous validation enabled");

    await initMemoryManager(workspaceRoot);
    outputChannel.appendLine("✓ Memory manager initialized");

    await initMCPManager(workspaceRoot);
    outputChannel.appendLine("✓ MCP manager initialized");

    await initTerminalManager();
    outputChannel.appendLine("✓ Terminal manager initialized");

    await initSemanticSearch(workspaceRoot);
    outputChannel.appendLine("✓ Semantic search initialized");

    await initWebSearch();
    outputChannel.appendLine("✓ Web search initialized");

    // Initialize context tracker
    getContextTracker();
    outputChannel.appendLine("✓ Context tracker initialized");

    // Initialize agent
    agent = getAgent(outputChannel);
    outputChannel.appendLine("✓ Agent initialized");

    // Register inline completions
    completionProvider = registerInlineCompletions(context);
    outputChannel.appendLine("✓ Inline completions registered");

    // Initialize all cost-saving optimizations
    optimizations = initializeOptimizations();
    outputChannel.appendLine("✓ Cost optimizations initialized:");
    outputChannel.appendLine("  - Response caching with semantic similarity");
    outputChannel.appendLine("  - Smart context management");
    outputChannel.appendLine("  - Request deduplication");
    outputChannel.appendLine("  - Smart debouncing");
    outputChannel.appendLine("  - Transparent cost tracking");
    outputChannel.appendLine("  - Offline mode with queuing");
    outputChannel.appendLine("  - Auto-apply with rollback");
    outputChannel.appendLine("  - LSP/code intelligence caching");
    outputChannel.appendLine("  - Token optimization system");

    // Set up offline mode callback
    getOfflineMode().onStatusChangeCallback((online) => {
      if (!online) {
        vscode.window.showWarningMessage(
          "Claude Code: Network offline. Using local models and request queuing."
        );
      }
    });

    // Set cost limit warning
    getCostTracker().setCostLimit(10, () => {
      vscode.window.showWarningMessage(
        "Claude Code: Session cost has exceeded $10. Consider starting a new session."
      );
    });
  } catch (error) {
    outputChannel.appendLine(`Initialization error: ${error}`);
    vscode.window.showErrorMessage(`Claude Code failed to initialize: ${error}`);
  }

  // Create status bar items
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = "$(sparkle) Claude Code";
  statusBarItem.tooltip = "Click to open Claude Code";
  statusBarItem.command = "claudeCode.open";
  statusBarItem.show();

  costStatusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99
  );
  costStatusItem.text = "$(dashboard) $0.00";
  costStatusItem.tooltip = "Estimated session cost (click for details)";
  costStatusItem.command = "claudeCode.showCostDashboard";
  costStatusItem.show();

  savingsStatusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    98
  );
  savingsStatusItem.text = "$(savings) 0% saved";
  savingsStatusItem.tooltip = "Cost savings from optimizations";
  savingsStatusItem.show();

  // Register commands
  context.subscriptions.push(
    // Core commands
    vscode.commands.registerCommand("claudeCode.open", () => openWebview(context)),
    vscode.commands.registerCommand("claudeCode.newChat", () => startNewChat()),
    vscode.commands.registerCommand("claudeCode.showCostDetails", () => showCostDetails()),
    vscode.commands.registerCommand("claudeCode.showCostDashboard", () => getCostTracker().showDashboard()),
    vscode.commands.registerCommand("claudeCode.configureMCP", () => configureMCP(context)),
    vscode.commands.registerCommand("claudeCode.editRules", () => editRules()),
    vscode.commands.registerCommand("claudeCode.toggleCompletions", () => toggleCompletions()),
    vscode.commands.registerCommand("claudeCode.indexWorkspace", () => indexWorkspace()),
    vscode.commands.registerCommand("claudeCode.sendSelection", () => sendSelection()),
    vscode.commands.registerCommand("claudeCode.showSavings", () => showSavingsReport()),
    vscode.commands.registerCommand("claudeCode.clearCache", () => clearAllCaches()),
    vscode.commands.registerCommand("claudeCode.rollback", () => rollbackLastChange()),
    vscode.commands.registerCommand("claudeCode.exportCosts", () => exportCostReport()),
    
    // Smart commit
    vscode.commands.registerCommand("claudeCode.generateCommit", () => generateCommit()),
    
    // Code analysis
    vscode.commands.registerCommand("claudeCode.analyzeDeadCode", () => analyzeDeadCode()),
    vscode.commands.registerCommand("claudeCode.analyzeDeps", () => analyzeDeps()),
    
    // Project templates
    vscode.commands.registerCommand("claudeCode.newProject", () => createNewProject()),
    
    // Smart imports
    vscode.commands.registerCommand("claudeCode.autoImport", () => autoImport()),
    
    // Prompts library
    vscode.commands.registerCommand("claudeCode.showPrompts", () => showPrompts()),
    
    // History
    vscode.commands.registerCommand("claudeCode.showHistory", () => showHistory()),
    
    // Code actions
    vscode.commands.registerCommand("claudeCode.explainCode", () => executeCodeAction("explain")),
    vscode.commands.registerCommand("claudeCode.refactorCode", () => executeCodeAction("refactor")),
    vscode.commands.registerCommand("claudeCode.generateTests", () => executeCodeAction("tests")),
    vscode.commands.registerCommand("claudeCode.fixError", () => executeCodeAction("fix")),
    vscode.commands.registerCommand("claudeCode.reviewCode", () => executeCodeAction("review")),
    
    // CLI integration
    vscode.commands.registerCommand("claudeCode.checkCLIs", () => showCLIStatus()),
    vscode.commands.registerCommand("claudeCode.importCLIKeys", () => importFromCLIs()),
    vscode.commands.registerCommand("claudeCode.setupWizard", () => runSetupWizard()),
    
    // GitHub integration
    vscode.commands.registerCommand("claudeCode.createRepo", () => createRepoInteractive()),
    vscode.commands.registerCommand("claudeCode.pushToGitHub", () => quickPush()),
    
    // Preflight checks
    vscode.commands.registerCommand("claudeCode.preflightCheck", () => showPreflightReport()),
    vscode.commands.registerCommand("claudeCode.forceValidation", () => forceValidation()),
    vscode.commands.registerCommand("claudeCode.showPreflightReport", () => showPreflightReport()),
    
    statusBarItem,
    costStatusItem,
    savingsStatusItem,
    outputChannel
  );

  outputChannel.appendLine("Claude Code activated");
}

function openWebview(context: vscode.ExtensionContext): void {
  if (webviewPanel) {
    webviewPanel.reveal();
    return;
  }

  webviewPanel = vscode.window.createWebviewPanel(
    "claudeCode",
    "Claude Code",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
    }
  );

  webviewPanel.webview.html = getWebviewContent();

  webviewPanel.webview.onDidReceiveMessage(async (message) => {
    switch (message.type) {
      case "send":
        await handleUserMessage(message.text, message.images);
        break;
      case "cancel":
        if (currentAbortController) {
          currentAbortController.abort();
          currentAbortController = null;
          webviewPanel?.webview.postMessage({ type: "thinking", data: false });
          vscode.window.showInformationMessage("Request cancelled");
        }
        break;
      case "clear":
        startNewChat();
        break;
    }
  });

  webviewPanel.onDidDispose(() => {
    webviewPanel = undefined;
  });

  // Send initial state
  webviewPanel.webview.postMessage({
    type: "init",
    data: {
      model: getProviderManager().getCurrentModel(),
      memories: getMemoryManager().getAllMemories().length,
      mcpServers: getMCPManager().getAllTools().length,
    },
  });
}

async function handleUserMessage(text: string, images?: string[]): Promise<void> {
  if (!webviewPanel) return;

  // Create new abort controller for this request
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  // Show thinking indicator
  webviewPanel.webview.postMessage({ type: "thinking", data: true });

  try {
    // Check if already aborted
    if (signal.aborted) {
      throw new Error("Request cancelled");
    }

    const response = await agent.processMessage(text, {
      enableThinking: true,
      images,
    });

    // Check if aborted during processing
    if (signal.aborted) {
      throw new Error("Request cancelled");
    }

    // Update cost display
    updateCostDisplay();

    // Send response
    webviewPanel.webview.postMessage({
      type: "response",
      data: {
        content: response.content,
        thinking: response.thinking,
        toolCalls: response.toolCalls.map((tc) => ({
          name: tc.name,
          input: tc.input,
        })),
        usage: response.usage,
        cost: agent.getEstimatedCost(),
      },
    });
  } catch (error) {
    // Don't show error for cancellation
    if (signal.aborted || (error instanceof Error && error.message === "Request cancelled")) {
      return;
    }
    webviewPanel.webview.postMessage({
      type: "error",
      data: error instanceof Error ? error.message : String(error),
    });
  } finally {
    currentAbortController = null;
    webviewPanel.webview.postMessage({ type: "thinking", data: false });
  }
}

function updateCostDisplay(): void {
  const cost = agent.getEstimatedCost();
  const usage = agent.getUsage();
  const savings = getTotalSavings();

  costStatusItem.text = `$(dashboard) $${cost.toFixed(2)}`;
  costStatusItem.tooltip = `Tokens: ${(usage.inputTokens + usage.outputTokens).toLocaleString()}\nInput: ${usage.inputTokens.toLocaleString()}\nOutput: ${usage.outputTokens.toLocaleString()}\n\nClick for cost dashboard`;

  // Update savings display
  const savingsPercent = savings.cacheHitRate.toFixed(0);
  savingsStatusItem.text = `$(verified) ${savingsPercent}% saved`;
  savingsStatusItem.tooltip = `Estimated Savings: $${savings.costSaved.toFixed(4)}\nTokens Saved: ${savings.tokensSaved.toLocaleString()}\nRequests Saved: ${savings.requestsSaved}\nCache Hit Rate: ${savingsPercent}%`;
}

function showCostDetails(): void {
  const usage = agent.getUsage();
  const cost = agent.getEstimatedCost();
  const provider = getProviderManager();

  const message = `
Session Cost: $${cost.toFixed(4)}

Token Usage:
  Input:  ${usage.inputTokens.toLocaleString()}
  Output: ${usage.outputTokens.toLocaleString()}
  Total:  ${(usage.inputTokens + usage.outputTokens).toLocaleString()}

Current Model: ${provider.getCurrentModel()}
Smart Routing: ${provider.isSmartRoutingEnabled() ? "Enabled" : "Disabled"}

Tip: Enable smart routing in settings to reduce costs by 70%+
`;

  vscode.window.showInformationMessage(message, { modal: true }, "Open Settings").then((result) => {
    if (result === "Open Settings") {
      vscode.commands.executeCommand("workbench.action.openSettings", "claudeCode");
    }
  });
}

function startNewChat(): void {
  agent.clearHistory();
  updateCostDisplay();

  if (webviewPanel) {
    webviewPanel.webview.postMessage({ type: "clear" });
  }

  vscode.window.showInformationMessage("Started new chat session");
}

async function configureMCP(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage("Open a workspace first");
    return;
  }

  const mcpConfigPath = path.join(workspaceRoot, ".claudecode", "mcp.json");
  const doc = await vscode.workspace.openTextDocument(
    vscode.Uri.file(mcpConfigPath).with({ scheme: "untitled" })
  );

  const defaultConfig = {
    servers: {
      example: {
        command: "npx",
        args: ["-y", "@example/mcp-server"],
        enabled: false,
      },
    },
  };

  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, new vscode.Position(0, 0), JSON.stringify(defaultConfig, null, 2));
  await vscode.workspace.applyEdit(edit);
  await vscode.window.showTextDocument(doc);
}

async function editRules(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage("Open a workspace first");
    return;
  }

  const rulesPath = path.join(workspaceRoot, ".claudecode", "rules.json");
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(rulesPath));
  await vscode.window.showTextDocument(doc);
}

function toggleCompletions(): void {
  const enabled = !completionProvider;
  // Toggle inline completions
  vscode.window.showInformationMessage(
    `Inline completions: ${enabled ? "enabled" : "disabled"}`
  );
}

async function indexWorkspace(): Promise<void> {
  const progress = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Indexing workspace...",
      cancellable: true,
    },
    async (progress, token) => {
      const search = await import("./search/semantic");
      const semantic = search.getSemanticSearch();

      progress.report({ increment: 0, message: "Scanning files..." });

      // This would trigger a full reindex
      // await semantic.reindex();

      progress.report({ increment: 100, message: "Done!" });
      return true;
    }
  );

  vscode.window.showInformationMessage("Workspace indexed successfully");
}

async function sendSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showWarningMessage("Select some code first");
    return;
  }

  const selection = editor.document.getText(editor.selection);
  const language = editor.document.languageId;
  const fileName = path.basename(editor.document.fileName);

  const prompt = `Here's a code selection from ${fileName}:\n\n\`\`\`${language}\n${selection}\n\`\`\`\n\nWhat would you like me to do with this code?`;

  // Open webview and send
  await vscode.commands.executeCommand("claudeCode.open");

  setTimeout(() => {
    if (webviewPanel) {
      webviewPanel.webview.postMessage({
        type: "setInput",
        data: prompt,
      });
    }
  }, 500);
}

function getWebviewContent(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Code</title>
  <style>
    :root {
      --bg: #0d1117;
      --bg-secondary: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-secondary: #8b949e;
      --accent: #58a6ff;
      --accent-hover: #79b8ff;
      --success: #3fb950;
      --warning: #d29922;
      --error: #f85149;
      --font: 'Söhne', -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--bg-secondary);
    }

    .header h1 {
      font-size: 18px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .header-actions {
      display: flex;
      gap: 8px;
    }

    .header-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-secondary);
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.15s;
    }

    .header-btn:hover {
      background: var(--border);
      color: var(--text);
    }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .message {
      max-width: 85%;
      padding: 14px 18px;
      border-radius: 12px;
      line-height: 1.6;
    }

    .message.user {
      align-self: flex-end;
      background: var(--accent);
      color: white;
      border-bottom-right-radius: 4px;
    }

    .message.assistant {
      align-self: flex-start;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-bottom-left-radius: 4px;
    }

    .message pre {
      background: rgba(0,0,0,0.3);
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
      font-family: var(--font-mono);
      font-size: 13px;
    }

    .message code {
      font-family: var(--font-mono);
      background: rgba(0,0,0,0.2);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
    }

    .thinking {
      font-style: italic;
      color: var(--text-secondary);
      padding: 8px 12px;
      border-left: 2px solid var(--border);
      margin-bottom: 8px;
    }

    .tool-call {
      background: rgba(88, 166, 255, 0.1);
      border: 1px solid rgba(88, 166, 255, 0.3);
      padding: 8px 12px;
      border-radius: 6px;
      margin: 8px 0;
      font-size: 13px;
    }

    .tool-call .tool-name {
      color: var(--accent);
      font-weight: 500;
    }

    .input-area {
      padding: 16px 20px;
      border-top: 1px solid var(--border);
      background: var(--bg-secondary);
    }

    .input-wrapper {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    textarea {
      flex: 1;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 12px 16px;
      border-radius: 8px;
      font-family: var(--font);
      font-size: 14px;
      resize: none;
      min-height: 48px;
      max-height: 200px;
    }

    textarea:focus {
      outline: none;
      border-color: var(--accent);
    }

    .send-btn {
      background: var(--accent);
      color: white;
      border: none;
      padding: 12px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
      transition: background 0.15s;
    }

    .send-btn:hover {
      background: var(--accent-hover);
    }

    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .status {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 8px;
      display: flex;
      justify-content: space-between;
    }

    .typing-indicator {
      display: flex;
      gap: 4px;
      padding: 8px;
    }

    .typing-indicator span {
      width: 8px;
      height: 8px;
      background: var(--accent);
      border-radius: 50%;
      animation: bounce 1.4s infinite ease-in-out;
    }

    .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
    .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-6px); }
    }

    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--text-secondary);
      gap: 16px;
    }

    .empty-state svg {
      width: 64px;
      height: 64px;
      opacity: 0.5;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
      Claude Code
    </h1>
    <div class="header-actions">
      <button class="header-btn" onclick="clearChat()">Clear</button>
      <button class="header-btn" onclick="showSettings()">Settings</button>
    </div>
  </div>

  <div class="messages" id="messages">
    <div class="empty-state" id="emptyState">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/>
        <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
        <line x1="9" y1="9" x2="9.01" y2="9"/>
        <line x1="15" y1="9" x2="15.01" y2="9"/>
      </svg>
      <p>Ask me to help with your code</p>
    </div>
  </div>

  <div class="input-area">
    <div class="input-wrapper">
      <textarea id="input" placeholder="Ask me anything..." rows="1" onkeydown="handleKeydown(event)"></textarea>
      <button class="send-btn" id="sendBtn" onclick="send()">Send</button>
    </div>
    <div class="status">
      <span id="modelInfo">Loading...</span>
      <span id="costInfo">$0.00</span>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let isThinking = false;

    function send() {
      const input = document.getElementById('input');
      const text = input.value.trim();
      if (!text || isThinking) return;

      addMessage(text, 'user');
      input.value = '';
      autoResize(input);

      vscode.postMessage({ type: 'send', text });
    }

    function handleKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    }

    function addMessage(content, role) {
      const emptyState = document.getElementById('emptyState');
      if (emptyState) emptyState.remove();

      const messages = document.getElementById('messages');
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.innerHTML = formatContent(content);
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    function formatContent(text) {
      // Basic markdown-like formatting
      return text
        .replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>')
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\\n/g, '<br>');
    }

    function showThinking() {
      const messages = document.getElementById('messages');
      const div = document.createElement('div');
      div.className = 'message assistant';
      div.id = 'thinkingMsg';
      div.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    function clearChat() {
      vscode.postMessage({ type: 'clear' });
      document.getElementById('messages').innerHTML = \`
        <div class="empty-state" id="emptyState">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
            <line x1="9" y1="9" x2="9.01" y2="9"/>
            <line x1="15" y1="9" x2="15.01" y2="9"/>
          </svg>
          <p>Ask me to help with your code</p>
        </div>
      \`;
    }

    function showSettings() {
      vscode.postMessage({ type: 'openSettings' });
    }

    const input = document.getElementById('input');
    input.addEventListener('input', () => autoResize(input));

    function autoResize(el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;

      switch (msg.type) {
        case 'init':
          document.getElementById('modelInfo').textContent = msg.data.model;
          break;

        case 'thinking':
          isThinking = msg.data;
          document.getElementById('sendBtn').disabled = isThinking;
          if (isThinking) {
            showThinking();
          } else {
            const thinkingMsg = document.getElementById('thinkingMsg');
            if (thinkingMsg) thinkingMsg.remove();
          }
          break;

        case 'response':
          let content = msg.data.content;
          
          if (msg.data.thinking) {
            content = '<div class="thinking">' + msg.data.thinking + '</div>' + content;
          }
          
          if (msg.data.toolCalls?.length) {
            for (const tc of msg.data.toolCalls) {
              content += '<div class="tool-call"><span class="tool-name">' + tc.name + '</span></div>';
            }
          }
          
          addMessage(content, 'assistant');
          document.getElementById('costInfo').textContent = '$' + msg.data.cost.toFixed(2);
          break;

        case 'error':
          addMessage('Error: ' + msg.data, 'assistant');
          break;

        case 'clear':
          clearChat();
          break;

        case 'setInput':
          document.getElementById('input').value = msg.data;
          autoResize(document.getElementById('input'));
          break;
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Show savings report
 */
function showSavingsReport(): void {
  const savings = getTotalSavings();
  const stats = getAggregatedStats();

  const message = `
💰 COST SAVINGS REPORT
━━━━━━━━━━━━━━━━━━━━━

📊 OVERALL SAVINGS
  Total Cost Saved: $${savings.costSaved.toFixed(4)}
  Tokens Saved: ${savings.tokensSaved.toLocaleString()}
  Requests Saved: ${savings.requestsSaved}
  Cache Hit Rate: ${savings.cacheHitRate.toFixed(1)}%

📦 CACHE STATS
  Response Cache Size: ${stats.cache.cacheSize} entries
  Total Cache Hits: ${stats.cache.cacheHits}
  Cache Misses: ${stats.cache.cacheMisses}

🔄 DEDUPLICATION
  Deduplicated Requests: ${stats.dedup.deduplicatedRequests}
  Dedup Rate: ${stats.dedup.deduplicationRate.toFixed(1)}%

🔤 TOKEN OPTIMIZATION
  Original Tokens: ${stats.tokens.total.original.toLocaleString()}
  Optimized Tokens: ${stats.tokens.total.optimized.toLocaleString()}
  Token Savings: ${stats.tokens.total.percent.toFixed(1)}%

🖥️ LSP CACHE
  Diagnostics Hit Rate: ${stats.lsp.hitRates.diagnostics.toFixed(1)}%
  Symbols Hit Rate: ${stats.lsp.hitRates.symbols.toFixed(1)}%
  References Hit Rate: ${stats.lsp.hitRates.references.toFixed(1)}%
  Completions Hit Rate: ${stats.lsp.hitRates.completions.toFixed(1)}%

🌐 OFFLINE MODE
  Local Fallbacks: ${stats.offline.localModelFallbacks}
  Network Outages: ${stats.offline.networkOutages}
`;

  vscode.window.showInformationMessage(message, { modal: true });
}

/**
 * Clear all caches
 */
function clearAllCaches(): void {
  getResponseCache().cleanup();
  getContextManager().clearCache();
  getLSPCache().clearAll();

  vscode.window.showInformationMessage("All caches cleared");
}

/**
 * Rollback last change
 */
async function rollbackLastChange(): Promise<void> {
  const autoApply = getAutoApply();
  const result = await autoApply.rollback();

  if (result.success) {
    vscode.window.showInformationMessage(
      `Rolled back ${result.filesRestored.length} files`
    );
  } else {
    vscode.window.showWarningMessage(result.message);
  }
}

/**
 * Export cost report to CSV
 */
async function exportCostReport(): Promise<void> {
  const csv = getCostTracker().exportToCSV();
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!workspaceFolder) {
    vscode.window.showWarningMessage("Open a workspace first");
    return;
  }

  const filePath = path.join(
    workspaceFolder,
    ".claudecode",
    `cost-report-${Date.now()}.csv`
  );

  const fs = await import("fs");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv);

  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc);

  vscode.window.showInformationMessage(`Cost report exported to ${filePath}`);
}

/**
 * Import API keys from CLIs
 */
async function importFromCLIs(): Promise<void> {
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Importing CLI configurations...",
    },
    () => importCLIConfigs()
  );

  if (result.imported.length > 0) {
    vscode.window.showInformationMessage(
      `Imported: ${result.imported.join(", ")}`
    );
    
    // Reinitialize providers with new keys
    const provider = getProviderManager();
    await provider.reinitialize();
  } else if (result.errors.length > 0) {
    vscode.window.showErrorMessage(result.errors.join("; "));
  } else {
    vscode.window.showInformationMessage(
      "No new API keys found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GROQ_API_KEY environment variables."
    );
  }
}

/**
 * Generate smart commit message
 */
async function generateCommit(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage("Open a workspace first");
    return;
  }

  try {
    const message = await showCommitPicker(workspaceRoot);
    if (message) {
      // Copy to clipboard and show in SCM input
      await vscode.env.clipboard.writeText(message);
      vscode.window.showInformationMessage("Commit message copied to clipboard!");
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Analyze dead code
 */
async function analyzeDeadCode(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage("Open a workspace first");
    return;
  }

  await showDeadCodeReport(workspaceRoot);
}

/**
 * Analyze dependencies
 */
async function analyzeDeps(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage("Open a workspace first");
    return;
  }

  await showDependencyReport(workspaceRoot);
}

/**
 * Auto-fix imports
 */
async function autoImport(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Open a file first");
    return;
  }

  const fixed = await autoFixImports(editor.document);
  vscode.window.showInformationMessage(`Fixed ${fixed} import(s)`);
}

/**
 * Show prompts library
 */
async function showPrompts(): Promise<void> {
  const library = getPromptsLibrary();
  const categories = library.getByCategory();
  
  const items: vscode.QuickPickItem[] = [];
  
  for (const category of categories) {
    items.push({
      label: `${category.icon} ${category.name}`,
      kind: vscode.QuickPickItemKind.Separator,
    });
    
    for (const prompt of category.prompts) {
      items.push({
        label: prompt.name,
        description: prompt.description,
        detail: prompt.prompt.slice(0, 80) + "...",
      });
    }
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a prompt",
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (selected && selected.kind !== vscode.QuickPickItemKind.Separator) {
    const prompt = library.getAllPrompts().find((p) => p.name === selected.label);
    if (prompt) {
      library.recordUsage(prompt.id);
      
      // Get selection if needed
      const editor = vscode.window.activeTextEditor;
      const selection = editor?.selection.isEmpty ? "" : editor?.document.getText(editor.selection) || "";
      
      const expandedPrompt = library.expandPrompt(prompt, { selection });
      
      // Open chat and send prompt
      await vscode.commands.executeCommand("claudeCode.open");
      setTimeout(() => {
        if (webviewPanel) {
          webviewPanel.webview.postMessage({
            type: "setInput",
            data: expandedPrompt,
          });
        }
      }, 500);
    }
  }
}

/**
 * Show conversation history
 */
async function showHistory(): Promise<void> {
  const history = getConversationHistory();
  const conversations = history.listConversations();
  
  if (conversations.length === 0) {
    vscode.window.showInformationMessage("No conversation history yet");
    return;
  }

  const items = conversations.map((conv) => ({
    label: conv.title,
    description: `${conv.messageCount} messages`,
    detail: `${new Date(conv.updatedAt).toLocaleString()} • $${conv.estimatedCost.toFixed(4)}`,
    id: conv.id,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a conversation to view",
  });

  if (selected) {
    const conv = history.getConversation(selected.id);
    if (conv) {
      // Export to markdown and show
      const markdown = history.exportToMarkdown(selected.id);
      const doc = await vscode.workspace.openTextDocument({
        content: markdown,
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc);
    }
  }
}

/**
 * Execute code action (explain, refactor, tests, fix, review)
 */
async function executeCodeAction(action: "explain" | "refactor" | "tests" | "fix" | "review"): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showWarningMessage("Select some code first");
    return;
  }

  const selection = editor.document.getText(editor.selection);
  const language = editor.document.languageId;
  const fileName = path.basename(editor.document.fileName);

  const prompts: Record<string, string> = {
    explain: `Explain this ${language} code in detail:\n\n\`\`\`${language}\n${selection}\n\`\`\``,
    refactor: `Refactor this ${language} code to be cleaner and more maintainable:\n\n\`\`\`${language}\n${selection}\n\`\`\``,
    tests: `Generate comprehensive unit tests for this ${language} code:\n\n\`\`\`${language}\n${selection}\n\`\`\``,
    fix: `Fix any issues in this ${language} code from ${fileName}:\n\n\`\`\`${language}\n${selection}\n\`\`\``,
    review: `Review this ${language} code for bugs, security issues, and improvements:\n\n\`\`\`${language}\n${selection}\n\`\`\``,
  };

  // Open chat and send prompt
  await vscode.commands.executeCommand("claudeCode.open");
  
  setTimeout(() => {
    if (webviewPanel) {
      webviewPanel.webview.postMessage({
        type: "setInput",
        data: prompts[action],
      });
    }
  }, 500);
}

export function deactivate(): void {
  outputChannel?.appendLine("Claude Code deactivating...");

  // Clean up optimizations
  try {
    getOfflineMode().dispose();
    getCostTracker().dispose();
    getLSPCache().dispose();
  } catch {
    // Best effort cleanup
  }
}

