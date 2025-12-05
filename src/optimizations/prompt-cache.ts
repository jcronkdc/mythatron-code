/**
 * Anthropic Prompt Caching
 * 
 * Cursor doesn't use Anthropic's cache_control feature which gives
 * 90% discount on repeated prompt prefixes. We implement it.
 */

import * as crypto from "crypto";

interface CachedPrompt {
  hash: string;
  content: string;
  tokenCount: number;
  lastUsed: number;
  useCount: number;
}

export class PromptCache {
  private cache: Map<string, CachedPrompt> = new Map();
  private readonly MAX_CACHE_SIZE = 50;

  // Prompts that should be cached (system prompts, common prefixes)
  private staticPrompts: Map<string, string> = new Map();

  /**
   * Register a static prompt for caching
   */
  registerStaticPrompt(key: string, content: string): void {
    this.staticPrompts.set(key, content);
  }

  /**
   * Get cache breakpoints for Anthropic API
   * Returns indices where cache_control should be applied
   */
  getCacheBreakpoints(messages: Array<{ role: string; content: string }>): number[] {
    const breakpoints: number[] = [];
    
    // Cache system message
    if (messages[0]?.role === "system") {
      breakpoints.push(0);
    }

    // Cache static context (first few user messages with code)
    for (let i = 1; i < Math.min(3, messages.length); i++) {
      if (messages[i].content.length > 1000) {
        breakpoints.push(i);
      }
    }

    return breakpoints;
  }

  /**
   * Optimize messages for Anthropic's prompt caching
   */
  optimizeForCaching(messages: Array<{ role: string; content: string }>): Array<{
    role: string;
    content: string | Array<{ type: string; text: string; cache_control?: { type: string } }>;
  }> {
    const breakpoints = this.getCacheBreakpoints(messages);

    return messages.map((msg, idx) => {
      if (breakpoints.includes(idx)) {
        // Apply cache_control to this message
        return {
          role: msg.role,
          content: [
            {
              type: "text",
              text: msg.content,
              cache_control: { type: "ephemeral" },
            },
          ],
        };
      }
      return msg;
    });
  }

  /**
   * Estimate savings from prompt caching
   */
  estimateSavings(messages: Array<{ role: string; content: string }>): {
    cachedTokens: number;
    savings: number;
  } {
    const breakpoints = this.getCacheBreakpoints(messages);
    let cachedTokens = 0;

    for (const idx of breakpoints) {
      if (messages[idx]) {
        // Rough token estimate
        cachedTokens += Math.ceil(messages[idx].content.length / 4);
      }
    }

    // 90% discount on cached tokens
    const fullPrice = (cachedTokens / 1_000_000) * 3; // $3/M input
    const cachedPrice = (cachedTokens / 1_000_000) * 0.3; // $0.30/M cached
    
    return {
      cachedTokens,
      savings: fullPrice - cachedPrice,
    };
  }
}

export const promptCache = new PromptCache();

