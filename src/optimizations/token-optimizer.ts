/**
 * Token Optimization System
 * 
 * Cursor sends bloated prompts with excessive context and verbose
 * system prompts. This system aggressively optimizes token usage
 * while maintaining quality.
 */

import * as vscode from "vscode";

interface OptimizationStats {
  originalTokens: number;
  optimizedTokens: number;
  savedTokens: number;
  savingsPercent: number;
  optimizationsApplied: string[];
}

interface MessageContent {
  role: "system" | "user" | "assistant";
  content: string;
}

export class TokenOptimizer {
  private totalOriginalTokens: number = 0;
  private totalOptimizedTokens: number = 0;

  // Compression patterns
  private readonly COMPRESSION_PATTERNS = [
    // Remove excessive whitespace
    { pattern: /\n{3,}/g, replacement: "\n\n" },
    { pattern: /[ \t]{2,}/g, replacement: " " },
    // Shorten common phrases
    { pattern: /please (make sure to |ensure that |)/gi, replacement: "" },
    { pattern: /the following/gi, replacement: "this" },
    { pattern: /in order to/gi, replacement: "to" },
    { pattern: /make sure that/gi, replacement: "ensure" },
    { pattern: /due to the fact that/gi, replacement: "because" },
    { pattern: /at this point in time/gi, replacement: "now" },
    { pattern: /in the event that/gi, replacement: "if" },
    { pattern: /with regard to/gi, replacement: "about" },
    { pattern: /for the purpose of/gi, replacement: "to" },
  ];

