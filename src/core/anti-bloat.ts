/**
 * Anti-Bloat Engine
 * 
 * The core philosophy: MAXIMIZE USER EFFICIENCY, not API consumption
 * 
 * This module actively detects and prevents patterns that waste time/money:
 * 
 * 1. VAGUE RESPONSES - AI says "I updated the file" but shows nothing
 * 2. OVER-ENGINEERING - Simple request → complex abstraction
 * 3. REGENERATION WASTE - 1 line change → entire file rewritten
 * 4. CONTEXT BLOAT - Simple question → entire codebase sent
 * 5. ERROR ACCUMULATION - Problems stack up until end
 * 6. DUPLICATE WORK - Same question = same API call
 * 7. WRONG MODEL - Simple task → expensive model
 */

import * as vscode from "vscode";
import * as crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// ANTI-PATTERN DETECTION
// ═══════════════════════════════════════════════════════════════════════════

export interface DetectedIssue {
  type: 
    | "vague_response"
    | "over_engineering"
    | "regeneration_waste"
    | "context_bloat"
    | "duplicate_request"
    | "wrong_model"
    | "incomplete_code"
    | "hallucinated_file";
  severity: "low" | "medium" | "high";
  message: string;
  suggestion: string;
  tokensSaved?: number;
  costSaved?: number;
}

/**
 * Detect vague AI responses that don't actually help
 */
