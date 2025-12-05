/**
 * Provider Manager - Unified interface for all LLM providers
 * Handles: Provider selection, failover, caching, cost tracking
 */

import * as vscode from "vscode";
import type {
  LLMProvider,
  ProviderType,
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  TaskComplexity,
} from "./types";
import { AnthropicProvider } from "./anthropic-provider";
import { OpenAIProvider } from "./openai-provider";
import { GroqProvider } from "./groq-provider";
import { OllamaProvider } from "./ollama-provider";
import { TaskClassifier } from "./task-classifier";

interface CacheEntry {
  response: CompletionResponse;
  timestamp: number;
}

interface CostTracking {
  provider: ProviderType;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: Date;
}

export class ProviderManager {
  private providers: Map<string, LLMProvider> = new Map();
  private classifier: TaskClassifier;
  private cache: Map<string, CacheEntry> = new Map();
  private costHistory: CostTracking[] = [];
  private totalCost = 0;
  
  // Callbacks
  private onCostUpdate?: (cost: { total: number; session: CostTracking[] }) => void;

  constructor() {
    this.classifier = new TaskClassifier();
    this.initializeProviders();
  }

  private async initializeProviders(): Promise<void> {
    const config = vscode.workspace.getConfiguration("claudeCode");

    // Initialize Anthropic (required)
    const anthropicKey = config.get<string>("apiKey");
    if (anthropicKey) {
      this.registerProvider("anthropic", {
        type: "anthropic",
        apiKey: anthropicKey,
        model: config.get<string>("model") || "claude-sonnet-4-20250514",
      });
    }

    // Initialize OpenAI (optional)
    const openaiKey = config.get<string>("openaiApiKey");
    if (openaiKey) {
      this.registerProvider("openai", {
        type: "openai",
        apiKey: openaiKey,
        model: config.get<string>("openaiModel") || "gpt-4o-mini",
      });
    }

    // Initialize Groq (optional)
    const groqKey = config.get<string>("groqApiKey");
    if (groqKey) {
      this.registerProvider("groq", {
        type: "groq",
        apiKey: groqKey,
        model: config.get<string>("groqModel") || "llama-3.1-70b-versatile",
      });
    }

    // Initialize Ollama (local, always try)
    const ollamaUrl = config.get<string>("ollamaUrl") || "http://localhost:11434";
    const ollamaModel = config.get<string>("ollamaModel") || "qwen2.5-coder";
    
    this.registerProvider("ollama", {
      type: "ollama",
      baseUrl: ollamaUrl,
      model: ollamaModel,
    });

    // Update classifier with available providers
    const available = await this.getAvailableProviders();
    this.classifier.setAvailableProviders(available);
  }

  registerProvider(name: string, config: ProviderConfig): void {
    let provider: LLMProvider;

    switch (config.type) {
      case "anthropic":
        provider = new AnthropicProvider(config);
        break;
      case "openai":
        provider = new OpenAIProvider(config);
        break;
      case "groq":
        provider = new GroqProvider(config);
        break;
      case "ollama":
        provider = new OllamaProvider(config);
        break;
      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }

    this.providers.set(name, provider);
  }

  async getAvailableProviders(): Promise<string[]> {
    const available: string[] = [];

    for (const [name, provider] of this.providers) {
      try {
        if (await provider.isAvailable()) {
          available.push(name);
        }
      } catch {
        // Provider not available
      }
    }

    return available;
  }

  setOnCostUpdate(callback: (cost: { total: number; session: CostTracking[] }) => void): void {
    this.onCostUpdate = callback;
  }

  private getCacheKey(request: CompletionRequest): string {
    // Create a hash of the request for caching
    const key = JSON.stringify({
      messages: request.messages.slice(-3), // Only last 3 messages for cache key
      tools: request.tools?.map((t) => t.name),
    });
    return key;
  }

  private checkCache(request: CompletionRequest): CompletionResponse | null {
    const key = this.getCacheKey(request);
    const entry = this.cache.get(key);

    if (entry) {
      // Cache valid for 5 minutes
      if (Date.now() - entry.timestamp < 5 * 60 * 1000) {
        return entry.response;
      }
      this.cache.delete(key);
    }

    return null;
  }

  private addToCache(request: CompletionRequest, response: CompletionResponse): void {
    // Don't cache tool use responses
    if (response.toolCalls && response.toolCalls.length > 0) return;
    
    // Don't cache if response is too short (likely incomplete)
    if (response.content.length < 50) return;

    const key = this.getCacheKey(request);
    this.cache.set(key, {
      response,
      timestamp: Date.now(),
    });

    // Limit cache size
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
  }

  private trackCost(provider: LLMProvider, response: CompletionResponse): void {
    if (!response.usage) return;

    const cost = provider.estimateCost(
      response.usage.inputTokens,
      response.usage.outputTokens
    );

    const tracking: CostTracking = {
      provider: provider.type,
      model: provider.model,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cost,
      timestamp: new Date(),
    };

    this.costHistory.push(tracking);
    this.totalCost += cost;

    // Notify listeners
    this.onCostUpdate?.({
      total: this.totalCost,
      session: this.costHistory,
    });

    // Keep only last 1000 entries
    if (this.costHistory.length > 1000) {
      this.costHistory = this.costHistory.slice(-1000);
    }
  }

