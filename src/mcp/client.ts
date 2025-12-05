/**
 * MCP Client - Connects to MCP tool servers
 * Supports stdio, SSE, and WebSocket transports
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import type {
  MCPServerConfig,
  MCPMessage,
  MCPTool,
  MCPResource,
  MCPCapabilities,
  MCPToolResult,
} from "./types";

export class MCPClient extends EventEmitter {
  private config: MCPServerConfig;
  private process: ChildProcess | null = null;
  private messageId = 0;
  private pendingRequests: Map<
    number | string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  > = new Map();
  private capabilities: MCPCapabilities | null = null;
  private buffer = "";
  private connected = false;

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
  }

  get name(): string {
    return this.config.name;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    switch (this.config.transport) {
      case "stdio":
        await this.connectStdio();
        break;
      case "sse":
        await this.connectSSE();
        break;
      case "websocket":
        await this.connectWebSocket();
        break;
      default:
        throw new Error(`Unknown transport: ${this.config.transport}`);
    }

    // Initialize the connection
    await this.initialize();
  }

  private async connectStdio(): Promise<void> {
    if (!this.config.command) {
      throw new Error("Command required for stdio transport");
    }

    this.process = spawn(this.config.command, this.config.args || [], {
      env: { ...process.env, ...this.config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.handleData(data.toString());
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      console.error(`[MCP ${this.config.name}] stderr:`, data.toString());
    });

    this.process.on("error", (error) => {
      this.emit("error", error);
      this.connected = false;
    });

    this.process.on("close", (code) => {
      this.connected = false;
      this.emit("close", code);
    });

    this.connected = true;
  }

  private async connectSSE(): Promise<void> {
    if (!this.config.url) {
      throw new Error("URL required for SSE transport");
    }

    // SSE implementation
    const response = await fetch(this.config.url, {
      headers: { Accept: "text/event-stream" },
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to connect to SSE: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const readStream = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.handleData(decoder.decode(value));
      }
      this.connected = false;
      this.emit("close", 0);
    };

    readStream().catch((error) => {
      this.emit("error", error);
      this.connected = false;
    });

    this.connected = true;
  }

  private async connectWebSocket(): Promise<void> {
    if (!this.config.url) {
      throw new Error("URL required for WebSocket transport");
    }

    // Note: In VS Code extension, we'd use a WebSocket polyfill
    // For now, this is a placeholder
    throw new Error("WebSocket transport not yet implemented in VS Code extension");
  }

  private handleData(data: string): void {
    this.buffer += data;

    // Process complete JSON-RPC messages (newline-delimited)
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message: MCPMessage = JSON.parse(line);
        this.handleMessage(message);
      } catch (error) {
        console.error(`[MCP ${this.config.name}] Invalid JSON:`, line);
      }
    }
  }

  private handleMessage(message: MCPMessage): void {
    // Handle responses to our requests
    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
        return;
      }
    }

    // Handle notifications from server
    if (message.method) {
      this.emit("notification", message.method, message.params);
    }
  }

  private async sendRequest(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.messageId;
    const message: MCPMessage = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const json = JSON.stringify(message) + "\n";

      if (this.config.transport === "stdio" && this.process?.stdin) {
        this.process.stdin.write(json);
      } else {
        reject(new Error("Not connected"));
      }

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Request timed out"));
        }
      }, 30000);
    });
  }

  private async initialize(): Promise<void> {
    const result = (await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {
        roots: { listChanged: true },
        sampling: {},
      },
      clientInfo: {
        name: "mythatron-code",
        version: "1.0.0",
      },
    })) as { capabilities: MCPCapabilities };

    this.capabilities = result.capabilities;

    // Send initialized notification
    await this.sendRequest("notifications/initialized", {});
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    const result = (await this.sendRequest("tools/list", {})) as {
      tools: MCPTool[];
    };
    return result.tools || [];
  }

  async listResources(): Promise<MCPResource[]> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    const result = (await this.sendRequest("resources/list", {})) as {
      resources: MCPResource[];
    };
    return result.resources || [];
  }

  async callTool(
    name: string,
    arguments_: Record<string, unknown>
  ): Promise<MCPToolResult> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    const result = (await this.sendRequest("tools/call", {
      name,
      arguments: arguments_,
    })) as MCPToolResult;

    return result;
  }

  async readResource(uri: string): Promise<{ contents: Array<{ uri: string; text?: string; blob?: string }> }> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    const result = (await this.sendRequest("resources/read", { uri })) as {
      contents: Array<{ uri: string; text?: string; blob?: string }>;
    };

    return result;
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
    this.pendingRequests.clear();
  }
}

