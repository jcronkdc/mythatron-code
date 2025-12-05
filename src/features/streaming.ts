/**
 * Streaming Support - Token-by-token output
 * Real-time response rendering
 */

import * as vscode from "vscode";

export interface StreamToken {
  type: "text" | "thinking" | "tool_start" | "tool_end" | "done";
  content?: string;
  toolName?: string;
  toolId?: string;
}

export type StreamCallback = (token: StreamToken) => void;

/**
 * Stream handler that accumulates and processes tokens
 */
export class StreamHandler {
  private buffer = "";
  private thinkingBuffer = "";
  private inThinking = false;
  private callback: StreamCallback;

  constructor(callback: StreamCallback) {
    this.callback = callback;
  }

  /**
   * Process incoming text chunk
   */
  processChunk(text: string): void {
    this.buffer += text;

    // Check for thinking block start
    if (this.buffer.includes("<thinking>") && !this.inThinking) {
      const idx = this.buffer.indexOf("<thinking>");
      const before = this.buffer.slice(0, idx);
      
      if (before) {
        this.callback({ type: "text", content: before });
      }
      
      this.inThinking = true;
      this.buffer = this.buffer.slice(idx + "<thinking>".length);
    }

    // Check for thinking block end
    if (this.inThinking && this.buffer.includes("</thinking>")) {
      const idx = this.buffer.indexOf("</thinking>");
      this.thinkingBuffer += this.buffer.slice(0, idx);
      
      this.callback({ type: "thinking", content: this.thinkingBuffer });
      
      this.inThinking = false;
      this.thinkingBuffer = "";
      this.buffer = this.buffer.slice(idx + "</thinking>".length);
    }

    // Accumulate thinking
    if (this.inThinking) {
      this.thinkingBuffer += this.buffer;
      this.buffer = "";
      return;
    }

    // Emit text tokens
    if (this.buffer.length > 0) {
      this.callback({ type: "text", content: this.buffer });
      this.buffer = "";
    }
  }

  /**
   * Signal tool execution started
   */
  toolStart(toolName: string, toolId: string): void {
    this.callback({ type: "tool_start", toolName, toolId });
  }

  /**
   * Signal tool execution ended
   */
  toolEnd(toolId: string): void {
    this.callback({ type: "tool_end", toolId });
  }

  /**
   * Signal stream complete
   */
  done(): void {
    // Flush any remaining buffer
    if (this.buffer) {
      this.callback({ type: "text", content: this.buffer });
    }
    if (this.thinkingBuffer) {
      this.callback({ type: "thinking", content: this.thinkingBuffer });
    }
    this.callback({ type: "done" });
  }
}

/**
 * Create a webview-compatible stream renderer
 */
export function createStreamRenderer(webview: vscode.Webview): StreamCallback {
  return (token: StreamToken) => {
    webview.postMessage({
      type: "stream",
      data: token,
    });
  };
}

/**
 * Create an output channel stream renderer
 */
export function createOutputRenderer(channel: vscode.OutputChannel): StreamCallback {
  return (token: StreamToken) => {
    switch (token.type) {
      case "text":
        channel.append(token.content || "");
        break;
      case "thinking":
        channel.appendLine(`\n💭 Thinking:\n${token.content}\n`);
        break;
      case "tool_start":
        channel.appendLine(`\n🔧 ${token.toolName}...`);
        break;
      case "tool_end":
        channel.appendLine(`✓ Done`);
        break;
      case "done":
        channel.appendLine("\n---");
        break;
    }
  };
}

