/**
 * Extended Thinking - Deep reasoning for complex problems
 * Mirrors Claude's thinking capability
 */

export interface ThinkingBlock {
  id: string;
  content: string;
  timestamp: Date;
  durationMs?: number;
}

export interface ThinkingConfig {
  enabled: boolean;
  maxTokens: number;
  showInUI: boolean;
}

/**
 * Build a prompt that encourages extended thinking
 */
export function buildThinkingPrompt(task: string, context: string): string {
  return `Before responding, think through this step by step in a <thinking> block:

1. What is the user actually asking for?
2. What information do I need to gather?
3. What are the potential approaches?
4. What are the risks or edge cases?
5. What's the best approach and why?

Task: ${task}

Context:
${context}

Think carefully, then provide your response.`;
}

/**
 * Extract thinking blocks from a response
 */
export function extractThinkingBlocks(response: string): {
  thinking: ThinkingBlock[];
  content: string;
} {
  const thinkingBlocks: ThinkingBlock[] = [];
  let content = response;

  // Match <thinking>...</thinking> blocks
  const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/g;
  let match;

  while ((match = thinkingRegex.exec(response)) !== null) {
    thinkingBlocks.push({
      id: `thinking-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      content: match[1].trim(),
      timestamp: new Date(),
    });
  }

  // Remove thinking blocks from content
  content = response.replace(thinkingRegex, "").trim();

  return { thinking: thinkingBlocks, content };
}

/**
 * Format thinking blocks for display (collapsible in UI)
 */
export function formatThinkingForDisplay(blocks: ThinkingBlock[]): string {
  if (blocks.length === 0) return "";

  return blocks
    .map((block, i) => {
      return `<details>
<summary>💭 Thinking ${blocks.length > 1 ? `(${i + 1}/${blocks.length})` : ""}</summary>

${block.content}

</details>`;
    })
    .join("\n\n");
}

/**
 * System prompt addition for thinking mode
 */
export const THINKING_SYSTEM_PROMPT = `
When tackling complex problems, use a <thinking> block to reason through your approach before responding:

<thinking>
1. Break down the problem
2. Consider different approaches
3. Identify potential issues
4. Choose the best solution
</thinking>

Then provide your response outside the thinking block. This helps you:
- Catch errors before making them
- Consider edge cases
- Plan multi-step operations
- Debug complex issues

Use thinking for: architecture decisions, debugging, refactoring, multi-file changes.
Skip thinking for: simple questions, single file edits, explanations.
`;