export function detectVagueResponse(response: string): DetectedIssue | null {
  const vaguePatterns = [
    { pattern: /I('ve| have) (updated|modified|changed|fixed) (the|your) /i, msg: "Claims to update but may not show code" },
    { pattern: /Here('s| is) (the|your) (updated|modified|new) /i, msg: "May not include actual code" },
    { pattern: /I('ll| will) (update|modify|change|fix) /i, msg: "States intention but hasn't done it" },
    { pattern: /You (can|should|could) (try|use|add) /i, msg: "Suggests action without doing it" },
    { pattern: /Let me know if (you need|you want|that) /i, msg: "Deflects rather than completes" },
  ];

  // Check if response has actual code
  const hasCodeBlock = /```[\s\S]*?```/.test(response);
  const hasFilePath = /`[^`]+\.(ts|js|py|tsx|jsx|css|html|json)`/.test(response);
  const hasLineNumbers = /line \d+|:\d+:/i.test(response);

  for (const { pattern, msg } of vaguePatterns) {
    if (pattern.test(response) && !hasCodeBlock && !hasFilePath) {
      return {
        type: "vague_response",
        severity: "high",
        message: msg,
        suggestion: "Ask: 'Show me the exact code changes with file paths'",
      };
    }
  }

  // Check for incomplete code blocks
  const codeBlockCount = (response.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    return {
      type: "incomplete_code",
      severity: "medium",
      message: "Code block appears incomplete (unmatched ```)",
      suggestion: "Ask: 'Please complete the code block'",
    };
  }

  return null;
}

/**
 * Detect over-engineering patterns
 */
export function detectOverEngineering(
  prompt: string,
  response: string
): DetectedIssue | null {
  const promptLower = prompt.toLowerCase();
  const promptWords = prompt.split(/\s+/).length;

  // Simple prompt indicators
  const isSimpleRequest = 
    promptWords < 20 ||
    /^(add|fix|change|update|rename|move|delete)/i.test(prompt) ||
    /simple|quick|just|only/i.test(prompt);

  if (!isSimpleRequest) return null;

  // Check for over-engineering in response
  const overEngineeringPatterns = [
    { pattern: /abstract\s+(class|factory|base)/i, msg: "Creating abstractions for simple task" },
    { pattern: /implements\s+\w+Interface/i, msg: "Adding interfaces unnecessarily" },
    { pattern: /generic.*<T>/i, msg: "Adding generics for simple task" },
    { pattern: /DependencyInjection|IoC|Container/i, msg: "Adding DI for simple task" },
    { pattern: /EventEmitter|Observable|Subject/i, msg: "Adding reactive patterns unnecessarily" },
    { pattern: /Strategy|Factory|Singleton|Observer/i, msg: "Adding design patterns for simple task" },
  ];

  for (const { pattern, msg } of overEngineeringPatterns) {
    if (pattern.test(response)) {
      return {
        type: "over_engineering",
        severity: "medium",
        message: msg,
        suggestion: "Ask: 'Can you simplify this? I just need a basic implementation'",
      };
    }
  }

  // Check if response is way longer than needed
  const responseWords = response.split(/\s+/).length;
  const codeLines = (response.match(/\n/g) || []).length;

  if (promptWords < 10 && codeLines > 100) {
    return {
      type: "over_engineering",
      severity: "low",
      message: "Response seems much longer than task requires",
      suggestion: "Consider if all this code is necessary",
    };
  }

  return null;
}

/**
 * Detect regeneration waste - when entire files are rewritten for small changes
 */
export function detectRegenerationWaste(
  originalContent: string,
  newContent: string
): DetectedIssue | null {
  if (!originalContent || !newContent) return null;

  const originalLines = originalContent.split("\n");
  const newLines = newContent.split("\n");

  // Count changed lines
  let changedLines = 0;
  const minLength = Math.min(originalLines.length, newLines.length);

  for (let i = 0; i < minLength; i++) {
    if (originalLines[i] !== newLines[i]) {
      changedLines++;
    }
  }

  changedLines += Math.abs(originalLines.length - newLines.length);

  const changePercent = (changedLines / originalLines.length) * 100;
  const tokensWasted = Math.max(0, newContent.length / 4 - changedLines * 20);

  // If only a few lines changed but entire file was regenerated
  if (changedLines <= 5 && originalLines.length > 50) {
    return {
      type: "regeneration_waste",
      severity: "high",
      message: `Only ${changedLines} lines changed, but ${newLines.length} lines generated`,
      suggestion: "Use targeted edits instead of full file regeneration",
      tokensSaved: Math.round(tokensWasted),
      costSaved: (tokensWasted / 1000000) * 15, // Opus rate
    };
  }

  if (changePercent < 10 && originalLines.length > 100) {
    return {
      type: "regeneration_waste",
      severity: "medium",
      message: `Only ${changePercent.toFixed(1)}% of file changed`,
      suggestion: "Request diff-based edits for efficiency",
      tokensSaved: Math.round(tokensWasted),
    };
  }

  return null;
}

/**
 * Detect context bloat - too much unnecessary context
 */
export function detectContextBloat(
  contextFiles: string[],
  prompt: string
): DetectedIssue | null {
  if (contextFiles.length <= 3) return null;

  const promptLower = prompt.toLowerCase();

  // Check if prompt mentions specific files
  const mentionedFiles = contextFiles.filter((f) => {
    const fileName = f.split("/").pop()?.toLowerCase() || "";
    return promptLower.includes(fileName);
  });

  const unusedFiles = contextFiles.length - Math.max(mentionedFiles.length, 1);

  if (unusedFiles > 5) {
    const estimatedTokens = unusedFiles * 500; // ~500 tokens per file avg

    return {
      type: "context_bloat",
      severity: unusedFiles > 10 ? "high" : "medium",
      message: `${unusedFiles} files included but not referenced in prompt`,
      suggestion: "Only include files directly relevant to the task",
      tokensSaved: estimatedTokens,
      costSaved: (estimatedTokens / 1000000) * 15,
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// REQUEST OPTIMIZATION
// ═══════════════════════════════════════════════════════════════════════════

// Duplicate request cache
const requestCache = new Map<string, { response: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check for duplicate requests
 */
export function checkDuplicateRequest(prompt: string): string | null {
  const hash = hashPrompt(prompt);
  const cached = requestCache.get(hash);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.response;
  }

  return null;
}

/**
 * Cache a request response
 */
export function cacheRequest(prompt: string, response: string): void {
  const hash = hashPrompt(prompt);
  requestCache.set(hash, { response, timestamp: Date.now() });

  // Cleanup old entries
  for (const [key, value] of requestCache) {
    if (Date.now() - value.timestamp > CACHE_TTL) {
      requestCache.delete(key);
    }
  }
}

function hashPrompt(prompt: string): string {
  // Normalize prompt before hashing
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  return crypto.createHash("md5").update(normalized).digest("hex");
}

// ═══════════════════════════════════════════════════════════════════════════
// SMART MODEL SELECTION
// ═══════════════════════════════════════════════════════════════════════════

export interface ModelRecommendation {
  model: string;
  provider: "ollama" | "groq" | "openai" | "anthropic";
  reason: string;
  estimatedCost: number;
  alternativeCost: number;
  savingsPercent: number;
}

/**
 * Recommend the most cost-effective model for a task
 */
export function recommendModel(prompt: string): ModelRecommendation {
  const promptLower = prompt.toLowerCase();
  const promptLength = prompt.length;

  // TIER 1: Ollama (FREE) - Simple questions, formatting, typos
  const tier1Patterns = [
    /^(what|how|explain|describe|list|show)\s/i,
    /fix\s+(this\s+)?(typo|spelling|indent)/i,
    /add\s+(a\s+)?comment/i,
    /^rename\s/i,
    /^format\s/i,
    /simple|basic|quick/i,
  ];

  if (tier1Patterns.some((p) => p.test(promptLower)) || promptLength < 100) {
    return {
      model: "qwen2.5-coder:7b",
      provider: "ollama",
      reason: "Simple task - using FREE local model",
      estimatedCost: 0,
      alternativeCost: 0.015, // What Opus would cost
      savingsPercent: 100,
    };
  }

  // TIER 2: Groq (very cheap) - Medium complexity, code generation
  const tier2Patterns = [
    /^(create|write|generate|implement)\s/i,
    /function|method|class|component/i,
    /unit test|test case/i,
  ];

  if (tier2Patterns.some((p) => p.test(promptLower))) {
    return {
      model: "llama-3.1-70b-versatile",
      provider: "groq",
      reason: "Code generation - using fast cheap model",
      estimatedCost: 0.0005,
      alternativeCost: 0.015,
      savingsPercent: 97,
    };
  }

  // TIER 3: Claude Sonnet - Complex tasks, refactoring
  const tier3Patterns = [
    /refactor|restructure|reorganize/i,
    /debug|investigate|troubleshoot/i,
    /review|analyze|audit/i,
    /optimize|improve|enhance/i,
  ];

  if (tier3Patterns.some((p) => p.test(promptLower))) {
    return {
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
      reason: "Complex task - using balanced model",
      estimatedCost: 0.003,
      alternativeCost: 0.015,
      savingsPercent: 80,
    };
  }

  // TIER 4: Claude Opus - Architecture, security, critical decisions
  const tier4Patterns = [
    /architect|design system|infrastructure/i,
    /security (audit|review|vulnerability)/i,
    /migration|major refactor/i,
    /critical|production|deploy/i,
  ];

  if (tier4Patterns.some((p) => p.test(promptLower))) {
    return {
      model: "claude-opus-4-20250514",
      provider: "anthropic",
      reason: "Critical task - using best model",
      estimatedCost: 0.015,
      alternativeCost: 0.015,
      savingsPercent: 0,
    };
  }

  // Default to Sonnet for unknown tasks
  return {
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    reason: "Standard task",
    estimatedCost: 0.003,
    alternativeCost: 0.015,
    savingsPercent: 80,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// INCREMENTAL VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

let errorCount = 0;
let lastErrorCheck = Date.now();

/**
 * Track error accumulation - warn before it gets out of hand
 */
export function trackErrors(newErrors: number): DetectedIssue | null {
  const now = Date.now();
  const timeSinceLastCheck = now - lastErrorCheck;
  lastErrorCheck = now;

  // If errors are accumulating quickly
  if (newErrors > errorCount + 3 && timeSinceLastCheck < 60000) {
    const issue: DetectedIssue = {
      type: "hallucinated_file",
      severity: "high",
      message: `Errors increasing: ${errorCount} → ${newErrors}`,
      suggestion: "Stop and fix current errors before continuing",
    };
    errorCount = newErrors;
    return issue;
  }

  errorCount = newErrors;
  return null;
}

/**
 * Reset error tracking
 */
export function resetErrorTracking(): void {
  errorCount = 0;
  lastErrorCheck = Date.now();
}

// ═══════════════════════════════════════════════════════════════════════════
// METRICS & REPORTING
// ═══════════════════════════════════════════════════════════════════════════

interface SessionMetrics {
  requestsMade: number;
  requestsCached: number;
  tokensUsed: number;
  tokensSaved: number;
  issuesDetected: number;
  issuesPrevented: number;
  estimatedCost: number;
  estimatedSavings: number;
}

const metrics: SessionMetrics = {
  requestsMade: 0,
  requestsCached: 0,
  tokensUsed: 0,
  tokensSaved: 0,
  issuesDetected: 0,
  issuesPrevented: 0,
  estimatedCost: 0,
  estimatedSavings: 0,
};

export function recordRequest(tokens: number, cached: boolean): void {
  metrics.requestsMade++;
  if (cached) {
    metrics.requestsCached++;
    metrics.tokensSaved += tokens;
  } else {
    metrics.tokensUsed += tokens;
  }
}

export function recordIssue(prevented: boolean, savings?: number): void {
  metrics.issuesDetected++;
  if (prevented) {
    metrics.issuesPrevented++;
    if (savings) {
      metrics.estimatedSavings += savings;
    }
  }
}

export function recordCost(cost: number, savings: number): void {
  metrics.estimatedCost += cost;
  metrics.estimatedSavings += savings;
}

export function getMetrics(): SessionMetrics & {
  cacheHitRate: number;
  preventionRate: number;
  savingsPercent: number;
} {
  const cacheHitRate =
    metrics.requestsMade > 0
      ? (metrics.requestsCached / metrics.requestsMade) * 100
      : 0;

  const preventionRate =
    metrics.issuesDetected > 0
      ? (metrics.issuesPrevented / metrics.issuesDetected) * 100
      : 0;

  const totalCost = metrics.estimatedCost + metrics.estimatedSavings;
  const savingsPercent = totalCost > 0 ? (metrics.estimatedSavings / totalCost) * 100 : 0;

  return {
    ...metrics,
    cacheHitRate,
    preventionRate,
    savingsPercent,
  };
}

export function resetMetrics(): void {
  metrics.requestsMade = 0;
  metrics.requestsCached = 0;
  metrics.tokensUsed = 0;
  metrics.tokensSaved = 0;
  metrics.issuesDetected = 0;
  metrics.issuesPrevented = 0;
  metrics.estimatedCost = 0;
  metrics.estimatedSavings = 0;
}

/**
 * Show efficiency dashboard
 */
export function showEfficiencyDashboard(): void {
  const m = getMetrics();

  const panel = vscode.window.createWebviewPanel(
    "efficiencyDashboard",
    "MythaTron Efficiency",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui; background: #0d1117; color: #c9d1d9; padding: 30px; }
    h1 { color: #58a6ff; border-bottom: 1px solid #30363d; padding-bottom: 15px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 30px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 20px; }
    .card h3 { color: #8b949e; font-size: 14px; margin-bottom: 10px; }
    .card .value { font-size: 32px; font-weight: bold; color: #3fb950; }
    .card .value.warning { color: #d29922; }
    .card .value.neutral { color: #58a6ff; }
    .card .label { color: #8b949e; font-size: 12px; margin-top: 5px; }
    .savings { font-size: 48px; color: #3fb950; text-align: center; margin: 30px 0; }
  </style>
</head>
<body>
  <h1>⚡ MythaTron Efficiency Dashboard</h1>
  
  <div class="savings">
    💰 $${m.estimatedSavings.toFixed(2)} saved
  </div>

  <div class="grid">
    <div class="card">
      <h3>CACHE HIT RATE</h3>
      <div class="value">${m.cacheHitRate.toFixed(0)}%</div>
      <div class="label">${m.requestsCached} of ${m.requestsMade} requests cached</div>
    </div>
    
    <div class="card">
      <h3>TOKENS SAVED</h3>
      <div class="value">${m.tokensSaved.toLocaleString()}</div>
      <div class="label">vs ${(m.tokensUsed + m.tokensSaved).toLocaleString()} total</div>
    </div>
    
    <div class="card">
      <h3>ISSUES PREVENTED</h3>
      <div class="value">${m.issuesPrevented}</div>
      <div class="label">${m.preventionRate.toFixed(0)}% prevention rate</div>
    </div>
    
    <div class="card">
      <h3>ACTUAL COST</h3>
      <div class="value neutral">$${m.estimatedCost.toFixed(2)}</div>
      <div class="label">Without optimization: $${(m.estimatedCost + m.estimatedSavings).toFixed(2)}</div>
    </div>
    
    <div class="card">
      <h3>SAVINGS RATE</h3>
      <div class="value">${m.savingsPercent.toFixed(0)}%</div>
      <div class="label">Compared to baseline</div>
    </div>
    
    <div class="card">
      <h3>REQUESTS</h3>
      <div class="value neutral">${m.requestsMade}</div>
      <div class="label">Total this session</div>
    </div>
  </div>
</body>
</html>`;
}
