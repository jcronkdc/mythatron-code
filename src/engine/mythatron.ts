/**
 * ███╗   ███╗██╗   ██╗████████╗██╗  ██╗ █████╗ ████████╗██████╗  ██████╗ ███╗   ██╗
 * ████╗ ████║╚██╗ ██╔╝╚══██╔══╝██║  ██║██╔══██╗╚══██╔══╝██╔══██╗██╔═══██╗████╗  ██║
 * ██╔████╔██║ ╚████╔╝    ██║   ███████║███████║   ██║   ██████╔╝██║   ██║██╔██╗ ██║
 * ██║╚██╔╝██║  ╚██╔╝     ██║   ██╔══██║██╔══██║   ██║   ██╔══██╗██║   ██║██║╚██╗██║
 * ██║ ╚═╝ ██║   ██║      ██║   ██║  ██║██║  ██║   ██║   ██║  ██║╚██████╔╝██║ ╚████║
 * ╚═╝     ╚═╝   ╚═╝      ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
 *
 * The MythaTron Engine
 * ====================
 * Build applications, websites, and software BETTER, FASTER, and CHEAPER
 * than any other tool on the market.
 *
 * Core Principles:
 * 1. EFFICIENCY FIRST - Every token counts, every second matters
 * 2. QUALITY BY DEFAULT - Validate continuously, catch errors early
 * 3. INTELLIGENT ROUTING - Right model for the right task
 * 4. ZERO WASTE - Cache everything, duplicate nothing
 */

import * as path from "path";
import * as vscode from "vscode";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

export interface MythaTronConfig {
  // AI Providers
  anthropicKey?: string;
  openaiKey?: string;
  groqKey?: string;
  ollamaUrl: string;

  // Behavior
  smartRouting: boolean;
  aggressiveCaching: boolean;
  continuousValidation: boolean;
  autoFix: boolean;

  // Limits
  maxTokensPerRequest: number;
  maxCostPerSession: number;
  maxIterations: number;
}

export interface TaskRequest {
  id: string;
  type: "chat" | "code" | "refactor" | "debug" | "explain" | "create";
  prompt: string;
  context?: TaskContext;
  options?: TaskOptions;
}

export interface TaskContext {
  files?: string[];
  selection?: { file: string; start: number; end: number; text: string };
  errors?: { file: string; line: number; message: string }[];
  gitStatus?: { staged: string[]; modified: string[]; untracked: string[] };
}

export interface TaskOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  thinking?: boolean;
}

export interface TaskResult {
  id: string;
  success: boolean;
  content: string;
  thinking?: string;
  actions?: TaskAction[];
  usage: { inputTokens: number; outputTokens: number; cost: number };
  timing: { started: number; completed: number; duration: number };
  cached: boolean;
  model: string;
  savings: number;
}

export interface TaskAction {
  type: "file_edit" | "file_create" | "file_delete" | "terminal" | "message";
  file?: string;
  content?: string;
  diff?: string;
  command?: string;
  applied: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE MYTHATRON ENGINE
// ═══════════════════════════════════════════════════════════════════════════

export class MythaTronEngine {
  private config: MythaTronConfig;
  private sessionId: string;
  private taskQueue: TaskRequest[] = [];
  private completedTasks: Map<string, TaskResult> = new Map();
  private responseCache: Map<string, { result: TaskResult; expiry: number }> =
    new Map();

  // Metrics
  private metrics = {
    tasksCompleted: 0,
    tokensUsed: 0,
    tokensSaved: 0,
    totalCost: 0,
    totalSavings: 0,
    cacheHits: 0,
    errorsFixed: 0,
    filesModified: 0,
  };

