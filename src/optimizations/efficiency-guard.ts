/**
 * Efficiency Guard
 * 
 * Actively prevents wasteful patterns that slow you down
 * and cost more money. This is the "anti-bloat" system.
 */

import * as vscode from "vscode";
import * as crypto from "crypto";

interface EfficiencyMetrics {
  tokensUsed: number;
  tokensSaved: number;
  cacheHits: number;
  cacheMisses: number;
  modelDowngrades: number;
  duplicateRequestsBlocked: number;
  unnecessaryReadsAvoided: number;
}

let metrics: EfficiencyMetrics = {
  tokensUsed: 0,
  tokensSaved: 0,
  cacheHits: 0,
  cacheMisses: 0,
  modelDowngrades: 0,
  duplicateRequestsBlocked: 0,
  unnecessaryReadsAvoided: 0,
};

// Recent request hashes to detect duplicates
const recentRequests = new Map<string, { response: string; timestamp: number }>();
const REQUEST_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// File content cache to avoid re-reading
const fileCache = new Map<string, { content: string; mtime: number }>();

// Response cache for semantic similarity
const responseCache = new Map<string, { response: string; timestamp: number }>();

/**
 * OPTIMIZATION 1: Detect and block duplicate requests
 * 
 * If you ask the same thing twice in 5 minutes, return cached response
 */
export function checkDuplicateRequest(prompt: string): string | null {
  const hash = hashPrompt(prompt);
  const cached = recentRequests.get(hash);

  if (cached && Date.now() - cached.timestamp < REQUEST_CACHE_TTL) {
    metrics.duplicateRequestsBlocked++;
    metrics.tokensSaved += estimateTokens(prompt) + estimateTokens(cached.response);
    return cached.response;
  }

  return null;
}

export function cacheRequest(prompt: string, response: string): void {
  const hash = hashPrompt(prompt);
  recentRequests.set(hash, { response, timestamp: Date.now() });

  // Cleanup old entries
  for (const [key, value] of recentRequests) {
    if (Date.now() - value.timestamp > REQUEST_CACHE_TTL) {
      recentRequests.delete(key);
    }
  }
}

/**
 * OPTIMIZATION 2: Smart model selection
 * 
 * Don't use a $15/M token model for a $0.25/M task
 */
export interface ModelRecommendation {
  model: string;
  reason: string;
  estimatedCost: number;
  alternativeCost: number;
  savings: string;
}

export function recommendModel(prompt: string, context?: string): ModelRecommendation {
  const promptLower = prompt.toLowerCase();
  const totalTokens = estimateTokens(prompt + (context || ""));

  // Simple tasks - use cheap/free models
  const simplePatterns = [
    /^(what|how|explain|describe|list|show)/i,
    /fix (this|the) (typo|spelling|error)/i,
    /add (a )?comment/i,
    /rename/i,
    /format/i,
    /simple/i,
  ];

  const isSimple = simplePatterns.some((p) => p.test(promptLower));

  // Code generation tasks - use mid-tier
  const codePatterns = [
    /create|implement|build|write|generate/i,
    /function|class|component|api/i,
  ];

  const isCodeGen = codePatterns.some((p) => p.test(promptLower));

  // Complex reasoning tasks - use top-tier
  const complexPatterns = [
    /architect|design|plan|strategy/i,
    /debug.*complex|investigate/i,
    /refactor.*entire|restructure/i,
    /security|performance.*optim/i,
  ];

  const isComplex = complexPatterns.some((p) => p.test(promptLower));

  if (isSimple || totalTokens < 500) {
    metrics.modelDowngrades++;
    return {
      model: "llama3-8b-8192", // Groq - FREE tier speeds
      reason: "Simple task - using fast free model",
      estimatedCost: 0,
      alternativeCost: totalTokens * 0.000015, // Claude Opus rate
      savings: "100%",
    };
  }

  if (isCodeGen && !isComplex) {
    metrics.modelDowngrades++;
    return {
      model: "claude-3-5-sonnet-20241022",
      reason: "Code generation - using balanced model",
      estimatedCost: totalTokens * 0.000003,
      alternativeCost: totalTokens * 0.000015,
      savings: "80%",
    };
  }

  // Complex - use best model
  return {
    model: "claude-sonnet-4-20250514",
    reason: "Complex task - using capable model",
    estimatedCost: totalTokens * 0.000003,
    alternativeCost: totalTokens * 0.000015,
    savings: "80%",
  };
}

