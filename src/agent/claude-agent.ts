/**
 * Claude Code Agent - Core AI with multi-provider support
 * Smart routing for cost optimization
 */

import * as vscode from "vscode";
import { tools } from "../tools/definitions";
import { ToolExecutor } from "../tools/executor";
import {
  getProviderManager,
  Message,
  ToolDefinition,
  ToolCall,
  TokenUsage,
} from "../providers";
import { getMemoryManager } from "../memory";
import { getContextTracker } from "../features/context";
import {
  THINKING_SYSTEM_PROMPT,
  extractThinkingBlocks,
  formatThinkingForDisplay,
} from "../features/thinking";
import { buildImageMessage, readImageAsBase64, isImageFile } from "../features/vision";
import {
  AgentState,
  AgentStep,
  AgentConfig,
  DEFAULT_AGENT_CONFIG,
  shouldContinue,
  needsConfirmation,
  createToolCallStep,
  createToolResultStep,
  generateStepId,
} from "../features/agent-loop";

export interface AgentOptions {
  systemPrompt?: string;
  maxIterations?: number;
  enableThinking?: boolean;
  requireConfirmation?: boolean;
  images?: string[];
}

export interface AgentResponse {
  content: string;
  thinking?: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  state: AgentState;
}

const DEFAULT_SYSTEM_PROMPT = `You are Claude Code, an expert AI assistant for software development.

You have access to powerful tools for reading/writing files, running terminal commands, searching code, and more. Always use the most appropriate tool for the task.

Guidelines:
1. Read files before editing them to understand context
2. Make targeted edits, don't rewrite entire files unnecessarily  
3. Run builds/tests after making changes to verify they work
4. Use semantic search for understanding large codebases
5. Keep code clean and follow existing patterns

For complex tasks:
1. Break them into steps
2. Think through each step before acting
3. Verify results at each stage

Be proactive but not over-eager. Only make changes that are directly requested or clearly necessary.`;

export class ClaudeAgent {
  private executor: ToolExecutor;
  private conversationHistory: Message[] = [];
  private totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  private agentConfig: AgentConfig;

  constructor(private outputChannel?: vscode.OutputChannel) {
    this.executor = new ToolExecutor();
    this.agentConfig = { ...DEFAULT_AGENT_CONFIG };
  }

  setConfig(config: Partial<AgentConfig>): void {
    this.agentConfig = { ...this.agentConfig, ...config };
  }

