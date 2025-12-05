/**
 * Terminal exports
 */

export * from "./manager";

import { getTerminalManager } from "./manager";

export async function initTerminalManager(): Promise<void> {
  getTerminalManager();
}

