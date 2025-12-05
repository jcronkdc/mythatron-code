/**
 * MCP exports
 */

export * from "./types";
export * from "./client";
export * from "./manager";

import { getMCPManager } from "./manager";

export async function initMCPManager(workspaceRoot: string): Promise<void> {
  const mcp = getMCPManager();
  await mcp.initialize();
}

