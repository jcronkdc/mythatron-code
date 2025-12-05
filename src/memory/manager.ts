/**
 * Memory Manager - Persistent knowledge storage
 * Stores memories and project rules in .claudecode folder
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { Memory, ProjectRules, MemoryStore } from "./types";

export class MemoryManager {
  private workspaceRoot: string;
  private configDir: string;
  private memoriesPath: string;
  private rulesPath: string;
  private store: MemoryStore;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot =
      workspaceRoot ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      process.cwd();
    
    this.configDir = path.join(this.workspaceRoot, ".claudecode");
    this.memoriesPath = path.join(this.configDir, "memories.json");
    this.rulesPath = path.join(this.configDir, "rules.json");
    
    this.store = {
      memories: [],
      lastUpdated: new Date(),
    };
    
    this.load();
  }

  /**
   * Load memories and rules from disk
   */
  private load(): void {
    // Load memories
    if (fs.existsSync(this.memoriesPath)) {
      try {
        const content = fs.readFileSync(this.memoriesPath, "utf-8");
        const data = JSON.parse(content);
        this.store.memories = data.memories || [];
        this.store.lastUpdated = new Date(data.lastUpdated);
      } catch (error) {
        console.error("Failed to load memories:", error);
      }
    }

    // Load rules
    if (fs.existsSync(this.rulesPath)) {
      try {
        const content = fs.readFileSync(this.rulesPath, "utf-8");
        this.store.projectRules = JSON.parse(content);
      } catch (error) {
        console.error("Failed to load rules:", error);
      }
    }
    
    // Also check for .cursorrules compatibility
    const cursorRulesPath = path.join(this.workspaceRoot, ".cursorrules");
    if (fs.existsSync(cursorRulesPath) && !this.store.projectRules) {
      try {
        const content = fs.readFileSync(cursorRulesPath, "utf-8");
        this.store.projectRules = {
          rules: [content], // Treat entire file as rules
        };
      } catch (error) {
        console.error("Failed to load .cursorrules:", error);
      }
    }
  }

  /**
   * Save memories to disk
   */
  private saveMemories(): void {
    this.ensureConfigDir();
    this.store.lastUpdated = new Date();
    
    fs.writeFileSync(
      this.memoriesPath,
      JSON.stringify(
        {
          memories: this.store.memories,
          lastUpdated: this.store.lastUpdated,
        },
        null,
        2
      )
    );
  }

  /**
   * Save rules to disk
   */
  private saveRules(): void {
    if (!this.store.projectRules) return;
    
    this.ensureConfigDir();
    fs.writeFileSync(this.rulesPath, JSON.stringify(this.store.projectRules, null, 2));
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  // Memory CRUD operations

  /**
   * Create a new memory
   */
  createMemory(title: string, content: string, tags?: string[]): Memory {
    const memory: Memory = {
      id: uuidv4(),
      title,
      content,
      tags,
      source: "agent",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.store.memories.push(memory);
    this.saveMemories();
    return memory;
  }

  /**
   * Update an existing memory
   */
  updateMemory(id: string, updates: Partial<Pick<Memory, "title" | "content" | "tags">>): Memory | null {
    const index = this.store.memories.findIndex((m) => m.id === id);
    if (index === -1) return null;

    this.store.memories[index] = {
      ...this.store.memories[index],
      ...updates,
      updatedAt: new Date(),
    };

    this.saveMemories();
    return this.store.memories[index];
  }

  /**
   * Delete a memory
   */
  deleteMemory(id: string): boolean {
    const index = this.store.memories.findIndex((m) => m.id === id);
    if (index === -1) return false;

    this.store.memories.splice(index, 1);
    this.saveMemories();
    return true;
  }

  /**
   * Get all memories
   */
  getAllMemories(): Memory[] {
    return [...this.store.memories];
  }

  /**
   * Find memories by query
   */
  searchMemories(query: string): Memory[] {
    const queryLower = query.toLowerCase();
    return this.store.memories.filter(
      (m) =>
        m.title.toLowerCase().includes(queryLower) ||
        m.content.toLowerCase().includes(queryLower) ||
        m.tags?.some((t) => t.toLowerCase().includes(queryLower))
    );
  }

  /**
   * Get memory by ID
   */
  getMemory(id: string): Memory | undefined {
    return this.store.memories.find((m) => m.id === id);
  }

  // Project Rules operations

  /**
   * Get project rules
   */
  getRules(): ProjectRules | undefined {
    return this.store.projectRules;
  }

  /**
   * Set project rules
   */
  setRules(rules: ProjectRules): void {
    this.store.projectRules = rules;
    this.saveRules();
  }

  /**
   * Add a rule
   */
  addRule(rule: string): void {
    if (!this.store.projectRules) {
      this.store.projectRules = { rules: [] };
    }
    if (!this.store.projectRules.rules) {
      this.store.projectRules.rules = [];
    }
    this.store.projectRules.rules.push(rule);
    this.saveRules();
  }

  /**
   * Remove a rule
   */
  removeRule(index: number): void {
    if (this.store.projectRules?.rules) {
      this.store.projectRules.rules.splice(index, 1);
      this.saveRules();
    }
  }

  /**
   * Build system prompt additions from rules and memories
   */
  buildSystemPromptAdditions(): string {
    const parts: string[] = [];

    // Add project rules
    if (this.store.projectRules?.rules && this.store.projectRules.rules.length > 0) {
      parts.push("<project_rules>");
      parts.push("The following rules have been set by the user for this project:");
      parts.push(this.store.projectRules.rules.join("\n"));
      parts.push("</project_rules>");
    }

    // Add style preferences
    if (this.store.projectRules?.style) {
      const style = this.store.projectRules.style;
      const styleRules: string[] = [];
      
      if (style.indentation) {
        styleRules.push(`Use ${style.indentation}${style.indentSize ? ` (${style.indentSize})` : ""} for indentation`);
      }
      if (style.quotes) {
        styleRules.push(`Use ${style.quotes} quotes`);
      }
      if (style.semicolons !== undefined) {
        styleRules.push(`${style.semicolons ? "Always use" : "Omit"} semicolons`);
      }
      
      if (styleRules.length > 0) {
        parts.push("<code_style>");
        parts.push(styleRules.join(", ") + ".");
        parts.push("</code_style>");
      }
    }

    // Add relevant memories
    if (this.store.memories.length > 0) {
      parts.push("<memories>");
      parts.push("The following memories have been saved from previous interactions:");
      
      for (const memory of this.store.memories.slice(-20)) { // Last 20 memories
        parts.push(`- [[memory:${memory.id}]] ${memory.title}: ${memory.content}`);
      }
      
      parts.push("</memories>");
    }

    return parts.join("\n\n");
  }

  /**
   * Create default rules file
   */
  async createDefaultRules(): Promise<void> {
    const defaultRules: ProjectRules = {
      rules: [
        "Follow the existing code style and conventions in this project",
        "Write clear, self-documenting code with meaningful variable names",
        "Add comments only when the code's purpose isn't immediately clear",
      ],
      style: {
        indentation: "spaces",
        indentSize: 2,
        quotes: "double",
        semicolons: true,
      },
      testing: {
        framework: "vitest",
        location: "__tests__",
        namingPattern: "*.test.ts",
      },
      documentation: {
        style: "tsdoc",
        required: true,
      },
    };

    this.setRules(defaultRules);
  }
}

// Generate simple UUIDs without external dependency
function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Singleton instance
let memoryManager: MemoryManager | null = null;

export function getMemoryManager(): MemoryManager {
  if (!memoryManager) {
    memoryManager = new MemoryManager();
  }
  return memoryManager;
}

