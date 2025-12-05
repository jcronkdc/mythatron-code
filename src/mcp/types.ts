/**
 * MCP (Model Context Protocol) Types
 * Allows per-project custom tool servers
 */

export interface MCPServerConfig {
  /** Unique identifier for this server */
  name: string;
  
  /** Transport type */
  transport: "stdio" | "sse" | "websocket";
  
  /** Command to start the server (for stdio) */
  command?: string;
  
  /** Arguments for the command */
  args?: string[];
  
  /** Environment variables */
  env?: Record<string, string>;
  
  /** URL for SSE/WebSocket transports */
  url?: string;
  
  /** Whether this server is enabled */
  enabled?: boolean;
  
  /** Description of what this server provides */
  description?: string;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface MCPCapabilities {
  tools?: MCPTool[];
  resources?: MCPResource[];
  prompts?: MCPPrompt[];
}

export interface MCPMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Project-level MCP configuration
export interface MCPProjectConfig {
  servers: MCPServerConfig[];
  // Global settings
  settings?: {
    timeout?: number;
    retryAttempts?: number;
  };
}

// Common MCP server presets
export const MCP_PRESETS: Record<string, Omit<MCPServerConfig, "name">> = {
  // Browser automation
  "browser": {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@anthropic-ai/mcp-server-puppeteer"],
    description: "Browser automation with Puppeteer",
  },
  
  // Filesystem access
  "filesystem": {
    transport: "stdio", 
    command: "npx",
    args: ["-y", "@anthropic-ai/mcp-server-filesystem", "/"],
    description: "Enhanced filesystem operations",
  },
  
  // Git operations
  "git": {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@anthropic-ai/mcp-server-git"],
    description: "Advanced Git operations",
  },
  
  // GitHub API
  "github": {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@anthropic-ai/mcp-server-github"],
    description: "GitHub API integration",
  },
  
  // PostgreSQL
  "postgres": {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@anthropic-ai/mcp-server-postgres"],
    description: "PostgreSQL database operations",
  },
  
  // Slack
  "slack": {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@anthropic-ai/mcp-server-slack"],
    description: "Slack messaging integration",
  },
  
  // Memory/Knowledge base
  "memory": {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@anthropic-ai/mcp-server-memory"],
    description: "Persistent memory storage",
  },
  
  // Brave Search
  "brave-search": {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@anthropic-ai/mcp-server-brave-search"],
    description: "Web search via Brave",
  },
  
  // Fetch/HTTP
  "fetch": {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@anthropic-ai/mcp-server-fetch"],
    description: "HTTP requests and web scraping",
  },
};