  // Code minification patterns
  private readonly CODE_MINIFICATION = [
    // Remove single-line comments (preserve JSDoc)
    { pattern: /(?<!\/)\/\/(?![\/*]).*$/gm, replacement: "" },
    // Remove empty lines in code blocks
    { pattern: /```(\w+)?\n+/g, replacement: "```$1\n" },
    { pattern: /\n+```/g, replacement: "\n```" },
  ];

  /**
   * Estimate token count (rough approximation)
   */
  estimateTokens(text: string): number {
    // More accurate estimate:
    // - Split on whitespace and punctuation
    // - Count special tokens
    const words = text.split(/[\s\n\r\t]+/).filter(Boolean);
    const punctuation = (text.match(/[.,!?;:'"()\[\]{}]/g) || []).length;
    const codeTokens = (text.match(/[+\-*/%=<>!&|^~]+/g) || []).length;

    // Rough estimate: 1 word ≈ 1.3 tokens, punctuation = separate tokens
    return Math.ceil(words.length * 1.3 + punctuation + codeTokens);
  }

  /**
   * Optimize a conversation for minimal tokens
   */
  optimizeConversation(messages: MessageContent[]): {
    messages: MessageContent[];
    stats: OptimizationStats;
  } {
    const optimizationsApplied: string[] = [];
    const originalTokens = messages.reduce(
      (sum, m) => sum + this.estimateTokens(m.content),
      0
    );

    const optimizedMessages = messages.map((msg) => {
      let content = msg.content;

      // Apply role-specific optimizations
      if (msg.role === "system") {
        content = this.optimizeSystemPrompt(content, optimizationsApplied);
      } else if (msg.role === "user") {
        content = this.optimizeUserMessage(content, optimizationsApplied);
      } else if (msg.role === "assistant") {
        content = this.optimizeAssistantMessage(content, optimizationsApplied);
      }

      return { ...msg, content };
    });

    const optimizedTokens = optimizedMessages.reduce(
      (sum, m) => sum + this.estimateTokens(m.content),
      0
    );

    // Track totals
    this.totalOriginalTokens += originalTokens;
    this.totalOptimizedTokens += optimizedTokens;

    return {
      messages: optimizedMessages,
      stats: {
        originalTokens,
        optimizedTokens,
        savedTokens: originalTokens - optimizedTokens,
        savingsPercent:
          originalTokens > 0
            ? ((originalTokens - optimizedTokens) / originalTokens) * 100
            : 0,
        optimizationsApplied: [...new Set(optimizationsApplied)],
      },
    };
  }

  /**
   * Optimize system prompt
   */
  private optimizeSystemPrompt(content: string, applied: string[]): string {
    let result = content;

    // Remove redundant instructions
    const redundantPatterns = [
      /You are an? (?:helpful |expert |experienced )+(?:AI )?(?:coding )?assistant[\.,]?/gi,
      /Your (job|task|goal) is to help (?:the user|users) (?:with their|with)[\s\S]*?[\.,]/gi,
      /(?:Remember|Note|Important):?\s*Always be helpful[\s\S]*?[\.,]/gi,
    ];

    for (const pattern of redundantPatterns) {
      if (pattern.test(result)) {
        result = result.replace(pattern, "");
        applied.push("removed_redundant_instructions");
      }
    }

    // Apply compression patterns
    for (const { pattern, replacement } of this.COMPRESSION_PATTERNS) {
      if (pattern.test(result)) {
        result = result.replace(pattern, replacement);
        applied.push("compressed_text");
      }
    }

    // Remove excessive examples (keep first 2 per category)
    const exampleBlocks = result.match(/<example>[\s\S]*?<\/example>/g) || [];
    if (exampleBlocks.length > 2) {
      const exampleMap = new Map<string, string[]>();

      for (const block of exampleBlocks) {
        const key = block.slice(0, 100); // Group by first 100 chars
        const examples = exampleMap.get(key) || [];
        examples.push(block);
        exampleMap.set(key, examples);
      }

      for (const [, examples] of exampleMap) {
        for (let i = 2; i < examples.length; i++) {
          result = result.replace(examples[i], "");
          applied.push("removed_excess_examples");
        }
      }
    }

    return result.trim();
  }

  /**
   * Optimize user message
   */
  private optimizeUserMessage(content: string, applied: string[]): string {
    let result = content;

    // Apply compression patterns
    for (const { pattern, replacement } of this.COMPRESSION_PATTERNS) {
      if (pattern.test(result)) {
        result = result.replace(pattern, replacement);
        applied.push("compressed_user_text");
      }
    }

    // Optimize code blocks
    result = this.optimizeCodeBlocks(result, applied);

    // Remove politeness that doesn't add information
    const politenessPatterns = [
      /^(?:hi|hello|hey)[\s,!.]*(?:there)?[\s,!.]*/i,
      /^(?:thanks|thank you)[\s,!.]*(?:in advance)?[\s,!.]*/i,
      /please(?:\s+and\s+thank\s+you)?[\s,!.]*/gi,
      /(?:would|could) you (?:please |kindly )?/gi,
    ];

    for (const pattern of politenessPatterns) {
      if (pattern.test(result)) {
        result = result.replace(pattern, "");
        applied.push("removed_politeness");
      }
    }

    return result.trim();
  }

  /**
   * Optimize assistant message (for history compression)
   */
  private optimizeAssistantMessage(content: string, applied: string[]): string {
    let result = content;

    // For long responses, keep only the most relevant parts
    const tokens = this.estimateTokens(result);

    if (tokens > 2000) {
      // Keep code blocks and first/last paragraphs
      const codeBlocks = result.match(/```[\s\S]*?```/g) || [];
      const paragraphs = result.split(/\n\n+/).filter(Boolean);

      if (paragraphs.length > 4) {
        const keepFirst = paragraphs.slice(0, 2);
        const keepLast = paragraphs.slice(-1);
        const codes = codeBlocks.join("\n\n");

        result = [...keepFirst, "...(truncated)...", codes, ...keepLast].join("\n\n");
        applied.push("truncated_long_response");
      }
    }

    // Apply code minification
    result = this.optimizeCodeBlocks(result, applied);

    return result.trim();
  }

  /**
   * Optimize code blocks
   */
  private optimizeCodeBlocks(content: string, applied: string[]): string {
    let result = content;

    // Extract and optimize code blocks
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;

    result = result.replace(codeBlockRegex, (match, lang, code) => {
      let optimizedCode = code;

      // Remove single-line comments (but keep important ones)
      optimizedCode = optimizedCode.replace(
        /(?<!:)\/\/(?!\!|TODO|FIXME|HACK|NOTE).*$/gm,
        ""
      );

      // Remove empty lines
      optimizedCode = optimizedCode.replace(/\n{2,}/g, "\n");

      // Remove trailing whitespace
      optimizedCode = optimizedCode.replace(/[ \t]+$/gm, "");

      if (optimizedCode !== code) {
        applied.push("optimized_code_block");
      }

      return `\`\`\`${lang}\n${optimizedCode.trim()}\n\`\`\``;
    });

    return result;
  }

  /**
   * Optimize context for a specific task
   */
  optimizeContextForTask(
    context: string,
    task: "explain" | "generate" | "fix" | "refactor" | "chat"
  ): { context: string; stats: OptimizationStats } {
    const originalTokens = this.estimateTokens(context);
    let optimized = context;
    const applied: string[] = [];

    // Task-specific optimizations
    switch (task) {
      case "explain":
        // For explanations, full context is needed
        optimized = this.compressWhitespace(context);
        applied.push("whitespace_compression");
        break;

      case "generate":
        // For generation, focus on structure and types
        optimized = this.extractStructure(context);
        applied.push("structure_extraction");
        break;

      case "fix":
        // For fixes, focus on error context and relevant code
        optimized = this.focusOnErrors(context);
        applied.push("error_focus");
        break;

      case "refactor":
        // For refactoring, need full code but can remove comments
        optimized = this.removeComments(context);
        applied.push("comment_removal");
        break;

      case "chat":
        // For chat, compress aggressively
        optimized = this.aggressiveCompress(context);
        applied.push("aggressive_compression");
        break;
    }

    const optimizedTokens = this.estimateTokens(optimized);

    return {
      context: optimized,
      stats: {
        originalTokens,
        optimizedTokens,
        savedTokens: originalTokens - optimizedTokens,
        savingsPercent:
          originalTokens > 0
            ? ((originalTokens - optimizedTokens) / originalTokens) * 100
            : 0,
        optimizationsApplied: applied,
      },
    };
  }

  /**
   * Compress whitespace
   */
  private compressWhitespace(text: string): string {
    return text
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .replace(/[ \t]+$/gm, "")
      .trim();
  }

  /**
   * Extract structure (types, interfaces, function signatures)
   */
  private extractStructure(code: string): string {
    const lines = code.split("\n");
    const structureLines: string[] = [];
    let inBody = false;
    let braceDepth = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Keep imports
      if (trimmed.startsWith("import ") || trimmed.startsWith("from ")) {
        structureLines.push(line);
        continue;
      }

      // Keep type/interface definitions
      if (
        trimmed.startsWith("interface ") ||
        trimmed.startsWith("type ") ||
        trimmed.startsWith("export interface") ||
        trimmed.startsWith("export type")
      ) {
        structureLines.push(line);
        continue;
      }

      // Keep function signatures (but not bodies)
      if (
        (trimmed.startsWith("function ") ||
          trimmed.startsWith("async function") ||
          trimmed.startsWith("export function") ||
          trimmed.startsWith("export async function") ||
          /^\w+\s*\([^)]*\)\s*[:{]/.test(trimmed)) &&
        !inBody
      ) {
        // Extract just the signature
        const sigMatch = line.match(/^(.+?)\s*\{/);
        if (sigMatch) {
          structureLines.push(sigMatch[1] + " { ... }");
        } else {
          structureLines.push(line);
        }
        inBody = true;
        braceDepth = 1;
        continue;
      }

      // Track brace depth when in body
      if (inBody) {
        braceDepth += (line.match(/\{/g) || []).length;
        braceDepth -= (line.match(/\}/g) || []).length;
        if (braceDepth <= 0) {
          inBody = false;
        }
      }
    }

    return structureLines.join("\n");
  }

  /**
   * Focus on errors and surrounding context
   */
  private focusOnErrors(context: string): string {
    const lines = context.split("\n");
    const errorLines: number[] = [];

    // Find lines with error markers
    lines.forEach((line, idx) => {
      if (
        line.includes("error") ||
        line.includes("Error") ||
        line.includes("❌") ||
        line.includes("^") ||
        /^\s*\d+\s*\|/.test(line)
      ) {
        errorLines.push(idx);
      }
    });

    if (errorLines.length === 0) {
      return context;
    }

    // Keep error lines and 3 lines of context around each
    const keepLines = new Set<number>();
    for (const errorLine of errorLines) {
      for (let i = errorLine - 3; i <= errorLine + 3; i++) {
        if (i >= 0 && i < lines.length) {
          keepLines.add(i);
        }
      }
    }

    const result: string[] = [];
    let lastKept = -2;

    lines.forEach((line, idx) => {
      if (keepLines.has(idx)) {
        if (idx > lastKept + 1) {
          result.push("...");
        }
        result.push(line);
        lastKept = idx;
      }
    });

    return result.join("\n");
  }

  /**
   * Remove comments from code
   */
  private removeComments(code: string): string {
    return code
      .replace(/\/\*[\s\S]*?\*\//g, "") // Block comments
      .replace(/(?<!:)\/\/(?!\!|TODO|FIXME).*$/gm, "") // Line comments (keep important)
      .replace(/^\s*#(?!!).*$/gm, "") // Python/shell comments
      .replace(/\n{2,}/g, "\n"); // Remove resulting empty lines
  }

  /**
   * Aggressive compression for chat
   */
  private aggressiveCompress(text: string): string {
    let result = this.compressWhitespace(text);

    // Apply all compression patterns
    for (const { pattern, replacement } of this.COMPRESSION_PATTERNS) {
      result = result.replace(pattern, replacement);
    }

    // Remove code comments
    result = this.removeComments(result);

    // Truncate very long content
    const tokens = this.estimateTokens(result);
    if (tokens > 3000) {
      const lines = result.split("\n");
      const targetLines = Math.floor((3000 / tokens) * lines.length);
      result =
        lines.slice(0, targetLines / 2).join("\n") +
        "\n...(truncated)...\n" +
        lines.slice(-targetLines / 2).join("\n");
    }

    return result;
  }

  /**
   * Get overall statistics
   */
  getStats(): { total: { original: number; optimized: number; saved: number; percent: number } } {
    const saved = this.totalOriginalTokens - this.totalOptimizedTokens;
    return {
      total: {
        original: this.totalOriginalTokens,
        optimized: this.totalOptimizedTokens,
        saved,
        percent:
          this.totalOriginalTokens > 0
            ? (saved / this.totalOriginalTokens) * 100
            : 0,
      },
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.totalOriginalTokens = 0;
    this.totalOptimizedTokens = 0;
  }
}

// Singleton instance
let instance: TokenOptimizer | null = null;

export function getTokenOptimizer(): TokenOptimizer {
  if (!instance) {
    instance = new TokenOptimizer();
  }
  return instance;
}