  async processMessage(
    userMessage: string,
    options: AgentOptions = {}
  ): Promise<AgentResponse> {
    const state: AgentState = {
      steps: [],
      isComplete: false,
      totalTokens: 0,
      totalCost: 0,
    };

    // Build system prompt with memories and rules
    let systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;

    // Add thinking prompt if enabled
    if (options.enableThinking) {
      systemPrompt += "\n\n" + THINKING_SYSTEM_PROMPT;
    }

    // Add memories
    const memories = getMemoryManager().getAllMemories();
    if (memories.length > 0) {
      systemPrompt += "\n\n<memories>\n";
      systemPrompt += memories.map((m) => `[[memory:${m.id}]] ${m.title}\n${m.content}`).join("\n\n");
      systemPrompt += "\n</memories>";
    }

    // Add rules
    const rules = getMemoryManager().getRules();
    if (rules?.rules?.length) {
      systemPrompt += "\n\n<user_rules>\n";
      systemPrompt += rules.rules.join("\n");
      systemPrompt += "\n</user_rules>";
    }

    // Build user message with context
    let fullMessage = userMessage;

    // Add user context
    const context = getContextTracker().buildContextString();
    if (context) {
      fullMessage = context + "\n\n" + fullMessage;
    }

    // Handle images
    let userContent: string | Array<{ type: string; [key: string]: unknown }> = fullMessage;
    if (options.images && options.images.length > 0) {
      const imageData = options.images
        .filter((p) => isImageFile(p))
        .map((p) => readImageAsBase64(p))
        .filter((d) => d !== null);

      if (imageData.length > 0) {
        userContent = buildImageMessage(fullMessage, imageData as any);
      }
    }

    // Add to conversation
    this.conversationHistory.push({ role: "user", content: userContent as string });

    // Get provider manager
    const providerManager = getProviderManager();

    // Convert tools to provider format
    const toolDefs: ToolDefinition[] = tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      input_schema: {
        type: "object" as const,
        properties: t.input_schema.properties as Record<string, unknown>,
        required: (t.input_schema.required || []) as string[],
      },
    }));

    const maxIterations = options.maxIterations || this.agentConfig.maxIterations;
    let allToolCalls: ToolCall[] = [];
    let finalContent = "";
    let thinkingContent = "";

    // Agent loop
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      this.log(`Iteration ${iteration + 1}/${maxIterations}`);

      const check = shouldContinue(state, this.agentConfig);
      if (!check.continue) {
        this.log(`Stopping: ${check.reason}`);
        break;
      }

      try {
        const response = await providerManager.complete({
          messages: [
            { role: "system", content: systemPrompt },
            ...this.conversationHistory,
          ],
          tools: toolDefs,
          maxTokens: this.agentConfig.maxTokensPerIteration,
        });

        // Update usage
        const usage = response.usage || { inputTokens: 0, outputTokens: 0 };
        state.totalTokens += usage.inputTokens + usage.outputTokens;
        state.totalCost += this.estimateCost(usage);
        this.totalUsage.inputTokens += usage.inputTokens;
        this.totalUsage.outputTokens += usage.outputTokens;

        // Extract thinking if present
        if (options.enableThinking && response.content) {
          const { thinking, content } = extractThinkingBlocks(response.content);
          if (thinking.length > 0) {
            thinkingContent += formatThinkingForDisplay(thinking) + "\n\n";
            state.steps.push({
              id: generateStepId(),
              type: "thinking",
              content: thinking.map((t) => t.content).join("\n"),
              timestamp: new Date(),
            });
          }
          finalContent = content;
        } else {
          finalContent = response.content;
        }

        // Handle tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          const toolResults: Array<{ toolUseId: string; result: string }> = [];

          for (const toolCall of response.toolCalls) {
            allToolCalls.push(toolCall);
            state.steps.push(createToolCallStep(toolCall));

            this.log(`Tool: ${toolCall.name}`);

            // Check if confirmation needed
            if (needsConfirmation(toolCall.name, toolCall.input, this.agentConfig)) {
              const confirmed = await this.askConfirmation(toolCall);
              if (!confirmed) {
                toolResults.push({
                  toolUseId: toolCall.id,
                  result: "Tool execution cancelled by user",
                });
                continue;
              }
            }

            // Execute tool
            const start = Date.now();
            const result = await this.executor.execute(
              toolCall.name as any,
              toolCall.input
            );
            const duration = Date.now() - start;

            state.steps.push(createToolResultStep(toolCall.name, result, duration));
            toolResults.push({ toolUseId: toolCall.id, result });

            this.log(`Result (${duration}ms): ${result.slice(0, 200)}...`);
          }

          // Add assistant message with tool calls
          this.conversationHistory.push({
            role: "assistant",
            content: finalContent + (response.toolCalls ? "\n[Tool calls executed]" : ""),
          });

          // Add tool results
          this.conversationHistory.push({
            role: "user",
            content: toolResults
              .map((r) => `<tool_result tool_use_id="${r.toolUseId}">${r.result}</tool_result>`)
              .join("\n"),
          });
        } else {
          // No tool calls - we're done
          state.isComplete = true;

          state.steps.push({
            id: generateStepId(),
            type: "response",
            content: finalContent,
            timestamp: new Date(),
          });

          // Add final response to history
          this.conversationHistory.push({
            role: "assistant",
            content: finalContent,
          });

          break;
        }
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        this.log(`Error: ${state.error}`);

        if (this.agentConfig.stopOnError) {
          break;
        }
      }
    }

    return {
      content: finalContent,
      thinking: thinkingContent || undefined,
      toolCalls: allToolCalls,
      usage: this.totalUsage,
      state,
    };
  }

  private async askConfirmation(toolCall: ToolCall): Promise<boolean> {
    const message = `Execute ${toolCall.name}?\n${JSON.stringify(toolCall.input, null, 2).slice(0, 200)}`;
    const result = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      "Yes",
      "No"
    );
    return result === "Yes";
  }

  private estimateCost(usage: TokenUsage): number {
    // Use Claude 3.5 Sonnet pricing as base estimate
    const inputCost = (usage.inputTokens / 1_000_000) * 3.0;
    const outputCost = (usage.outputTokens / 1_000_000) * 15.0;
    return inputCost + outputCost;
  }

  getUsage(): TokenUsage {
    return { ...this.totalUsage };
  }

  getEstimatedCost(): number {
    return this.estimateCost(this.totalUsage);
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  getHistory(): Message[] {
    return [...this.conversationHistory];
  }

  private log(message: string): void {
    this.outputChannel?.appendLine(`[Agent] ${message}`);
  }
}

// Singleton
let agent: ClaudeAgent | null = null;

export function getAgent(outputChannel?: vscode.OutputChannel): ClaudeAgent {
  if (!agent) {
    agent = new ClaudeAgent(outputChannel);
  }
  return agent;
}

