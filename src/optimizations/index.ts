/**
 * MythaTron Code Optimizations
 * 
 * A comprehensive suite of cost-saving optimizations that address
 * all the ways Cursor inflates usage and costs.
 */

// Import all modules
import { ResponseCache, getResponseCache } from "./response-cache";
import { ContextManager, getContextManager } from "./context-manager";
import { RequestDeduplicator, getRequestDeduplicator } from "./request-dedup";
import { SmartDebouncer, getSmartDebouncer } from "./debouncer";
import { CostTracker, getCostTracker } from "./cost-tracker";
import { OfflineMode, getOfflineMode } from "./offline-mode";
import { AutoApply, getAutoApply } from "./auto-apply";
import { LSPCache, getLSPCache } from "./lsp-cache";
import { TokenOptimizer, getTokenOptimizer } from "./token-optimizer";
import { PromptCache, promptCache } from "./prompt-cache";
import { BudgetControl, budgetControl } from "./budget-control";
import { PrivacyMode, privacyMode } from "./privacy-mode";
import { RequestBatcher, createCompletionBatcher, createEmbeddingBatcher } from "./request-batcher";

// Re-export all modules
export {
  ResponseCache,
  getResponseCache,
  ContextManager,
  getContextManager,
  RequestDeduplicator,
  getRequestDeduplicator,
  SmartDebouncer,
  getSmartDebouncer,
  CostTracker,
  getCostTracker,
  OfflineMode,
  getOfflineMode,
  AutoApply,
  getAutoApply,
  LSPCache,
  getLSPCache,
  TokenOptimizer,
  getTokenOptimizer,
  // New additions
  PromptCache,
  promptCache,
  BudgetControl,
  budgetControl,
  PrivacyMode,
  privacyMode,
  RequestBatcher,
  createCompletionBatcher,
  createEmbeddingBatcher,
};

/**
 * Initialize all optimization systems
 */
export function initializeOptimizations(): {
  responseCache: ResponseCache;
  contextManager: ContextManager;
  requestDedup: RequestDeduplicator;
  debouncer: SmartDebouncer;
  costTracker: CostTracker;
  offlineMode: OfflineMode;
  autoApply: AutoApply;
  lspCache: LSPCache;
  tokenOptimizer: TokenOptimizer;
} {
  return {
    responseCache: getResponseCache(),
    contextManager: getContextManager(),
    requestDedup: getRequestDeduplicator(),
    debouncer: getSmartDebouncer(),
    costTracker: getCostTracker(),
    offlineMode: getOfflineMode(),
    autoApply: getAutoApply(),
    lspCache: getLSPCache(),
    tokenOptimizer: getTokenOptimizer(),
  };
}

/**
 * Get aggregated statistics from all optimization systems
 */
export function getAggregatedStats(): {
  cache: ReturnType<ResponseCache["getStats"]>;
  context: ReturnType<ContextManager["getStats"]>;
  dedup: ReturnType<RequestDeduplicator["getStats"]>;
  cost: ReturnType<CostTracker["getSessionStats"]>;
  offline: ReturnType<OfflineMode["getStats"]>;
  lsp: ReturnType<LSPCache["getStats"]>;
  tokens: ReturnType<TokenOptimizer["getStats"]>;
} {
  return {
    cache: getResponseCache().getStats(),
    context: getContextManager().getStats(),
    dedup: getRequestDeduplicator().getStats(),
    cost: getCostTracker().getSessionStats(),
    offline: getOfflineMode().getStats(),
    lsp: getLSPCache().getStats(),
    tokens: getTokenOptimizer().getStats(),
  };
}

/**
 * Calculate total estimated savings
 */
export function getTotalSavings(): {
  tokensSaved: number;
  costSaved: number;
  requestsSaved: number;
  cacheHitRate: number;
} {
  const cacheStats = getResponseCache().getStats();
  const dedupStats = getRequestDeduplicator().getStats();
  const costStats = getCostTracker().getSessionStats();
  const tokenStats = getTokenOptimizer().getStats();

  return {
    tokensSaved: cacheStats.tokensSaved + tokenStats.total.saved,
    costSaved: cacheStats.totalSaved + costStats.estimatedSavings + dedupStats.estimatedSavings,
    requestsSaved: cacheStats.cacheHits + dedupStats.savedRequests,
    cacheHitRate: cacheStats.hitRate,
  };
}
