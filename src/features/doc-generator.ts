/**
 * Documentation Generator - Auto-generate docs
 * JSDoc, README, API documentation
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { getProviderManager } from "../providers";

export interface DocGenerationOptions {
  style: "jsdoc" | "tsdoc" | "docstring" | "markdown";
  includeExamples: boolean;
  includeTypes: boolean;
}

/**
 * Generate documentation for a function
 */
export async function generateFunctionDoc(
  code: string,
  language: string,
  options: DocGenerationOptions = {
    style: "jsdoc",
    includeExamples: true,
    includeTypes: true,
  }
): Promise<string> {
  const provider = getProviderManager();

  const response = await provider.complete({
    messages: [
      {
        role: "system",
        content: `Generate ${options.style} documentation for the following ${language} code.
Include:
- Description of what the function/class does
- @param tags for all parameters${options.includeTypes ? " with types" : ""}
- @returns tag describing the return value
${options.includeExamples ? "- @example with usage example" : ""}
- @throws if the function can throw errors

Output ONLY the documentation comment, nothing else.`,
      },
      {
        role: "user",
        content: code,
      },
    ],
    maxTokens: 500,
  });

  return response.content.trim();
}

/**
 * Generate README for a project
 */
export async function generateReadme(workspaceRoot: string): Promise<string> {
  // Gather project info
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  let packageJson: any = {};

  if (fs.existsSync(packageJsonPath)) {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  }

  // Get project structure
  const structure = getProjectStructure(workspaceRoot);

  // Get sample code files
  const sampleFiles = getSampleFiles(workspaceRoot);

  const provider = getProviderManager();

  const response = await provider.complete({
    messages: [
      {
        role: "system",
        content: README_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `Project: ${packageJson.name || "Unknown"}
Description: ${packageJson.description || "No description"}
Version: ${packageJson.version || "1.0.0"}
Dependencies: ${Object.keys(packageJson.dependencies || {}).join(", ") || "None"}
Dev Dependencies: ${Object.keys(packageJson.devDependencies || {}).join(", ") || "None"}
Scripts: ${JSON.stringify(packageJson.scripts || {}, null, 2)}

Project Structure:
${structure}

Sample files:
${sampleFiles}`,
      },
    ],
    maxTokens: 2000,
  });

  return response.content;
}

/**
 * Generate API documentation for a file
 */
export async function generateApiDoc(
  document: vscode.TextDocument
): Promise<string> {
  const content = document.getText();
  const language = document.languageId;
  const fileName = path.basename(document.fileName);

  const provider = getProviderManager();

  const response = await provider.complete({
    messages: [
      {
        role: "system",
        content: API_DOC_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `File: ${fileName}
Language: ${language}

\`\`\`${language}
${content}
\`\`\``,
      },
    ],
    maxTokens: 3000,
  });

  return response.content;
}

/**
 * Add JSDoc to all functions in a file
 */
export async function addDocsToFile(
  document: vscode.TextDocument
): Promise<vscode.WorkspaceEdit> {
  const content = document.getText();
  const language = document.languageId;
  const edit = new vscode.WorkspaceEdit();

  // Find functions without docs
  const functionRegex = /(?<!\/\*\*[\s\S]*?\*\/\s*)^(\s*)((?:export\s+)?(?:async\s+)?(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|class\s+\w+))/gm;

  const matches: Array<{ index: number; match: string; indent: string }> = [];
  let match;

  while ((match = functionRegex.exec(content)) !== null) {
    matches.push({
      index: match.index,
      match: match[2],
      indent: match[1],
    });
  }

  // Generate docs for each function (in reverse to preserve indices)
  for (const m of matches.reverse()) {
    // Extract function code
    let braceCount = 0;
    let started = false;
    let endIndex = m.index;

    for (let i = m.index; i < content.length; i++) {
      if (content[i] === "{") {
        braceCount++;
        started = true;
      }
      if (content[i] === "}") {
        braceCount--;
      }
      if (started && braceCount === 0) {
        endIndex = i + 1;
        break;
      }
    }

    const funcCode = content.slice(m.index, endIndex);
    const doc = await generateFunctionDoc(funcCode, language, {
      style: "jsdoc",
      includeExamples: false,
      includeTypes: true,
    });

    // Insert doc before function
    const lines = content.slice(0, m.index).split("\n");
    const lineNumber = lines.length - 1;
    const insertPosition = new vscode.Position(lineNumber, 0);

    edit.insert(document.uri, insertPosition, doc + "\n" + m.indent);
  }

  return edit;
}

/**
 * Get project structure
 */
function getProjectStructure(dir: string, depth = 0, maxDepth = 3): string {
  if (depth > maxDepth) return "";

  const lines: string[] = [];
  const indent = "  ".repeat(depth);
  const ignoreDirs = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".") && depth > 0) continue;
      if (ignoreDirs.has(entry.name)) continue;

      if (entry.isDirectory()) {
        lines.push(`${indent}📁 ${entry.name}/`);
        lines.push(getProjectStructure(path.join(dir, entry.name), depth + 1, maxDepth));
      } else {
        lines.push(`${indent}📄 ${entry.name}`);
      }
    }
  } catch {
    // Skip inaccessible directories
  }

  return lines.filter(Boolean).join("\n");
}

/**
 * Get sample files content
 */
function getSampleFiles(dir: string): string {
  const samples: string[] = [];
  const importantFiles = ["index.ts", "index.js", "main.ts", "main.js", "app.ts", "app.js"];

  for (const file of importantFiles) {
    const filePath = path.join(dir, "src", file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      samples.push(`--- ${file} ---\n${content.slice(0, 500)}${content.length > 500 ? "..." : ""}`);
      break;
    }
  }

  return samples.join("\n\n");
}

const README_SYSTEM_PROMPT = `Generate a comprehensive README.md for this project.

Include:
1. Project title and badges
2. Description
3. Features (bullet points)
4. Installation instructions
5. Usage examples with code blocks
6. API documentation if applicable
7. Configuration options
8. Contributing guidelines
9. License

Use proper markdown formatting. Be concise but informative.`;

const API_DOC_SYSTEM_PROMPT = `Generate API documentation for this code file.

Format as Markdown with:
1. File overview
2. Exported functions/classes
3. Type definitions
4. Parameters and return types
5. Usage examples

Use proper markdown formatting with code blocks.`;

/**
 * Show doc generation UI
 */
export async function showDocGeneratorUI(): Promise<void> {
  const options = [
    { label: "Generate README", description: "Create README.md for project", action: "readme" },
    { label: "Add JSDoc to File", description: "Add documentation to all functions", action: "jsdoc" },
    { label: "Generate API Docs", description: "Create API documentation", action: "api" },
  ];

  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: "What documentation do you want to generate?",
  });

  if (!selected) return;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating documentation...",
    },
    async () => {
      switch (selected.action) {
        case "readme": {
          const readme = await generateReadme(workspaceRoot);
          const doc = await vscode.workspace.openTextDocument({
            content: readme,
            language: "markdown",
          });
          await vscode.window.showTextDocument(doc);
          break;
        }
        case "jsdoc": {
          const editor = vscode.window.activeTextEditor;
          if (!editor) return;
          const edit = await addDocsToFile(editor.document);
          await vscode.workspace.applyEdit(edit);
          break;
        }
        case "api": {
          const editor = vscode.window.activeTextEditor;
          if (!editor) return;
          const apiDoc = await generateApiDoc(editor.document);
          const doc = await vscode.workspace.openTextDocument({
            content: apiDoc,
            language: "markdown",
          });
          await vscode.window.showTextDocument(doc);
          break;
        }
      }
    }
  );
}

