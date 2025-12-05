/**
 * Memory exports
 */

export * from "./types";
export * from "./manager";

import { getMemoryManager } from "./manager";

export async function initMemoryManager(workspaceRoot: string): Promise<void> {
  const mm = getMemoryManager();
  // Memory manager initializes in constructor
}

