/**
 * Smart Commits - AI-generated commit messages
 * Analyzes diff and generates conventional commit messages
 */

import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import { getProviderManager } from "../providers";

const execAsync = promisify(exec);

export interface CommitSuggestion {
  type: "feat" | "fix" | "docs" | "style" | "refactor" | "test" | "chore" | "perf";
  scope?: string;
  subject: string;
  body?: string;
  breaking?: boolean;
  confidence: number;
}

/**
 * Analyze staged changes and generate commit message
 */
export async function generateCommitMessage(
  workspaceRoot: string
): Promise<CommitSuggestion[]> {
  // Get staged diff
  const { stdout: diff } = await execAsync("git diff --staged", {
    cwd: workspaceRoot,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (!diff.trim()) {
    throw new Error("No staged changes");
  }

  // Get file list
  const { stdout: files } = await execAsync(
    "git diff --staged --name-only",
    { cwd: workspaceRoot }
  );

  const fileList = files.trim().split("\n");

  // Analyze with AI
  const provider = getProviderManager();
  const response = await provider.complete({
    messages: [
      {
        role: "system",
        content: COMMIT_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `Files changed:\n${fileList.join("\n")}\n\nDiff:\n${diff.slice(0, 8000)}`,
      },
    ],
    maxTokens: 500,
  });

  // Parse suggestions
  return parseCommitSuggestions(response.content);
}

/**
 * Parse AI response into commit suggestions
 */
function parseCommitSuggestions(response: string): CommitSuggestion[] {
  const suggestions: CommitSuggestion[] = [];

  // Try to parse JSON
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.map((s: any) => ({
        type: s.type || "chore",
        scope: s.scope,
        subject: s.subject || s.message || "Update code",
        body: s.body,
        breaking: s.breaking || false,
        confidence: s.confidence || 0.8,
      }));
    }
  } catch {
    // Fall back to text parsing
  }

  // Parse conventional commit format
  const lines = response.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const match = line.match(
      /^(feat|fix|docs|style|refactor|test|chore|perf)(\(([^)]+)\))?(!)?:\s*(.+)$/i
    );
    if (match) {
      suggestions.push({
        type: match[1].toLowerCase() as CommitSuggestion["type"],
        scope: match[3],
        subject: match[5],
        breaking: !!match[4],
        confidence: 0.9,
      });
    }
  }

  if (suggestions.length === 0) {
    // Default suggestion
    suggestions.push({
      type: "chore",
      subject: "Update code",
      confidence: 0.5,
    });
  }

  return suggestions;
}

/**
 * Format commit message
 */
export function formatCommitMessage(suggestion: CommitSuggestion): string {
  let message = suggestion.type;
  if (suggestion.scope) {
    message += `(${suggestion.scope})`;
  }
  if (suggestion.breaking) {
    message += "!";
  }
  message += `: ${suggestion.subject}`;

  if (suggestion.body) {
    message += `\n\n${suggestion.body}`;
  }

  return message;
}

/**
 * Show commit message picker
 */
export async function showCommitPicker(
  workspaceRoot: string
): Promise<string | undefined> {
  const suggestions = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating commit message...",
    },
    () => generateCommitMessage(workspaceRoot)
  );

  const items = suggestions.map((s) => ({
    label: formatCommitMessage(s),
    description: `${Math.round(s.confidence * 100)}% confidence`,
    detail: s.body,
    suggestion: s,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select commit message",
  });

  return selected?.label;
}

const COMMIT_SYSTEM_PROMPT = `You are a commit message generator. Analyze the diff and generate conventional commit messages.

Rules:
1. Use conventional commit format: type(scope): subject
2. Types: feat, fix, docs, style, refactor, test, chore, perf
3. Scope is optional but helpful (e.g., auth, api, ui)
4. Subject should be imperative mood ("add" not "added")
5. Keep subject under 50 characters
6. Add body for complex changes

Output as JSON array:
[{"type": "feat", "scope": "auth", "subject": "add login endpoint", "body": "...", "confidence": 0.9}]`;

