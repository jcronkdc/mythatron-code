/**
 * Inline Completions - Tab autocomplete like Cursor
 * Predicts what you're about to type
 */

import * as vscode from "vscode";
import { getProviderManager } from "../providers";

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private debounceTimer: NodeJS.Timeout | null = null;
  private enabled = true;

  constructor() {
    const config = vscode.workspace.getConfiguration("claudeCode");
    this.enabled = config.get<boolean>("enableInlineCompletions") ?? false;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | null> {
    if (!this.enabled) return null;
    if (context.selectedCompletionInfo) return null;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        if (token.isCancellationRequested) {
          resolve(null);
          return;
        }

        const completion = await this.getCompletion(document, position);
        if (!completion || token.isCancellationRequested) {
          resolve(null);
          return;
        }

        const item = new vscode.InlineCompletionItem(
          completion,
          new vscode.Range(position, position)
        );

        resolve([item]);
      }, 500);
    });
  }

  private async getCompletion(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<string | null> {
    try {
      const prefix = this.getPrefix(document, position);
      const suffix = this.getSuffix(document, position);

      if (prefix.trim().length < 3 && suffix.trim().length < 3) {
        return null;
      }

      const prompt = this.buildCompletionPrompt(document, prefix, suffix);
      const providerManager = getProviderManager();
      
      const response = await providerManager.complete(
        {
          messages: [
            { role: "system", content: COMPLETION_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          maxTokens: 150,
          temperature: 0,
        },
        {
          forceComplexity: "simple",
          useCache: true,
        }
      );

      const completion = this.extractCompletion(response.content);
      
      if (!completion || completion.length < 2) {
        return null;
      }

      return completion;
    } catch (error) {
      console.error("Completion error:", error);
      return null;
    }
  }

  private getPrefix(document: vscode.TextDocument, position: vscode.Position): string {
    const startLine = Math.max(0, position.line - 15);
    const range = new vscode.Range(startLine, 0, position.line, position.character);
    return document.getText(range);
  }

  private getSuffix(document: vscode.TextDocument, position: vscode.Position): string {
    const endLine = Math.min(document.lineCount - 1, position.line + 5);
    const range = new vscode.Range(
      position.line,
      position.character,
      endLine,
      document.lineAt(endLine).text.length
    );
    return document.getText(range);
  }

  private buildCompletionPrompt(
    document: vscode.TextDocument,
    prefix: string,
    suffix: string
  ): string {
    const language = document.languageId;
    const filename = document.fileName.split("/").pop() || "file";

    return `Complete the code at <CURSOR>.
File: ${filename} (${language})

\`\`\`${language}
${prefix}<CURSOR>${suffix}
\`\`\`

Output ONLY the completion text.`;
  }

  private extractCompletion(response: string): string | null {
    let completion = response.replace(/```[\s\S]*?```/g, "").trim();
    completion = completion.replace(/^(here'?s?|the|completion:?)\s*/i, "").trim();

    if (completion.includes("The completion") || completion.length > 200) {
      return null;
    }

    return completion || null;
  }
}

const COMPLETION_SYSTEM_PROMPT = `You are a code completion engine. Output ONLY the text to insert at <CURSOR>.

Rules:
- Output ONLY completion text, no explanations
- Match existing code style
- Complete the current statement
- Keep it short and focused`;

/**
 * Register the inline completion provider
 */
export function registerInlineCompletions(
  context: vscode.ExtensionContext
): InlineCompletionProvider {
  const provider = new InlineCompletionProvider();

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: "**" },
      provider
    )
  );

  return provider;
}

