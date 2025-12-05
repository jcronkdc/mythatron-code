/**
 * Conversation History - Save and export chat sessions
 * Persistent across restarts
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { Message, TokenUsage } from "../providers/types";

export interface ConversationMetadata {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  tokenCount: number;
  estimatedCost: number;
}

export interface Conversation {
  metadata: ConversationMetadata;
  messages: Message[];
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    result: string;
    timestamp: Date;
  }>;
}

export class ConversationHistory {
  private historyPath: string;
  private conversations: Map<string, Conversation> = new Map();
  private currentConversationId: string | null = null;

  constructor(workspaceRoot: string) {
    this.historyPath = path.join(workspaceRoot, ".claudecode", "history");
    this.loadIndex();
  }

  private getConversationPath(id: string): string {
    return path.join(this.historyPath, `${id}.json`);
  }

  private loadIndex(): void {
    try {
      if (!fs.existsSync(this.historyPath)) {
        fs.mkdirSync(this.historyPath, { recursive: true });
        return;
      }

      const files = fs.readdirSync(this.historyPath);
      for (const file of files) {
        if (file.endsWith(".json")) {
          try {
            const data = JSON.parse(
              fs.readFileSync(path.join(this.historyPath, file), "utf-8")
            );
            this.conversations.set(data.metadata.id, data);
          } catch {
            // Skip invalid files
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  private saveConversation(conversation: Conversation): void {
    const filePath = this.getConversationPath(conversation.metadata.id);
    fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2));
  }

  /**
   * Create a new conversation
   */
  createConversation(title?: string): string {
    const id = `conv-${Date.now()}`;
    const conversation: Conversation = {
      metadata: {
        id,
        title: title || `Chat ${new Date().toLocaleDateString()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        messageCount: 0,
        tokenCount: 0,
        estimatedCost: 0,
      },
      messages: [],
      toolCalls: [],
    };

    this.conversations.set(id, conversation);
    this.currentConversationId = id;
    this.saveConversation(conversation);

    return id;
  }

  /**
   * Get current conversation
   */
  getCurrentConversation(): Conversation | null {
    if (!this.currentConversationId) return null;
    return this.conversations.get(this.currentConversationId) || null;
  }

  /**
   * Set current conversation
   */
  setCurrentConversation(id: string): boolean {
    if (!this.conversations.has(id)) return false;
    this.currentConversationId = id;
    return true;
  }

  /**
   * Add message to current conversation
   */
  addMessage(message: Message, usage?: TokenUsage): void {
    const conv = this.getCurrentConversation();
    if (!conv) {
      this.createConversation();
      return this.addMessage(message, usage);
    }

    conv.messages.push(message);
    conv.metadata.messageCount++;
    conv.metadata.updatedAt = new Date();

    if (usage) {
      conv.metadata.tokenCount += usage.inputTokens + usage.outputTokens;
      // Estimate cost (Claude Sonnet pricing)
      conv.metadata.estimatedCost +=
        (usage.inputTokens / 1_000_000) * 3 +
        (usage.outputTokens / 1_000_000) * 15;
    }

    this.saveConversation(conv);
  }

  /**
   * Add tool call to current conversation
   */
  addToolCall(
    name: string,
    input: Record<string, unknown>,
    result: string
  ): void {
    const conv = this.getCurrentConversation();
    if (!conv) return;

    conv.toolCalls.push({
      name,
      input,
      result: result.slice(0, 1000), // Limit stored result size
      timestamp: new Date(),
    });

    this.saveConversation(conv);
  }

  /**
   * List all conversations
   */
  listConversations(): ConversationMetadata[] {
    return Array.from(this.conversations.values())
      .map((c) => c.metadata)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  /**
   * Get a conversation by ID
   */
  getConversation(id: string): Conversation | null {
    return this.conversations.get(id) || null;
  }

  /**
   * Delete a conversation
   */
  deleteConversation(id: string): boolean {
    if (!this.conversations.has(id)) return false;

    this.conversations.delete(id);
    
    try {
      fs.unlinkSync(this.getConversationPath(id));
    } catch {
      // Ignore
    }

    if (this.currentConversationId === id) {
      this.currentConversationId = null;
    }

    return true;
  }

  /**
   * Export conversation to markdown
   */
  exportToMarkdown(id: string): string {
    const conv = this.conversations.get(id);
    if (!conv) return "";

    const lines: string[] = [
      `# ${conv.metadata.title}`,
      "",
      `*Created: ${conv.metadata.createdAt}*`,
      `*Messages: ${conv.metadata.messageCount}*`,
      `*Tokens: ${conv.metadata.tokenCount.toLocaleString()}*`,
      `*Estimated Cost: $${conv.metadata.estimatedCost.toFixed(4)}*`,
      "",
      "---",
      "",
    ];

    for (const message of conv.messages) {
      const role = message.role === "user" ? "**You:**" : "**Claude:**";
      lines.push(role);
      lines.push("");
      lines.push(message.content);
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Export conversation to JSON
   */
  exportToJSON(id: string): string {
    const conv = this.conversations.get(id);
    if (!conv) return "{}";
    return JSON.stringify(conv, null, 2);
  }

  /**
   * Search conversations
   */
  search(query: string): ConversationMetadata[] {
    const queryLower = query.toLowerCase();
    
    return Array.from(this.conversations.values())
      .filter((conv) => {
        // Search in title
        if (conv.metadata.title.toLowerCase().includes(queryLower)) {
          return true;
        }
        
        // Search in messages
        for (const msg of conv.messages) {
          if (msg.content.toLowerCase().includes(queryLower)) {
            return true;
          }
        }
        
        return false;
      })
      .map((c) => c.metadata)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  /**
   * Get total usage stats
   */
  getTotalStats(): {
    conversations: number;
    messages: number;
    tokens: number;
    cost: number;
  } {
    let messages = 0;
    let tokens = 0;
    let cost = 0;

    for (const conv of this.conversations.values()) {
      messages += conv.metadata.messageCount;
      tokens += conv.metadata.tokenCount;
      cost += conv.metadata.estimatedCost;
    }

    return {
      conversations: this.conversations.size,
      messages,
      tokens,
      cost,
    };
  }
}

// Singleton
let conversationHistory: ConversationHistory | null = null;

export function getConversationHistory(): ConversationHistory {
  if (!conversationHistory) {
    const workspaceRoot =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    conversationHistory = new ConversationHistory(workspaceRoot);
  }
  return conversationHistory;
}

