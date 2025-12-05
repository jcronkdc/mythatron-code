/**
 * Agent Loop - Keep executing until task is complete
 * Handles multi-step reasoning and tool chaining
 */

import type { ToolCall } from "../providers/types";

export interface AgentStep {
  id: string;
  type: "thinking" | "tool_call" | "tool_result" | "response";
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  timestamp: Date;
  durationMs?: number;
}

export interface AgentState {
  steps: AgentStep[];
  isComplete: boolean;
  error?: string;
  totalTokens: number;
  totalCost: number;
}

export interface AgentConfig {
  maxIterations: number;
  maxTokensPerIteration: number;
  stopOnError: boolean;
  requireConfirmation: boolean;
  dangerousOperations: string[];
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxIterations: 25,
  maxTokensPerIteration: 8192,
  stopOnError: false,
  requireConfirmation: false,
  dangerousOperations: [
    "delete_file",
    "run_terminal_command",
    "git_commit",
    "git_push",
  ],
};

/**
 * Determine if a task needs confirmation
 */
export function needsConfirmation(
  toolName: string,
  input: Record<string, unknown>,
  config: AgentConfig
): boolean {
  if (!config.requireConfirmation) return false;

  // Check if tool is in dangerous list
  if (config.dangerousOperations.includes(toolName)) {
    return true;
  }

  // Check for destructive operations
  if (toolName === "edit_file" || toolName === "write_file") {
    // Large edits might need confirmation
    const content = input.content as string || input.new_string as string || "";
    if (content.length > 5000) {
      return true;
    }
  }

  if (toolName === "run_terminal_command") {
    const command = (input.command as string || "").toLowerCase();
    // Destructive commands
    if (
      command.includes("rm -rf") ||
      command.includes("drop table") ||
      command.includes("delete from") ||
      command.includes("--force") ||
      command.includes("-f ")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if agent should continue
 */
export function shouldContinue(
  state: AgentState,
  config: AgentConfig
): { continue: boolean; reason?: string } {
  // Check iteration limit
  const toolCalls = state.steps.filter((s) => s.type === "tool_call");
  if (toolCalls.length >= config.maxIterations) {
    return {
      continue: false,
      reason: `Reached maximum iterations (${config.maxIterations})`,
    };
  }

  // Check for errors
  if (state.error && config.stopOnError) {
    return {
      continue: false,
      reason: `Error: ${state.error}`,
    };
  }

  // Check if explicitly complete
  if (state.isComplete) {
    return {
      continue: false,
      reason: "Task completed",
    };
  }

  return { continue: true };
}

/**
 * Generate step ID
 */
export function generateStepId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Create agent step from tool call
 */
export function createToolCallStep(toolCall: ToolCall): AgentStep {
  return {
    id: generateStepId(),
    type: "tool_call",
    content: `Calling ${toolCall.name}`,
    toolName: toolCall.name,
    toolInput: toolCall.input,
    timestamp: new Date(),
  };
}

/**
 * Create agent step from tool result
 */
export function createToolResultStep(
  toolName: string,
  result: string,
  durationMs: number
): AgentStep {
  return {
    id: generateStepId(),
    type: "tool_result",
    content: result,
    toolName,
    toolResult: result,
    timestamp: new Date(),
    durationMs,
  };
}

/**
 * Format agent state for display
 */
export function formatAgentState(state: AgentState): string {
  const lines: string[] = [];

  lines.push(`Agent State: ${state.isComplete ? "Complete" : "Running"}`);
  lines.push(`Steps: ${state.steps.length}`);
  lines.push(`Tokens: ${state.totalTokens}`);
  lines.push(`Cost: $${state.totalCost.toFixed(4)}`);

  if (state.error) {
    lines.push(`Error: ${state.error}`);
  }

  lines.push("\nSteps:");
  for (const step of state.steps) {
    const duration = step.durationMs ? ` (${step.durationMs}ms)` : "";
    
    switch (step.type) {
      case "thinking":
        lines.push(`  💭 Thinking${duration}`);
        break;
      case "tool_call":
        lines.push(`  🔧 ${step.toolName}${duration}`);
        break;
      case "tool_result":
        const preview = step.content.slice(0, 50).replace(/\n/g, " ");
        lines.push(`  📋 Result: ${preview}...${duration}`);
        break;
      case "response":
        lines.push(`  💬 Response${duration}`);
        break;
    }
  }

  return lines.join("\n");
}

/**
 * Estimate remaining iterations
 */
export function estimateRemainingIterations(
  state: AgentState,
  config: AgentConfig
): number {
  const used = state.steps.filter((s) => s.type === "tool_call").length;
  return Math.max(0, config.maxIterations - used);
}