/**
 * OPTIMIZATION 3: Incremental file updates
 * 
 * Don't regenerate entire files - just send diffs
 */
export function createMinimalEdit(
  originalContent: string,
  newContent: string
): { type: "full" | "diff"; content: string; tokensSaved: number } {
  if (originalContent === newContent) {
    return { type: "diff", content: "", tokensSaved: estimateTokens(originalContent) };
  }

  const originalLines = originalContent.split("\n");
  const newLines = newContent.split("\n");

  // Find changed regions
  const changes: Array<{ start: number; end: number; newLines: string[] }> = [];
  let i = 0;
  let j = 0;

  while (i < originalLines.length || j < newLines.length) {
    if (originalLines[i] === newLines[j]) {
      i++;
      j++;
    } else {
      // Find extent of change
      const changeStart = j;
      const originalStart = i;

      // Skip until we find matching lines again
      while (
        i < originalLines.length &&
        j < newLines.length &&
        originalLines[i] !== newLines[j]
      ) {
        j++;
        if (j - changeStart > 50) {
          // Too many changes, use full replacement
          return {
            type: "full",
            content: newContent,
            tokensSaved: 0,
          };
        }
      }

      changes.push({
        start: originalStart,
        end: i,
        newLines: newLines.slice(changeStart, j),
      });
    }
  }

  if (changes.length === 0) {
    return { type: "diff", content: "", tokensSaved: estimateTokens(originalContent) };
  }

  // Generate minimal diff
  const diffContent = changes
    .map((c) => `@@ Line ${c.start + 1}-${c.end + 1} @@\n${c.newLines.join("\n")}`)
    .join("\n\n");

  const tokensSaved = estimateTokens(originalContent) - estimateTokens(diffContent);

  if (tokensSaved > 100) {
    metrics.tokensSaved += tokensSaved;
    return { type: "diff", content: diffContent, tokensSaved };
  }

  return { type: "full", content: newContent, tokensSaved: 0 };
}

/**
 * OPTIMIZATION 4: Smart context selection
 * 
 * Don't send the entire codebase - just relevant files
 */
export function selectRelevantContext(
  prompt: string,
  availableFiles: string[],
  maxTokens: number = 10000
): string[] {
  const promptLower = prompt.toLowerCase();
  const relevantFiles: Array<{ file: string; score: number }> = [];

  for (const file of availableFiles) {
    let score = 0;

    // Direct mention
    if (promptLower.includes(file.toLowerCase())) {
      score += 100;
    }

    // File type relevance
    const ext = file.split(".").pop()?.toLowerCase();
    if (promptLower.includes("typescript") && (ext === "ts" || ext === "tsx")) {
      score += 20;
    }
    if (promptLower.includes("style") && (ext === "css" || ext === "scss")) {
      score += 20;
    }
    if (promptLower.includes("test") && file.includes("test")) {
      score += 30;
    }

    // Keyword matching
    const keywords = prompt.match(/\b\w{4,}\b/g) || [];
    for (const keyword of keywords) {
      if (file.toLowerCase().includes(keyword.toLowerCase())) {
        score += 10;
      }
    }

    if (score > 0) {
      relevantFiles.push({ file, score });
    }
  }

  // Sort by relevance and take top files within token budget
  relevantFiles.sort((a, b) => b.score - a.score);

  const selected: string[] = [];
  let totalTokens = 0;

  for (const { file } of relevantFiles) {
    const fileTokens = estimateFileTokens(file);
    if (totalTokens + fileTokens <= maxTokens) {
      selected.push(file);
      totalTokens += fileTokens;
    }
  }

  const avoided = availableFiles.length - selected.length;
  if (avoided > 0) {
    metrics.unnecessaryReadsAvoided += avoided;
  }

  return selected;
}

/**
 * OPTIMIZATION 5: Response validation
 * 
 * Catch vague or incomplete responses immediately
 */
export interface ResponseValidation {
  isValid: boolean;
  issues: string[];
  suggestions: string[];
}

