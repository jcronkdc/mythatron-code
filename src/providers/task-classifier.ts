/**
 * Task Classifier - Determines complexity and routes to optimal model
 * The brain that saves you money by using the right model for each task
 */

import type { TaskComplexity, TaskCategory } from "./types";

interface ClassificationResult {
  category: TaskCategory;
  complexity: TaskComplexity;
  confidence: number;
  reasoning: string;
  suggestedProvider: "ollama" | "groq" | "openai" | "anthropic";
  suggestedModel: string;
}

// Keywords that indicate different task types
const TASK_INDICATORS = {
  explain: {
    keywords: [
      "explain",
      "what does",
      "what is",
      "how does",
      "understand",
      "describe",
      "tell me about",
      "meaning of",
      "definition",
    ],
    complexity: "simple" as TaskComplexity,
  },
  autocomplete: {
    keywords: ["complete", "finish", "continue", "next line", "autocomplete"],
    complexity: "simple" as TaskComplexity,
  },
  refactor: {
    keywords: [
      "refactor",
      "improve",
      "optimize",
      "clean up",
      "simplify",
      "restructure",
      "rename",
      "extract",
    ],
    complexity: "medium" as TaskComplexity,
  },
  generate_tests: {
    keywords: [
      "test",
      "tests",
      "testing",
      "unit test",
      "spec",
      "coverage",
      "jest",
      "vitest",
      "pytest",
    ],
    complexity: "medium" as TaskComplexity,
  },
  fix_error: {
    keywords: [
      "fix",
      "error",
      "bug",
      "issue",
      "problem",
      "broken",
      "not working",
      "failing",
      "crash",
    ],
    complexity: "medium" as TaskComplexity,
  },
  multi_file_edit: {
    keywords: [
      "all files",
      "multiple files",
      "across the project",
      "everywhere",
      "throughout",
      "global",
      "codebase-wide",
    ],
    complexity: "complex" as TaskComplexity,
  },
  architecture: {
    keywords: [
      "architecture",
      "design",
      "structure",
      "pattern",
      "system",
      "scalability",
      "migrate",
      "migration",
      "convert",
    ],
    complexity: "complex" as TaskComplexity,
  },
  debug_complex: {
    keywords: [
      "debug",
      "trace",
      "investigate",
      "race condition",
      "memory leak",
      "performance",
      "profiling",
    ],
    complexity: "complex" as TaskComplexity,
  },
};

// Complexity escalators - things that make tasks harder
const COMPLEXITY_ESCALATORS = [
  { pattern: /multiple files?/i, weight: 1 },
  { pattern: /entire (project|codebase)/i, weight: 2 },
  { pattern: /refactor.*(and|with|also)/i, weight: 1 },
  { pattern: /complex|complicated|difficult/i, weight: 1 },
  { pattern: /architecture|system design/i, weight: 2 },
  { pattern: /security|vulnerability/i, weight: 1 },
  { pattern: /performance|optimization/i, weight: 1 },
  { pattern: /database|migration/i, weight: 1 },
  { pattern: /api design|interface/i, weight: 1 },
];

// Model recommendations by complexity
const MODEL_RECOMMENDATIONS = {
  simple: {
    // Use local models for simple tasks - FREE
    primary: { provider: "ollama" as const, model: "qwen2.5-coder" },
    fallback: { provider: "groq" as const, model: "llama-3.1-8b-instant" },
    premium: { provider: "openai" as const, model: "gpt-4o-mini" },
  },
  medium: {
    // Use fast cheap APIs for medium tasks
    primary: { provider: "groq" as const, model: "llama-3.1-70b-versatile" },
    fallback: { provider: "openai" as const, model: "gpt-4o-mini" },
    premium: { provider: "anthropic" as const, model: "claude-3-5-haiku-20241022" },
  },
  complex: {
    // Use the big guns for complex tasks
    primary: { provider: "anthropic" as const, model: "claude-sonnet-4-20250514" },
    fallback: { provider: "openai" as const, model: "gpt-4o" },
    premium: { provider: "anthropic" as const, model: "claude-opus-4-20250514" },
  },
};

export class TaskClassifier {
  private useLocalModels: boolean;
  private availableProviders: Set<string>;

  constructor(
    options: {
      useLocalModels?: boolean;
      availableProviders?: string[];
    } = {}
  ) {
    this.useLocalModels = options.useLocalModels ?? true;
    this.availableProviders = new Set(
      options.availableProviders || ["anthropic", "openai", "groq", "ollama"]
    );
  }

  setAvailableProviders(providers: string[]): void {
    this.availableProviders = new Set(providers);
  }

