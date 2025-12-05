/**
 * Parallel Tool Execution - Run independent tools simultaneously
 * Dramatically speeds up multi-tool operations
 */

import type { ToolCall } from "../providers/types";

export interface ToolResult {
  toolId: string;
  toolName: string;
  result: string;
  durationMs: number;
  error?: string;
}

export interface ParallelExecutionResult {
  results: ToolResult[];
  totalDurationMs: number;
  parallelSavingsMs: number;
}

/**
 * Analyze tool calls for dependencies
 * Returns groups of tools that can run in parallel
 */
export function analyzeToolDependencies(toolCalls: ToolCall[]): ToolCall[][] {
  const groups: ToolCall[][] = [];
  const processed = new Set<string>();

  // Simple heuristic: tools that read the same file depend on each other
  // Tools that write depend on all previous tools
  
  const fileReads = new Map<string, ToolCall[]>();
  const fileWrites = new Map<string, ToolCall[]>();

  for (const call of toolCalls) {
    const input = call.input as Record<string, unknown>;
    const path = (input.path || input.file_path || input.target_file) as string;

    if (isReadTool(call.name)) {
      if (!fileReads.has(path)) fileReads.set(path, []);
      fileReads.get(path)!.push(call);
    } else if (isWriteTool(call.name)) {
      if (!fileWrites.has(path)) fileWrites.set(path, []);
      fileWrites.get(path)!.push(call);
    }
  }

  // Group 1: All reads (can be parallel)
  const readGroup: ToolCall[] = [];
  for (const call of toolCalls) {
    if (isReadTool(call.name) && !processed.has(call.id)) {
      readGroup.push(call);
      processed.add(call.id);
    }
  }
  if (readGroup.length > 0) groups.push(readGroup);

  // Remaining tools run sequentially
  for (const call of toolCalls) {
    if (!processed.has(call.id)) {
      groups.push([call]);
      processed.add(call.id);
    }
  }

  return groups;
}

/**
 * Execute tool calls in parallel where possible
 */
export async function executeParallel(
  toolCalls: ToolCall[],
  executor: (call: ToolCall) => Promise<string>
): Promise<ParallelExecutionResult> {
  const startTime = Date.now();
  const results: ToolResult[] = [];
  let sequentialTime = 0;

  const groups = analyzeToolDependencies(toolCalls);

  for (const group of groups) {
    const groupStart = Date.now();

    if (group.length === 1) {
      // Single tool - run directly
      const call = group[0];
      const callStart = Date.now();
      try {
        const result = await executor(call);
        const duration = Date.now() - callStart;
        results.push({
          toolId: call.id,
          toolName: call.name,
          result,
          durationMs: duration,
        });
        sequentialTime += duration;
      } catch (error) {
        results.push({
          toolId: call.id,
          toolName: call.name,
          result: "",
          durationMs: Date.now() - callStart,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      // Multiple tools - run in parallel
      const promises = group.map(async (call) => {
        const callStart = Date.now();
        try {
          const result = await executor(call);
          const duration = Date.now() - callStart;
          sequentialTime += duration;
          return {
            toolId: call.id,
            toolName: call.name,
            result,
            durationMs: duration,
          };
        } catch (error) {
          const duration = Date.now() - callStart;
          sequentialTime += duration;
          return {
            toolId: call.id,
            toolName: call.name,
            result: "",
            durationMs: duration,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      const groupResults = await Promise.all(promises);
      results.push(...groupResults);
    }
  }

  const totalDuration = Date.now() - startTime;

  return {
    results,
    totalDurationMs: totalDuration,
    parallelSavingsMs: Math.max(0, sequentialTime - totalDuration),
  };
}

/**
 * Check if a tool only reads (no side effects)
 */
function isReadTool(name: string): boolean {
  const readTools = new Set([
    "read_file",
    "list_directory",
    "search_files",
    "grep",
    "codebase_search",
    "get_diagnostics",
    "get_definition",
    "get_references",
    "get_hover_info",
    "get_git_status",
    "git_diff",
    "git_log",
    "get_context",
    "get_workspace_info",
    "get_open_files",
    "get_selection",
    "mcp_list_tools",
    "list_checkpoints",
    "list_memories",
    "list_running_jobs",
    "workspace_symbols",
    "document_symbols",
  ]);
  return readTools.has(name);
}

/**
 * Check if a tool writes/modifies state
 */
function isWriteTool(name: string): boolean {
  const writeTools = new Set([
    "write_file",
    "edit_file",
    "multi_edit",
    "delete_file",
    "rename_file",
    "copy_file",
    "create_directory",
    "run_terminal_command",
    "git_commit",
    "git_push",
    "git_checkout",
    "rename_symbol",
    "apply_code_action",
    "format_document",
  ]);
  return writeTools.has(name);
}

/**
 * Estimate time savings from parallel execution
 */
export function estimateParallelSavings(toolCalls: ToolCall[]): {
  parallelGroups: number;
  maxParallel: number;
  estimatedSpeedup: string;
} {
  const groups = analyzeToolDependencies(toolCalls);
  const maxParallel = Math.max(...groups.map((g) => g.length));
  const totalTools = toolCalls.length;
  const parallelGroups = groups.length;

  // Rough estimate: parallel execution saves (totalTools - parallelGroups) / totalTools
  const speedup = totalTools > 0 ? totalTools / parallelGroups : 1;

  return {
    parallelGroups,
    maxParallel,
    estimatedSpeedup: `${speedup.toFixed(1)}x`,
  };
}

