/**
 * Prompts Library - Saved prompts and templates
 * Quick access to common operations
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface SavedPrompt {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  category: string;
  variables?: string[]; // Placeholders like {{selection}}, {{filename}}
  createdAt: Date;
  usageCount: number;
}

export interface PromptCategory {
  name: string;
  icon: string;
  prompts: SavedPrompt[];
}

// Built-in prompts
export const BUILTIN_PROMPTS: SavedPrompt[] = [
  // Code Quality
  {
    id: "review-code",
    name: "Code Review",
    description: "Review code for issues and improvements",
    prompt: "Review this code for:\n1. Bugs or potential issues\n2. Performance problems\n3. Security vulnerabilities\n4. Code style and best practices\n\n{{selection}}",
    category: "Code Quality",
    variables: ["selection"],
    createdAt: new Date(),
    usageCount: 0,
  },
  {
    id: "explain-code",
    name: "Explain Code",
    description: "Get a detailed explanation of code",
    prompt: "Explain this code in detail:\n- What does it do?\n- How does it work?\n- What are the key concepts?\n\n{{selection}}",
    category: "Code Quality",
    variables: ["selection"],
    createdAt: new Date(),
    usageCount: 0,
  },
  {
    id: "optimize-code",
    name: "Optimize Code",
    description: "Suggest performance optimizations",
    prompt: "Analyze this code for performance:\n1. Identify bottlenecks\n2. Suggest optimizations\n3. Explain the improvements\n\n{{selection}}",
    category: "Code Quality",
    variables: ["selection"],
    createdAt: new Date(),
    usageCount: 0,
  },

  // Refactoring
  {
    id: "refactor-extract",
    name: "Extract Function",
    description: "Extract selection into a new function",
    prompt: "Extract this code into a well-named function with proper parameters and return type:\n\n{{selection}}",
    category: "Refactoring",
    variables: ["selection"],
    createdAt: new Date(),
    usageCount: 0,
  },
  {
    id: "refactor-simplify",
    name: "Simplify Code",
    description: "Simplify complex code",
    prompt: "Simplify this code while maintaining functionality. Make it more readable and maintainable:\n\n{{selection}}",
    category: "Refactoring",
    variables: ["selection"],
    createdAt: new Date(),
    usageCount: 0,
  },
  {
    id: "refactor-typescript",
    name: "Add TypeScript Types",
    description: "Add proper TypeScript types",
    prompt: "Add comprehensive TypeScript types to this code. Include interfaces for complex objects:\n\n{{selection}}",
    category: "Refactoring",
    variables: ["selection"],
    createdAt: new Date(),
    usageCount: 0,
  },

  // Testing
  {
    id: "generate-tests",
    name: "Generate Tests",
    description: "Generate unit tests",
    prompt: "Generate comprehensive unit tests for this code using the project's testing framework. Include edge cases:\n\n{{selection}}",
    category: "Testing",
    variables: ["selection"],
    createdAt: new Date(),
    usageCount: 0,
  },
  {
    id: "test-edge-cases",
    name: "Find Edge Cases",
    description: "Identify edge cases to test",
    prompt: "Identify all edge cases and boundary conditions that should be tested for this code:\n\n{{selection}}",
    category: "Testing",
    variables: ["selection"],
    createdAt: new Date(),
    usageCount: 0,
  },

  // Documentation
  {
    id: "add-jsdoc",
    name: "Add JSDoc",
    description: "Add JSDoc comments",
    prompt: "Add comprehensive JSDoc comments to this code, including @param, @returns, @throws, and @example:\n\n{{selection}}",
    category: "Documentation",
    variables: ["selection"],
    createdAt: new Date(),
    usageCount: 0,
  },
  {
    id: "generate-readme",
    name: "Generate README",
    description: "Generate README for current project",
    prompt: "Analyze this project and generate a comprehensive README.md including:\n- Project description\n- Installation\n- Usage examples\n- API documentation\n- Contributing guidelines",
    category: "Documentation",
    variables: [],
    createdAt: new Date(),
    usageCount: 0,
  },

  // Debugging
  {
    id: "fix-error",
    name: "Fix Error",
    description: "Fix the current error",
    prompt: "Fix this error:\n\n{{error}}\n\nIn file: {{filename}}\n\nCode context:\n{{selection}}",
    category: "Debugging",
    variables: ["error", "filename", "selection"],
    createdAt: new Date(),
    usageCount: 0,
  },
  {
    id: "debug-issue",
    name: "Debug Issue",
    description: "Help debug an issue",
    prompt: "Help me debug this issue. The code should {{expected}} but instead {{actual}}:\n\n{{selection}}",
    category: "Debugging",
    variables: ["expected", "actual", "selection"],
    createdAt: new Date(),
    usageCount: 0,
  },

  // Architecture
  {
    id: "suggest-architecture",
    name: "Architecture Review",
    description: "Review and suggest architecture improvements",
    prompt: "Review the architecture of this codebase and suggest improvements for:\n- Scalability\n- Maintainability\n- Performance\n- Testing",
    category: "Architecture",
    variables: [],
    createdAt: new Date(),
    usageCount: 0,
  },
  {
    id: "design-pattern",
    name: "Suggest Design Pattern",
    description: "Suggest applicable design patterns",
    prompt: "Analyze this code and suggest design patterns that could improve it:\n\n{{selection}}",
    category: "Architecture",
    variables: ["selection"],
    createdAt: new Date(),
    usageCount: 0,
  },
];

export class PromptsLibrary {
  private customPrompts: SavedPrompt[] = [];
  private promptsPath: string;

  constructor(workspaceRoot: string) {
    this.promptsPath = path.join(workspaceRoot, ".mythatron", "prompts.json");
    this.loadPrompts();
  }

  private loadPrompts(): void {
    try {
      if (fs.existsSync(this.promptsPath)) {
        const data = JSON.parse(fs.readFileSync(this.promptsPath, "utf-8"));
        this.customPrompts = data.prompts || [];
      }
    } catch {
      this.customPrompts = [];
    }
  }

  private savePrompts(): void {
    const dir = path.dirname(this.promptsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      this.promptsPath,
      JSON.stringify({ prompts: this.customPrompts }, null, 2)
    );
  }

  getAllPrompts(): SavedPrompt[] {
    return [...BUILTIN_PROMPTS, ...this.customPrompts];
  }

  getByCategory(): PromptCategory[] {
    const prompts = this.getAllPrompts();
    const categories = new Map<string, SavedPrompt[]>();

    for (const prompt of prompts) {
      if (!categories.has(prompt.category)) {
        categories.set(prompt.category, []);
      }
      categories.get(prompt.category)!.push(prompt);
    }

    const icons: Record<string, string> = {
      "Code Quality": "🔍",
      "Refactoring": "🔧",
      "Testing": "🧪",
      "Documentation": "📝",
      "Debugging": "🐛",
      "Architecture": "🏗️",
      "Custom": "⭐",
    };

    return Array.from(categories.entries()).map(([name, prompts]) => ({
      name,
      icon: icons[name] || "📌",
      prompts: prompts.sort((a, b) => b.usageCount - a.usageCount),
    }));
  }

  createPrompt(prompt: Omit<SavedPrompt, "id" | "createdAt" | "usageCount">): SavedPrompt {
    const newPrompt: SavedPrompt = {
      ...prompt,
      id: `custom-${Date.now()}`,
      createdAt: new Date(),
      usageCount: 0,
    };

    this.customPrompts.push(newPrompt);
    this.savePrompts();

    return newPrompt;
  }

  deletePrompt(id: string): boolean {
    const idx = this.customPrompts.findIndex((p) => p.id === id);
    if (idx === -1) return false;

    this.customPrompts.splice(idx, 1);
    this.savePrompts();
    return true;
  }

  recordUsage(id: string): void {
    const prompt =
      this.customPrompts.find((p) => p.id === id) ||
      BUILTIN_PROMPTS.find((p) => p.id === id);
    
    if (prompt) {
      prompt.usageCount++;
      if (this.customPrompts.includes(prompt)) {
        this.savePrompts();
      }
    }
  }

  /**
   * Expand variables in a prompt
   */
  expandPrompt(prompt: SavedPrompt, variables: Record<string, string>): string {
    let text = prompt.prompt;

    for (const [key, value] of Object.entries(variables)) {
      text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }

    return text;
  }
}

// Singleton
let promptsLibrary: PromptsLibrary | null = null;

export function getPromptsLibrary(): PromptsLibrary {
  if (!promptsLibrary) {
    const workspaceRoot =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    promptsLibrary = new PromptsLibrary(workspaceRoot);
  }
  return promptsLibrary;
}

