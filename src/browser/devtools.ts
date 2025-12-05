/**
 * Chrome DevTools Protocol Integration
 * 
 * Direct access to Chrome DevTools from within VS Code.
 * - Console logs
 * - Network requests
 * - DOM inspection
 * - JavaScript execution
 * - Performance profiling
 */

import * as vscode from "vscode";
import * as http from "http";
import WebSocket from "ws";

interface CDPTarget {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl: string;
}

export interface ConsoleMessage {
  timestamp: number;
  type: "log" | "warn" | "error" | "info" | "debug";
  text: string;
  source: string;
  lineNumber?: number;
  url?: string;
}

export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  timestamp: number;
  status?: number;
  statusText?: string;
  responseSize?: number;
  duration?: number;
  mimeType?: string;
  headers?: Record<string, string>;
}

interface DOMNode {
  nodeId: number;
  nodeName: string;
  nodeType: number;
  nodeValue?: string;
  attributes?: string[];
  children?: DOMNode[];
}

export class ChromeDevTools {
  private ws: WebSocket | null = null;
  private messageId: number = 1;
  private pendingMessages: Map<number, { resolve: Function; reject: Function }> = new Map();
  private consoleLogs: ConsoleMessage[] = [];
  private networkRequests: Map<string, NetworkRequest> = new Map();
  private outputChannel: vscode.OutputChannel;
  private connected: boolean = false;

