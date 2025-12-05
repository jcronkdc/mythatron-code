/**
 * MCP Manager - Manages multiple MCP servers per project
 * Loads configuration from .mythatron/mcp.json
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { MCPClient } from "./client";
import type {
  MCPServerConfig,
  MCPProjectConfig,
  MCPTool,
  MCPToolResult,
  MCP_PRESETS,
} from "./types";

export class MCPManager {
  private clients: Map<string, MCPClient> = new Map();
  private workspaceRoot: string;
  private configPath: string;
  private config: MCPProjectConfig | null = null;
  private toolsCache: Map<string, MCPTool[]> = new Map();

  constructor(workspaceRoot?: string) {
    this.workspaceRoot =
      workspaceRoot ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      process.cwd();
    this.configPath = path.join(this.workspaceRoot, ".mythatron", "mcp.json");
  }

  /**
   * Load MCP configuration from project
   */
  async loadConfig(): Promise<MCPProjectConfig | null> {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, "utf-8");
        this.config = JSON.parse(content) as MCPProjectConfig;
        return this.config;
      }
    } catch (error) {
      console.error("Failed to load MCP config:", error);
    }
    return null;
  }

  /**
   * Save MCP configuration to project
   */
  async saveConfig(config: MCPProjectConfig): Promise<void> {
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    this.config = config;
  }

  /**
   * Initialize and connect to all configured servers
   */
  async initialize(): Promise<void> {
    await this.loadConfig();

    if (!this.config) {
      return;
    }

    for (const serverConfig of this.config.servers) {
      if (serverConfig.enabled === false) continue;

      try {
        await this.connectServer(serverConfig);
      } catch (error) {
        console.error(`Failed to connect to MCP server ${serverConfig.name}:`, error);
      }
    }
  }

  /**
   * Connect to a specific MCP server
   */
  async connectServer(config: MCPServerConfig): Promise<MCPClient> {
    // Disconnect existing client if any
    if (this.clients.has(config.name)) {
      await this.disconnectServer(config.name);
    }

    const client = new MCPClient(config);

    client.on("error", (error) => {
      console.error(`[MCP ${config.name}] Error:`, error);
      vscode.window.showErrorMessage(`MCP server ${config.name} error: ${error.message}`);
    });

    client.on("close", (code) => {
      console.log(`[MCP ${config.name}] Closed with code ${code}`);
      this.clients.delete(config.name);
      this.toolsCache.delete(config.name);
    });

    await client.connect();
    this.clients.set(config.name, client);

    // Cache tools
    try {
      const tools = await client.listTools();
      this.toolsCache.set(config.name, tools);
    } catch {
      // Some servers don't support tools
    }

    return client;
  }

  /**
   * Disconnect from a specific server
   */
  async disconnectServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      await client.disconnect();
      this.clients.delete(name);
      this.toolsCache.delete(name);
    }
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    for (const [name] of this.clients) {
      await this.disconnectServer(name);
    }
  }

  /**
   * Get all available tools from all connected servers
   */
  getAllTools(): Array<{ server: string; tool: MCPTool }> {
    const tools: Array<{ server: string; tool: MCPTool }> = [];

    for (const [serverName, serverTools] of this.toolsCache) {
      for (const tool of serverTools) {
        tools.push({
          server: serverName,
          tool: {
            ...tool,
            name: `mcp_${serverName}_${tool.name}`, // Namespaced tool name
          },
        });
      }
    }

    return tools;
  }

  /**
   * Call a tool on a specific server
   */
  async callTool(
    serverName: string,
    toolName: string,
    arguments_: Record<string, unknown>
  ): Promise<MCPToolResult> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server ${serverName} not connected`);
    }

    return client.callTool(toolName, arguments_);
  }

  /**
   * Parse a namespaced tool name (mcp_server_tool) and call it
   */
  async callNamespacedTool(
    fullName: string,
    arguments_: Record<string, unknown>
  ): Promise<MCPToolResult> {
    // Parse: mcp_servername_toolname
    const match = fullName.match(/^mcp_([^_]+)_(.+)$/);
    if (!match) {
      throw new Error(`Invalid MCP tool name: ${fullName}`);
    }

    const [, serverName, toolName] = match;
    return this.callTool(serverName, toolName, arguments_);
  }

  /**
   * Check if a tool name is an MCP tool
   */
  isMCPTool(name: string): boolean {
    return name.startsWith("mcp_");
  }

  /**
   * Get connected server names
   */
  getConnectedServers(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Get server status
   */
  getServerStatus(name: string): "connected" | "disconnected" | "unknown" {
    const client = this.clients.get(name);
    if (!client) return "disconnected";
    return client.isConnected ? "connected" : "disconnected";
  }

  /**
   * Add a preset server to config
   */
  async addPreset(presetName: string, customName?: string): Promise<void> {
    const { MCP_PRESETS } = require("./types");
    const preset = MCP_PRESETS[presetName];
    if (!preset) {
      throw new Error(`Unknown preset: ${presetName}`);
    }

    const serverConfig: MCPServerConfig = {
      name: customName || presetName,
      ...preset,
      enabled: true,
    };

    if (!this.config) {
      this.config = { servers: [] };
    }

    // Remove existing server with same name
    this.config.servers = this.config.servers.filter(
      (s) => s.name !== serverConfig.name
    );
    this.config.servers.push(serverConfig);

    await this.saveConfig(this.config);
    await this.connectServer(serverConfig);
  }

  /**
   * Remove a server from config
   */
  async removeServer(name: string): Promise<void> {
    await this.disconnectServer(name);

    if (this.config) {
      this.config.servers = this.config.servers.filter((s) => s.name !== name);
      await this.saveConfig(this.config);
    }
  }

  /**
   * Create default config with common presets
   */
  async createDefaultConfig(): Promise<void> {
    const { MCP_PRESETS } = require("./types");
    
    const defaultConfig: MCPProjectConfig = {
      servers: [
        {
          name: "filesystem",
          ...MCP_PRESETS.filesystem,
          enabled: true,
        },
        {
          name: "git",
          ...MCP_PRESETS.git,
          enabled: true,
        },
      ],
      settings: {
        timeout: 30000,
        retryAttempts: 3,
      },
    };

    await this.saveConfig(defaultConfig);
  }
}

// Singleton instance
let mcpManager: MCPManager | null = null;

export function getMCPManager(): MCPManager {
  if (!mcpManager) {
    mcpManager = new MCPManager();
  }
  return mcpManager;
}