  classify(message: string, context?: ClassificationContext): ClassificationResult {
    const messageLower = message.toLowerCase();

    // Detect task category
    let detectedCategory: TaskCategory = "chat";
    let baseComplexity: TaskComplexity = "medium";
    let matchedKeywords: string[] = [];

    for (const [category, config] of Object.entries(TASK_INDICATORS)) {
      for (const keyword of config.keywords) {
        if (messageLower.includes(keyword)) {
          detectedCategory = category as TaskCategory;
          baseComplexity = config.complexity;
          matchedKeywords.push(keyword);
          break;
        }
      }
      if (matchedKeywords.length > 0) break;
    }

    // Calculate complexity score
    let complexityScore = baseComplexity === "simple" ? 0 : baseComplexity === "medium" ? 3 : 6;

    for (const escalator of COMPLEXITY_ESCALATORS) {
      if (escalator.pattern.test(message)) {
        complexityScore += escalator.weight;
      }
    }

    // Add context-based complexity
    if (context) {
      // Long code = more complex
      if (context.codeLength && context.codeLength > 500) {
        complexityScore += 1;
      }
      if (context.codeLength && context.codeLength > 2000) {
        complexityScore += 2;
      }

      // Multiple files = more complex
      if (context.fileCount && context.fileCount > 1) {
        complexityScore += context.fileCount;
      }

      // Conversation history = needs context awareness
      if (context.conversationLength && context.conversationLength > 5) {
        complexityScore += 1;
      }
    }

    // Determine final complexity
    let finalComplexity: TaskComplexity;
    if (complexityScore <= 2) {
      finalComplexity = "simple";
    } else if (complexityScore <= 5) {
      finalComplexity = "medium";
    } else {
      finalComplexity = "complex";
    }

    // Get model recommendation
    const recommendation = this.getModelRecommendation(finalComplexity);

    // Calculate confidence
    const confidence = matchedKeywords.length > 0 ? 0.8 : 0.5;

    return {
      category: detectedCategory,
      complexity: finalComplexity,
      confidence,
      reasoning: this.buildReasoning(
        detectedCategory,
        finalComplexity,
        matchedKeywords,
        complexityScore
      ),
      suggestedProvider: recommendation.provider,
      suggestedModel: recommendation.model,
    };
  }

  private getModelRecommendation(
    complexity: TaskComplexity
  ): { provider: "ollama" | "groq" | "openai" | "anthropic"; model: string } {
    const recommendations = MODEL_RECOMMENDATIONS[complexity];

    // Try primary if available
    if (
      this.useLocalModels &&
      recommendations.primary.provider === "ollama" &&
      this.availableProviders.has("ollama")
    ) {
      return recommendations.primary;
    }

    if (this.availableProviders.has(recommendations.primary.provider)) {
      return recommendations.primary;
    }

    // Try fallback
    if (this.availableProviders.has(recommendations.fallback.provider)) {
      return recommendations.fallback;
    }

    // Try premium
    if (this.availableProviders.has(recommendations.premium.provider)) {
      return recommendations.premium;
    }

    // Default to Anthropic
    return { provider: "anthropic", model: "claude-sonnet-4-20250514" };
  }

  private buildReasoning(
    category: TaskCategory,
    complexity: TaskComplexity,
    keywords: string[],
    score: number
  ): string {
    const parts = [
      `Task category: ${category}`,
      `Complexity: ${complexity} (score: ${score})`,
    ];

    if (keywords.length > 0) {
      parts.push(`Detected keywords: ${keywords.join(", ")}`);
    }

    return parts.join(" | ");
  }

  // Force a specific complexity level (user override)
  forceComplexity(complexity: TaskComplexity): {
    provider: "ollama" | "groq" | "openai" | "anthropic";
    model: string;
  } {
    return this.getModelRecommendation(complexity);
  }

  // Get estimated cost savings
  estimateSavings(
    messages: { category: TaskCategory; complexity: TaskComplexity }[]
  ): {
    withRouting: number;
    withoutRouting: number;
    savings: number;
    savingsPercent: number;
  } {
    const { MODEL_PRICING } = require("./types");

    // Assume 1000 input tokens, 500 output tokens per message average
    const avgInput = 1000;
    const avgOutput = 500;

    let withoutRouting = 0;
    let withRouting = 0;

    const sonnetPricing = MODEL_PRICING["claude-sonnet-4-20250514"];

    for (const msg of messages) {
      // Without routing: always use Sonnet
      withoutRouting +=
        (avgInput * sonnetPricing.input + avgOutput * sonnetPricing.output) / 1_000_000;

      // With routing: use appropriate model
      const rec = this.getModelRecommendation(msg.complexity);
      const pricing = MODEL_PRICING[rec.model] || sonnetPricing;
      withRouting +=
        (avgInput * pricing.input + avgOutput * pricing.output) / 1_000_000;
    }

    return {
      withRouting,
      withoutRouting,
      savings: withoutRouting - withRouting,
      savingsPercent:
        withoutRouting > 0
          ? ((withoutRouting - withRouting) / withoutRouting) * 100
          : 0,
    };
  }
}

interface ClassificationContext {
  codeLength?: number;
  fileCount?: number;
  conversationLength?: number;
  hasToolUse?: boolean;
}

// Singleton for easy use
let defaultClassifier: TaskClassifier | null = null;

export function getTaskClassifier(): TaskClassifier {
  if (!defaultClassifier) {
    defaultClassifier = new TaskClassifier();
  }
  return defaultClassifier;
}