  // Event handlers
  private onConsoleMessage?: (msg: ConsoleMessage) => void;
  private onNetworkRequest?: (req: NetworkRequest) => void;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Chrome DevTools");
  }

  /**
   * Find available Chrome debugging targets
   */
  async findTargets(port: number = 9222): Promise<CDPTarget[]> {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/json`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Failed to parse targets"));
          }
        });
      }).on("error", (err) => {
        reject(new Error(`Chrome not found on port ${port}. Start Chrome with: --remote-debugging-port=${port}`));
      });
    });
  }

  /**
   * Connect to a Chrome target
   */
  async connect(target: CDPTarget): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      this.ws = ws;

      ws.on("open", async () => {
        this.connected = true;
        this.outputChannel.appendLine(`Connected to: ${target.title}`);

        // Enable domains
        await this.send("Console.enable");
        await this.send("Network.enable");
        await this.send("DOM.enable");
        await this.send("Runtime.enable");
        await this.send("Page.enable");

        resolve();
      });

      ws.on("message", (data) => {
        this.handleMessage(JSON.parse(data.toString()));
      });

      ws.on("error", (err) => {
        reject(err);
      });

      ws.on("close", () => {
        this.connected = false;
        this.outputChannel.appendLine("Disconnected from Chrome");
      });
    });
  }

  /**
   * Send CDP command
   */
  private async send(method: string, params?: any): Promise<any> {
    if (!this.ws || !this.connected) {
      throw new Error("Not connected to Chrome");
    }

    const id = this.messageId++;
    
    return new Promise((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ id, method, params }));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * Handle incoming CDP messages
   */
  private handleMessage(msg: any): void {
    // Response to a command
    if (msg.id && this.pendingMessages.has(msg.id)) {
      const { resolve, reject } = this.pendingMessages.get(msg.id)!;
      this.pendingMessages.delete(msg.id);

      if (msg.error) {
        reject(new Error(msg.error.message));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // Event
    if (msg.method) {
      this.handleEvent(msg.method, msg.params);
    }
  }

  /**
   * Handle CDP events
   */
  private handleEvent(method: string, params: any): void {
    switch (method) {
      case "Console.messageAdded":
        this.handleConsoleMessage(params.message);
        break;
      case "Runtime.consoleAPICalled":
        this.handleRuntimeConsole(params);
        break;
      case "Network.requestWillBeSent":
        this.handleNetworkRequest(params);
        break;
      case "Network.responseReceived":
        this.handleNetworkResponse(params);
        break;
      case "Network.loadingFinished":
        this.handleNetworkFinished(params);
        break;
    }
  }

  /**
   * Handle console messages
   */
  private handleConsoleMessage(msg: any): void {
    const consoleMsg: ConsoleMessage = {
      timestamp: Date.now(),
      type: msg.level || "log",
      text: msg.text,
      source: msg.source,
      lineNumber: msg.line,
      url: msg.url,
    };

    this.consoleLogs.push(consoleMsg);
    this.outputChannel.appendLine(`[${consoleMsg.type.toUpperCase()}] ${consoleMsg.text}`);
    this.onConsoleMessage?.(consoleMsg);
  }

  /**
   * Handle Runtime.consoleAPICalled
   */
  private handleRuntimeConsole(params: any): void {
    const text = params.args?.map((arg: any) => arg.value || arg.description || "").join(" ") || "";
    
    const consoleMsg: ConsoleMessage = {
      timestamp: params.timestamp || Date.now(),
      type: params.type || "log",
      text,
      source: "runtime",
    };

    this.consoleLogs.push(consoleMsg);
    this.outputChannel.appendLine(`[${consoleMsg.type.toUpperCase()}] ${text}`);
    this.onConsoleMessage?.(consoleMsg);
  }

  /**
   * Handle network request
   */
  private handleNetworkRequest(params: any): void {
    const req: NetworkRequest = {
      requestId: params.requestId,
      url: params.request.url,
      method: params.request.method,
      timestamp: params.timestamp,
      headers: params.request.headers,
    };

    this.networkRequests.set(params.requestId, req);
  }

  /**
   * Handle network response
   */
  private handleNetworkResponse(params: any): void {
    const req = this.networkRequests.get(params.requestId);
    if (req) {
      req.status = params.response.status;
      req.statusText = params.response.statusText;
      req.mimeType = params.response.mimeType;
      this.onNetworkRequest?.(req);
    }
  }

  /**
   * Handle network finished
   */
  private handleNetworkFinished(params: any): void {
    const req = this.networkRequests.get(params.requestId);
    if (req) {
      req.responseSize = params.encodedDataLength;
      req.duration = (params.timestamp - req.timestamp) * 1000;
      
      this.outputChannel.appendLine(
        `[NET] ${req.method} ${req.status} ${req.url} (${req.duration?.toFixed(0)}ms)`
      );
    }
  }

  // ============ PUBLIC API ============

  /**
   * Execute JavaScript in the browser
   */
  async evaluate(expression: string): Promise<any> {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text);
    }

    return result.result.value;
  }

  /**
   * Get console logs
   */
  getConsoleLogs(filter?: { type?: string; limit?: number }): ConsoleMessage[] {
    let logs = [...this.consoleLogs];

    if (filter?.type) {
      logs = logs.filter((l) => l.type === filter.type);
    }

    if (filter?.limit) {
      logs = logs.slice(-filter.limit);
    }

    return logs;
  }

  /**
   * Clear console logs
   */
  clearConsole(): void {
    this.consoleLogs = [];
    this.send("Console.clearMessages").catch(() => {});
  }

  /**
   * Get network requests
   */
  getNetworkRequests(filter?: { 
    url?: string; 
    method?: string; 
    status?: number;
    limit?: number;
  }): NetworkRequest[] {
    let requests = Array.from(this.networkRequests.values());

    if (filter?.url) {
      requests = requests.filter((r) => r.url.includes(filter.url!));
    }
    if (filter?.method) {
      requests = requests.filter((r) => r.method === filter.method);
    }
    if (filter?.status) {
      requests = requests.filter((r) => r.status === filter.status);
    }
    if (filter?.limit) {
      requests = requests.slice(-filter.limit);
    }

    return requests;
  }

  /**
   * Clear network log
   */
  clearNetwork(): void {
    this.networkRequests.clear();
  }

  /**
   * Get DOM document
   */
  async getDocument(): Promise<DOMNode> {
    const result = await this.send("DOM.getDocument", { depth: -1 });
    return result.root;
  }

  /**
   * Query selector
   */
  async querySelector(selector: string): Promise<DOMNode | null> {
    try {
      const doc = await this.send("DOM.getDocument");
      const result = await this.send("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector,
      });
      
      if (result.nodeId === 0) return null;

      const node = await this.send("DOM.describeNode", { nodeId: result.nodeId });
      return node.node;
    } catch {
      return null;
    }
  }

  /**
   * Get element HTML
   */
  async getOuterHTML(selector: string): Promise<string | null> {
    try {
      const doc = await this.send("DOM.getDocument");
      const result = await this.send("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector,
      });
      
      if (result.nodeId === 0) return null;

      const html = await this.send("DOM.getOuterHTML", { nodeId: result.nodeId });
      return html.outerHTML;
    } catch {
      return null;
    }
  }

  /**
   * Take screenshot
   */
  async screenshot(options?: { 
    format?: "jpeg" | "png"; 
    quality?: number;
    fullPage?: boolean;
  }): Promise<string> {
    const format = options?.format || "png";
    
    if (options?.fullPage) {
      // Get full page dimensions
      const metrics = await this.send("Page.getLayoutMetrics");
      await this.send("Emulation.setDeviceMetricsOverride", {
        width: Math.ceil(metrics.contentSize.width),
        height: Math.ceil(metrics.contentSize.height),
        deviceScaleFactor: 1,
        mobile: false,
      });
    }

    const result = await this.send("Page.captureScreenshot", {
      format,
      quality: options?.quality,
    });

    if (options?.fullPage) {
      await this.send("Emulation.clearDeviceMetricsOverride");
    }

    return result.data; // Base64 encoded image
  }

  /**
   * Navigate to URL
   */
  async navigate(url: string): Promise<void> {
    await this.send("Page.navigate", { url });
  }

  /**
   * Reload page
   */
  async reload(ignoreCache?: boolean): Promise<void> {
    await this.send("Page.reload", { ignoreCache });
  }

  /**
   * Get page info
   */
  async getPageInfo(): Promise<{ url: string; title: string }> {
    const result = await this.evaluate("({ url: location.href, title: document.title })");
    return result;
  }

  /**
   * Set event handlers
   */
  on(event: "console", handler: (msg: ConsoleMessage) => void): void;
  on(event: "network", handler: (req: NetworkRequest) => void): void;
  on(event: string, handler: Function): void {
    if (event === "console") {
      this.onConsoleMessage = handler as any;
    } else if (event === "network") {
      this.onNetworkRequest = handler as any;
    }
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Show output channel
   */
  showOutput(): void {
    this.outputChannel.show();
  }
}

// Singleton
let instance: ChromeDevTools | null = null;

export function getChromeDevTools(): ChromeDevTools {
  if (!instance) {
    instance = new ChromeDevTools();
  }
  return instance;
}

/**
 * Quick connect helper
 */
export async function connectToChrome(port: number = 9222): Promise<ChromeDevTools> {
  const devtools = getChromeDevTools();
  const targets = await devtools.findTargets(port);
  
  // Find a page target
  const pageTarget = targets.find((t) => t.type === "page");
  if (!pageTarget) {
    throw new Error("No page targets found. Open a tab in Chrome.");
  }

  await devtools.connect(pageTarget);
  return devtools;
}

