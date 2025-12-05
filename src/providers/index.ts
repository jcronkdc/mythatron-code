/**
 * Provider exports
 */

export * from "./types";
export * from "./anthropic-provider";
export * from "./openai-provider";
export * from "./groq-provider";
export * from "./ollama-provider";
export * from "./task-classifier";
export * from "./provider-manager";

import { getProviderManager } from "./provider-manager";

export async function initializeProviders(): Promise<void> {
  const pm = getProviderManager();
  await pm.reinitialize();
}