  async complete(
    request: CompletionRequest,
    options: {
      forceProvider?: ProviderType;
      forceComplexity?: TaskComplexity;
      useCache?: boolean;
    } = {}
  ): Promise<CompletionResponse> {
    // Check cache first
    if (options.useCache !== false) {
      const cached = this.checkCache(request);
      if (cached) {
        return { ...cached, model: cached.model + " (cached)" };
      }
    }

    // Determine which provider to use
    let provider: LLMProvider;

    if (options.forceProvider) {
      provider = this.providers.get(options.forceProvider)!;
      if (!provider) {
        throw new Error(`Provider ${options.forceProvider} not configured`);
      }
    } else {
      // Use classifier to determine best provider
      const lastUserMessage =
        request.messages.filter((m) => m.role === "user").pop()?.content || "";
      
      const classification = options.forceComplexity
        ? {
            ...this.classifier.classify(lastUserMessage),
            ...this.classifier.forceComplexity(options.forceComplexity),
          }
        : this.classifier.classify(lastUserMessage, {
            codeLength: lastUserMessage.length,
            conversationLength: request.messages.length,
            hasToolUse: request.tools && request.tools.length > 0,
          });

      provider = this.providers.get(classification.suggestedProvider)!;

      // Fallback if suggested provider not available
      if (!provider || !(await provider.isAvailable())) {
        provider = this.providers.get("anthropic")!;
      }
    }

    if (!provider) {
      throw new Error("No providers available");
    }

    const response = await provider.complete(request);
    
    // Track cost
    this.trackCost(provider, response);

    // Cache response
    this.addToCache(request, response);

    return response;
  }

  async stream(
    request: CompletionRequest,
    onChunk: (chunk: StreamChunk) => void,
    options: {
      forceProvider?: ProviderType;
      forceComplexity?: TaskComplexity;
    } = {}
  ): Promise<CompletionResponse> {
    // Determine which provider to use
    let provider: LLMProvider;

    if (options.forceProvider) {
      provider = this.providers.get(options.forceProvider)!;
      if (!provider) {
        throw new Error(`Provider ${options.forceProvider} not configured`);
      }
    } else {
      const lastUserMessage =
        request.messages.filter((m) => m.role === "user").pop()?.content || "";
      
      const classification = options.forceComplexity
        ? {
            ...this.classifier.classify(lastUserMessage),
            ...this.classifier.forceComplexity(options.forceComplexity),
          }
        : this.classifier.classify(lastUserMessage, {
            codeLength: lastUserMessage.length,
            conversationLength: request.messages.length,
            hasToolUse: request.tools && request.tools.length > 0,
          });

      provider = this.providers.get(classification.suggestedProvider)!;

      if (!provider || !(await provider.isAvailable())) {
        provider = this.providers.get("anthropic")!;
      }
    }

    if (!provider) {
      throw new Error("No providers available");
    }

    const response = await provider.stream(request, onChunk);
    
    // Track cost
    this.trackCost(provider, response);

    return response;
  }

  getCostSummary(): {
    totalCost: number;
    byProvider: Record<string, number>;
    byModel: Record<string, number>;
    last24Hours: number;
    estimatedMonthlySavings: number;
  } {
    const byProvider: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    let last24Hours = 0;

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const entry of this.costHistory) {
      byProvider[entry.provider] = (byProvider[entry.provider] || 0) + entry.cost;
      byModel[entry.model] = (byModel[entry.model] || 0) + entry.cost;

      if (entry.timestamp.getTime() > oneDayAgo) {
        last24Hours += entry.cost;
      }
    }

    // Estimate monthly savings compared to using Claude Sonnet for everything
    const messages = this.costHistory.map((h) => ({
      category: "chat" as const,
      complexity: h.model.includes("llama") || h.model.includes("qwen")
        ? ("simple" as const)
        : h.model.includes("haiku") || h.model.includes("mini")
        ? ("medium" as const)
        : ("complex" as const),
    }));

    const savings = this.classifier.estimateSavings(messages);

    return {
      totalCost: this.totalCost,
      byProvider,
      byModel,
      last24Hours,
      estimatedMonthlySavings: savings.savings * 30, // Rough monthly estimate
    };
  }

  getClassifier(): TaskClassifier {
    return this.classifier;
  }

  clearCache(): void {
    this.cache.clear();
  }

  resetCostTracking(): void {
    this.costHistory = [];
    this.totalCost = 0;
  }

  getCurrentModel(): string {
    const anthropic = this.providers.get("anthropic");
    return anthropic?.model || "unknown";
  }

  isSmartRoutingEnabled(): boolean {
    const config = vscode.workspace.getConfiguration("claudeCode");
    return config.get<boolean>("enableSmartRouting") ?? true;
  }

  async reinitialize(): Promise<void> {
    this.providers.clear();
    await this.initializeProviders();
  }
}

// Singleton instance
let providerManager: ProviderManager | null = null;

export function getProviderManager(): ProviderManager {
  if (!providerManager) {
    providerManager = new ProviderManager();
  }
  return providerManager;
}