export function validateResponse(
  response: string,
  expectedAction: "edit" | "explain" | "create" | "fix"
): ResponseValidation {
  const issues: string[] = [];
  const suggestions: string[] = [];

  // Check for vague responses
  const vaguePatterns = [
    /I('ve| have) (updated|modified|changed|fixed) (the|your)/i,
    /Here('s| is) (the|your) (updated|modified|new)/i,
    /I('ll| will) (update|modify|change|fix)/i,
  ];

  const hasVagueResponse = vaguePatterns.some((p) => p.test(response));

  if (expectedAction === "edit" || expectedAction === "fix") {
    // Should contain actual code
    const hasCodeBlock = /```[\s\S]*```/.test(response);
    const hasSpecificFile = /`[^`]+\.(ts|js|py|tsx|jsx|css|html)`/.test(response);

    if (hasVagueResponse && !hasCodeBlock) {
      issues.push("Response claims to make changes but shows no code");
      suggestions.push("Ask: 'Show me the exact code changes'");
    }

    if (!hasSpecificFile && !hasCodeBlock) {
      issues.push("No specific file or code mentioned");
      suggestions.push("Ask: 'Which file should I modify and what's the exact change?'");
    }
  }

  if (expectedAction === "create") {
    const hasCodeBlock = /```[\s\S]*```/.test(response);
    if (!hasCodeBlock) {
      issues.push("Asked to create code but no code provided");
      suggestions.push("Ask: 'Please provide the complete code'");
    }
  }

  // Check for incomplete code blocks
  const codeBlockStarts = (response.match(/```/g) || []).length;
  if (codeBlockStarts % 2 !== 0) {
    issues.push("Incomplete code block detected");
    suggestions.push("Response may have been cut off - ask to continue");
  }

  return {
    isValid: issues.length === 0,
    issues,
    suggestions,
  };
}

/**
 * Get efficiency metrics
 */
export function getEfficiencyMetrics(): EfficiencyMetrics & {
  savingsPercentage: number;
  estimatedMoneySaved: number;
} {
  const totalTokens = metrics.tokensUsed + metrics.tokensSaved;
  const savingsPercentage =
    totalTokens > 0 ? Math.round((metrics.tokensSaved / totalTokens) * 100) : 0;

  // Estimate money saved (assuming Claude Opus rates)
  const estimatedMoneySaved = (metrics.tokensSaved / 1000000) * 15;

  return {
    ...metrics,
    savingsPercentage,
    estimatedMoneySaved,
  };
}

export function recordTokenUsage(tokens: number): void {
  metrics.tokensUsed += tokens;
}

export function recordCacheHit(): void {
  metrics.cacheHits++;
}

export function recordCacheMiss(): void {
  metrics.cacheMisses++;
}

/**
 * Show efficiency report
 */
export function showEfficiencyReport(): void {
  const m = getEfficiencyMetrics();

  const message = `
## 📊 Efficiency Report

| Metric | Value |
|--------|-------|
| Tokens Used | ${m.tokensUsed.toLocaleString()} |
| Tokens Saved | ${m.tokensSaved.toLocaleString()} |
| **Savings** | **${m.savingsPercentage}%** |
| Est. Money Saved | $${m.estimatedMoneySaved.toFixed(2)} |
| Cache Hits | ${m.cacheHits} |
| Duplicates Blocked | ${m.duplicateRequestsBlocked} |
| Model Downgrades | ${m.modelDowngrades} |
| Unnecessary Reads Avoided | ${m.unnecessaryReadsAvoided} |
`;

  vscode.window.showInformationMessage(
    `Efficiency: ${m.savingsPercentage}% tokens saved (~$${m.estimatedMoneySaved.toFixed(2)})`,
    "Show Details"
  ).then((choice) => {
    if (choice === "Show Details") {
      // Show in output channel
      const channel = vscode.window.createOutputChannel("Claude Code Efficiency");
      channel.appendLine(message);
      channel.show();
    }
  });
}

// Helper functions
function hashPrompt(prompt: string): string {
  return crypto.createHash("md5").update(prompt).digest("hex");
}

function estimateTokens(text: string): number {
  // Rough estimate: 4 chars per token
  return Math.ceil(text.length / 4);
}

function estimateFileTokens(filePath: string): number {
  // Estimate based on typical file sizes
  const ext = filePath.split(".").pop()?.toLowerCase();
  const estimates: Record<string, number> = {
    ts: 500,
    tsx: 800,
    js: 400,
    jsx: 700,
    css: 300,
    json: 200,
    md: 400,
  };
  return estimates[ext || ""] || 300;
}

// Reset metrics (for testing)
export function resetMetrics(): void {
  metrics = {
    tokensUsed: 0,
    tokensSaved: 0,
    cacheHits: 0,
    cacheMisses: 0,
    modelDowngrades: 0,
    duplicateRequestsBlocked: 0,
    unnecessaryReadsAvoided: 0,
  };
}