  constructor(config: Partial<MythaTronConfig> = {}) {
    this.config = {
      ollamaUrl: "http://localhost:11434",
      smartRouting: true,
      aggressiveCaching: true,
      continuousValidation: true,
      autoFix: true,
      maxTokensPerRequest: 8192,
      maxCostPerSession: 10,
      maxIterations: 25,
      ...config,
    };

    this.sessionId = this.generateId();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Process a task request
   */
  async process(request: TaskRequest): Promise<TaskResult> {
    const startTime = Date.now();

    // 1. Check cache first (ZERO WASTE principle)
    const cached = this.checkCache(request);
    if (cached) {
      this.metrics.cacheHits++;
      return cached;
    }

    // 2. Select optimal model (INTELLIGENT ROUTING)
    const model = this.selectModel(request);

    // 3. Build optimized context (EFFICIENCY FIRST)
    const context = await this.buildContext(request);

    // 4. Execute with validation (QUALITY BY DEFAULT)
    const result = await this.execute(request, model, context);

    // 5. Apply actions if auto-fix enabled
    if (this.config.autoFix && result.actions) {
      await this.applyActions(result.actions);
    }

    // 6. Cache result
    this.cacheResult(request, result);

    // 7. Update metrics
    this.updateMetrics(result);

    return result;
  }

  /**
   * Quick chat - simple questions, explanations
   */
  async chat(prompt: string): Promise<string> {
    const result = await this.process({
      id: this.generateId(),
      type: "chat",
      prompt,
    });
    return result.content;
  }

  /**
   * Generate code from description
   */
  async generate(
    description: string,
    options?: { language?: string; framework?: string }
  ): Promise<TaskResult> {
    return this.process({
      id: this.generateId(),
      type: "create",
      prompt: this.buildGenerationPrompt(description, options),
      options: { thinking: true },
    });
  }

  /**
   * Fix errors in current file
   */
  async fix(
    errors?: { file: string; line: number; message: string }[]
  ): Promise<TaskResult> {
    const currentErrors = errors || (await this.getCurrentErrors());

    return this.process({
      id: this.generateId(),
      type: "debug",
      prompt: "Fix these errors",
      context: { errors: currentErrors },
      options: { thinking: true },
    });
  }

  /**
   * Refactor selected code
   */
  async refactor(code: string, instructions?: string): Promise<TaskResult> {
    return this.process({
      id: this.generateId(),
      type: "refactor",
      prompt:
        instructions ||
        "Refactor this code to be cleaner and more maintainable",
      context: {
        selection: {
          file: vscode.window.activeTextEditor?.document.fileName || "",
          start: 0,
          end: code.length,
          text: code,
        },
      },
    });
  }

  /**
   * Explain code
   */
  async explain(code: string): Promise<string> {
    const result = await this.process({
      id: this.generateId(),
      type: "explain",
      prompt: "Explain this code in detail",
      context: {
        selection: {
          file: vscode.window.activeTextEditor?.document.fileName || "",
          start: 0,
          end: code.length,
          text: code,
        },
      },
    });
    return result.content;
  }

  /**
   * Build entire project from description
   */
  async buildProject(description: string): Promise<TaskResult[]> {
    const results: TaskResult[] = [];

    // Phase 1: Plan
    const plan = await this.process({
      id: this.generateId(),
      type: "chat",
      prompt: `Plan the file structure and architecture for: ${description}`,
      options: { thinking: true },
    });
    results.push(plan);

    // Phase 2: Generate files (would be expanded with actual implementation)
    // This would iterate through the plan and create each file

    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INTELLIGENT ROUTING
  // ─────────────────────────────────────────────────────────────────────────

  private selectModel(request: TaskRequest): string {
    if (!this.config.smartRouting) {
      return "claude-sonnet-4-20250514";
    }

    const prompt = request.prompt.toLowerCase();
    const type = request.type;

    // TIER 0: Ollama (FREE) - Simple tasks
    if (
      type === "chat" ||
      type === "explain" ||
      prompt.length < 100 ||
      /^(what|how|explain|list|show)\s/i.test(prompt) ||
      /fix\s+(typo|spelling|indent)/i.test(prompt)
    ) {
      return "ollama:qwen2.5-coder:7b";
    }

    // TIER 1: Groq (very fast, cheap) - Code generation
    if (type === "create" || /^(create|write|generate|add)\s/i.test(prompt)) {
      return "groq:llama-3.1-70b-versatile";
    }

    // TIER 2: Claude Sonnet - Refactoring, debugging
    if (
      type === "refactor" ||
      type === "debug" ||
      /refactor|debug|fix|review/i.test(prompt)
    ) {
      return "claude-sonnet-4-20250514";
    }

    // TIER 3: Claude Opus - Complex architecture
    if (/architect|design|security|migration|critical/i.test(prompt)) {
      return "claude-opus-4-20250514";
    }

    // Default to Sonnet
    return "claude-sonnet-4-20250514";
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONTEXT OPTIMIZATION
  // ─────────────────────────────────────────────────────────────────────────

  private async buildContext(request: TaskRequest): Promise<string> {
    const parts: string[] = [];

    // Add selection if present
    if (request.context?.selection) {
      const { file, text } = request.context.selection;
      const lang = this.getLanguage(file);
      parts.push(`\`\`\`${lang}\n${text}\n\`\`\``);
    }

    // Add errors if debugging
    if (request.context?.errors?.length) {
      parts.push(
        "Errors:\n" +
          request.context.errors
            .map((e) => `- ${e.file}:${e.line}: ${e.message}`)
            .join("\n")
      );
    }

    // Add minimal file context (only what's needed)
    if (request.context?.files?.length) {
      // Only include first 3 most relevant files to save tokens
      const relevantFiles = request.context.files.slice(0, 3);
      for (const file of relevantFiles) {
        try {
          const doc = await vscode.workspace.openTextDocument(file);
          const content = doc.getText();
          // Truncate large files
          const truncated =
            content.length > 2000
              ? content.slice(0, 2000) + "\n// ... truncated ..."
              : content;
          parts.push(
            `File: ${path.basename(file)}\n\`\`\`${this.getLanguage(
              file
            )}\n${truncated}\n\`\`\``
          );
        } catch {
          // Skip unreadable files
        }
      }
    }

    return parts.join("\n\n");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXECUTION
  // ─────────────────────────────────────────────────────────────────────────

  private async execute(
    request: TaskRequest,
    model: string,
    context: string
  ): Promise<TaskResult> {
    const startTime = Date.now();

    // Build full prompt
    const fullPrompt = context
      ? `${request.prompt}\n\n${context}`
      : request.prompt;

    // This would call the actual LLM provider
    // For now, return a placeholder
    const response = await this.callModel(model, fullPrompt, request.options);

    const endTime = Date.now();

    return {
      id: request.id,
      success: true,
      content: response.content,
      thinking: response.thinking,
      actions: this.parseActions(response.content),
      usage: response.usage,
      timing: {
        started: startTime,
        completed: endTime,
        duration: endTime - startTime,
      },
      cached: false,
      model,
      savings: this.calculateSavings(model, response.usage),
    };
  }

  private async callModel(
    model: string,
    prompt: string,
    options?: TaskOptions
  ): Promise<{
    content: string;
    thinking?: string;
    usage: { inputTokens: number; outputTokens: number; cost: number };
  }> {
    // This would be the actual LLM call
    // For now, placeholder
    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = 500; // Estimate

    return {
      content: "Response placeholder - connect to actual LLM",
      thinking: options?.thinking ? "Thinking placeholder" : undefined,
      usage: {
        inputTokens,
        outputTokens,
        cost: this.calculateCost(model, inputTokens, outputTokens),
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CACHING
  // ─────────────────────────────────────────────────────────────────────────

  private checkCache(request: TaskRequest): TaskResult | null {
    if (!this.config.aggressiveCaching) return null;

    const key = this.generateCacheKey(request);
    const cached = this.responseCache.get(key);

    if (cached && cached.expiry > Date.now()) {
      return { ...cached.result, cached: true };
    }

    return null;
  }

  private cacheResult(request: TaskRequest, result: TaskResult): void {
    if (!this.config.aggressiveCaching) return;

    const key = this.generateCacheKey(request);
    const ttl = this.getCacheTTL(request.type);

    this.responseCache.set(key, {
      result,
      expiry: Date.now() + ttl,
    });
  }

  private generateCacheKey(request: TaskRequest): string {
    const normalized = request.prompt.toLowerCase().replace(/\s+/g, " ").trim();
    return `${request.type}:${normalized}`;
  }

  private getCacheTTL(type: TaskRequest["type"]): number {
    const ttls: Record<TaskRequest["type"], number> = {
      chat: 5 * 60 * 1000, // 5 minutes
      explain: 30 * 60 * 1000, // 30 minutes
      code: 10 * 60 * 1000, // 10 minutes
      refactor: 5 * 60 * 1000, // 5 minutes
      debug: 2 * 60 * 1000, // 2 minutes
      create: 5 * 60 * 1000, // 5 minutes
    };
    return ttls[type] || 5 * 60 * 1000;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACTIONS
  // ─────────────────────────────────────────────────────────────────────────

  private parseActions(content: string): TaskAction[] {
    const actions: TaskAction[] = [];

    // Parse code blocks with file paths
    const codeBlockRegex = /```(\w+)?(?::([^\n]+))?\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      const [, lang, filePath, code] = match;
      if (filePath) {
        actions.push({
          type: "file_edit",
          file: filePath.trim(),
          content: code,
          applied: false,
        });
      }
    }

    return actions;
  }

  private async applyActions(actions: TaskAction[]): Promise<void> {
    for (const action of actions) {
      if (action.type === "file_edit" && action.file && action.content) {
        try {
          const uri = vscode.Uri.file(action.file);
          const edit = new vscode.WorkspaceEdit();

          // Check if file exists
          try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const fullRange = new vscode.Range(
              doc.positionAt(0),
              doc.positionAt(doc.getText().length)
            );
            edit.replace(uri, fullRange, action.content);
          } catch {
            // File doesn't exist, create it
            edit.createFile(uri, { contents: Buffer.from(action.content) });
          }

          await vscode.workspace.applyEdit(edit);
          action.applied = true;
          this.metrics.filesModified++;
        } catch (error) {
          console.error(`Failed to apply action for ${action.file}:`, error);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────────────────────────────────

  private generateId(): string {
    return `mt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private getLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".js": "javascript",
      ".jsx": "javascript",
      ".py": "python",
      ".rs": "rust",
      ".go": "go",
      ".java": "java",
      ".css": "css",
      ".html": "html",
      ".json": "json",
      ".md": "markdown",
    };
    return langMap[ext] || "text";
  }

  private async getCurrentErrors(): Promise<
    { file: string; line: number; message: string }[]
  > {
    const errors: { file: string; line: number; message: string }[] = [];

    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      for (const d of diagnostics) {
        if (d.severity === vscode.DiagnosticSeverity.Error) {
          errors.push({
            file: uri.fsPath,
            line: d.range.start.line + 1,
            message: d.message,
          });
        }
      }
    }

    return errors;
  }

  private buildGenerationPrompt(
    description: string,
    options?: { language?: string; framework?: string }
  ): string {
    let prompt = `Create: ${description}`;
    if (options?.language) prompt += `\nLanguage: ${options.language}`;
    if (options?.framework) prompt += `\nFramework: ${options.framework}`;
    return prompt;
  }

  private calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const rates: Record<string, { input: number; output: number }> = {
      "ollama:qwen2.5-coder:7b": { input: 0, output: 0 },
      "groq:llama-3.1-70b-versatile": { input: 0.59, output: 0.79 },
      "claude-sonnet-4-20250514": { input: 3, output: 15 },
      "claude-opus-4-20250514": { input: 15, output: 75 },
    };

    const rate = rates[model] || { input: 3, output: 15 };
    return (inputTokens * rate.input + outputTokens * rate.output) / 1000000;
  }

  private calculateSavings(
    model: string,
    usage: { inputTokens: number; outputTokens: number }
  ): number {
    const opusCost = this.calculateCost(
      "claude-opus-4-20250514",
      usage.inputTokens,
      usage.outputTokens
    );
    const actualCost = this.calculateCost(
      model,
      usage.inputTokens,
      usage.outputTokens
    );
    return opusCost - actualCost;
  }

  private updateMetrics(result: TaskResult): void {
    this.metrics.tasksCompleted++;
    this.metrics.tokensUsed +=
      result.usage.inputTokens + result.usage.outputTokens;
    this.metrics.totalCost += result.usage.cost;
    this.metrics.totalSavings += result.savings;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC METRICS
  // ─────────────────────────────────────────────────────────────────────────

  getMetrics() {
    return {
      ...this.metrics,
      cacheHitRate:
        (this.metrics.cacheHits / Math.max(this.metrics.tasksCompleted, 1)) *
        100,
      avgCostPerTask:
        this.metrics.totalCost / Math.max(this.metrics.tasksCompleted, 1),
      savingsRate:
        (this.metrics.totalSavings /
          (this.metrics.totalCost + this.metrics.totalSavings)) *
        100,
    };
  }

  getSessionId(): string {
    return this.sessionId;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

let engine: MythaTronEngine | null = null;

export function getMythaTron(
  config?: Partial<MythaTronConfig>
): MythaTronEngine {
  if (!engine) {
    engine = new MythaTronEngine(config);
  }
  return engine;
}

export function resetMythaTron(): void {
  engine = null;
}
