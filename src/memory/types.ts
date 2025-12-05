/**
 * Memory System Types
 * Persistent knowledge across sessions
 */

export interface Memory {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  tags?: string[];
  source?: "user" | "agent" | "system";
}

export interface ProjectRules {
  /** Rules that apply to all interactions */
  rules?: string[];
  
  /** File patterns to always include in context */
  alwaysInclude?: string[];
  
  /** File patterns to never include */
  neverInclude?: string[];
  
  /** Custom instructions for specific file types */
  fileTypeInstructions?: Record<string, string>;
  
  /** Preferred coding style */
  style?: {
    indentation?: "tabs" | "spaces";
    indentSize?: number;
    quotes?: "single" | "double";
    semicolons?: boolean;
    trailingComma?: "none" | "es5" | "all";
  };
  
  /** Testing preferences */
  testing?: {
    framework?: string;
    location?: string;
    namingPattern?: string;
  };
  
  /** Documentation preferences */
  documentation?: {
    style?: "jsdoc" | "tsdoc" | "markdown";
    required?: boolean;
  };
}

export interface MemoryStore {
  memories: Memory[];
  projectRules?: ProjectRules;
  lastUpdated: Date;
}

