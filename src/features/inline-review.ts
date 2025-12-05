/**
 * Inline Code Review - AI review with inline comments
 * Adds review comments directly in the editor like GitHub
 */

import * as vscode from "vscode";
import { getProviderManager } from "../providers";

export interface ReviewComment {
  line: number;
  endLine?: number;
  severity: "error" | "warning" | "info" | "suggestion";
  message: string;
  suggestion?: string;
  category: string;
}

export interface CodeReview {
  file: string;
  comments: ReviewComment[];
  summary: string;
  score: number; // 0-100
  metrics: {
    bugs: number;
    security: number;
    performance: number;
    style: number;
  };
}

// Decoration types for inline comments
const decorationTypes = {
  error: vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(255, 0, 0, 0.1)",
    borderWidth: "0 0 0 3px",
    borderStyle: "solid",
    borderColor: "#f44336",
    isWholeLine: true,
    after: {
      margin: "0 0 0 20px",
      color: "#f44336",
    },
  }),
  warning: vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(255, 193, 7, 0.1)",
    borderWidth: "0 0 0 3px",
    borderStyle: "solid",
    borderColor: "#ffc107",
    isWholeLine: true,
    after: {
      margin: "0 0 0 20px",
      color: "#ffc107",
    },
  }),
  info: vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(33, 150, 243, 0.1)",
    borderWidth: "0 0 0 3px",
    borderStyle: "solid",
    borderColor: "#2196f3",
    isWholeLine: true,
    after: {
      margin: "0 0 0 20px",
      color: "#2196f3",
    },
  }),
  suggestion: vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(76, 175, 80, 0.1)",
    borderWidth: "0 0 0 3px",
    borderStyle: "solid",
    borderColor: "#4caf50",
    isWholeLine: true,
    after: {
      margin: "0 0 0 20px",
      color: "#4caf50",
    },
  }),
};

/**
 * Review code with AI and show inline comments
 */
export async function reviewCode(
  document: vscode.TextDocument,
  range?: vscode.Range
): Promise<CodeReview> {
  const text = range
    ? document.getText(range)
    : document.getText();

  const startLine = range?.start.line || 0;
  const language = document.languageId;
  const fileName = document.fileName.split("/").pop();

  const provider = getProviderManager();
  const response = await provider.complete({
    messages: [
      { role: "system", content: REVIEW_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Review this ${language} code from ${fileName}:\n\n\`\`\`${language}\n${text}\n\`\`\``,
      },
    ],
    maxTokens: 2000,
  });

  const review = parseReviewResponse(response.content, startLine);
  review.file = document.fileName;

  return review;
}

/**
 * Parse AI review response
 */
function parseReviewResponse(response: string, startLine: number): CodeReview {
  const comments: ReviewComment[] = [];
  let summary = "";
  let score = 80;
  const metrics = { bugs: 0, security: 0, performance: 0, style: 0 };

  try {
    // Try to parse JSON
    const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      
      for (const comment of parsed.comments || []) {
        comments.push({
          line: (comment.line || 1) + startLine - 1,
          endLine: comment.endLine ? comment.endLine + startLine - 1 : undefined,
          severity: comment.severity || "info",
          message: comment.message || "",
          suggestion: comment.suggestion,
          category: comment.category || "general",
        });
      }

      summary = parsed.summary || "";
      score = parsed.score || 80;
      
      if (parsed.metrics) {
        metrics.bugs = parsed.metrics.bugs || 0;
        metrics.security = parsed.metrics.security || 0;
        metrics.performance = parsed.metrics.performance || 0;
        metrics.style = parsed.metrics.style || 0;
      }
    }
  } catch {
    // Parse text format
    const lines = response.split("\n");
    for (const line of lines) {
      const match = line.match(/Line\s+(\d+):\s*\[(\w+)\]\s*(.+)/i);
      if (match) {
        comments.push({
          line: parseInt(match[1]) + startLine - 1,
          severity: match[2].toLowerCase() as ReviewComment["severity"],
          message: match[3],
          category: "general",
        });
      }
    }
    
    summary = response.slice(0, 200);
  }

  return { file: "", comments, summary, score, metrics };
}

/**
 * Show review comments in editor
 */
export function showReviewInEditor(
  editor: vscode.TextEditor,
  review: CodeReview
): void {
  const decorations: Record<string, vscode.DecorationOptions[]> = {
    error: [],
    warning: [],
    info: [],
    suggestion: [],
  };

  for (const comment of review.comments) {
    const line = Math.max(0, Math.min(comment.line, editor.document.lineCount - 1));
    const range = new vscode.Range(line, 0, comment.endLine || line, 0);

    decorations[comment.severity].push({
      range,
      hoverMessage: new vscode.MarkdownString(
        `**${comment.severity.toUpperCase()}**: ${comment.message}${
          comment.suggestion ? `\n\n💡 *Suggestion*: ${comment.suggestion}` : ""
        }`
      ),
      renderOptions: {
        after: {
          contentText: ` ← ${comment.message.slice(0, 50)}${comment.message.length > 50 ? "..." : ""}`,
        },
      },
    });
  }

  editor.setDecorations(decorationTypes.error, decorations.error);
  editor.setDecorations(decorationTypes.warning, decorations.warning);
  editor.setDecorations(decorationTypes.info, decorations.info);
  editor.setDecorations(decorationTypes.suggestion, decorations.suggestion);
}

/**
 * Clear review decorations
 */
export function clearReviewDecorations(editor: vscode.TextEditor): void {
  editor.setDecorations(decorationTypes.error, []);
  editor.setDecorations(decorationTypes.warning, []);
  editor.setDecorations(decorationTypes.info, []);
  editor.setDecorations(decorationTypes.suggestion, []);
}

/**
 * Show review summary panel
 */
export async function showReviewPanel(review: CodeReview): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    "codeReview",
    "Code Review",
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

  panel.webview.html = generateReviewHTML(review);
}

function generateReviewHTML(review: CodeReview): string {
  const scoreColor = review.score >= 80 ? "#4caf50" : review.score >= 60 ? "#ffc107" : "#f44336";
  
  const commentHTML = review.comments
    .map((c) => `
      <div class="comment ${c.severity}">
        <div class="comment-header">
          <span class="severity">${c.severity}</span>
          <span class="line">Line ${c.line + 1}</span>
          <span class="category">${c.category}</span>
        </div>
        <div class="message">${c.message}</div>
        ${c.suggestion ? `<div class="suggestion">💡 ${c.suggestion}</div>` : ""}
      </div>
    `)
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { 
      font-family: system-ui; 
      padding: 20px; 
      background: #1e1e1e; 
      color: #d4d4d4; 
    }
    .score-container {
      text-align: center;
      padding: 30px;
      background: #252526;
      border-radius: 12px;
      margin-bottom: 20px;
    }
    .score {
      font-size: 72px;
      font-weight: bold;
      color: ${scoreColor};
    }
    .metrics {
      display: flex;
      gap: 15px;
      margin: 20px 0;
    }
    .metric {
      flex: 1;
      padding: 15px;
      background: #252526;
      border-radius: 8px;
      text-align: center;
    }
    .metric-value {
      font-size: 24px;
      font-weight: bold;
    }
    .comment {
      padding: 15px;
      margin: 10px 0;
      border-radius: 8px;
      border-left: 4px solid;
    }
    .comment.error { background: rgba(244,67,54,0.1); border-color: #f44336; }
    .comment.warning { background: rgba(255,193,7,0.1); border-color: #ffc107; }
    .comment.info { background: rgba(33,150,243,0.1); border-color: #2196f3; }
    .comment.suggestion { background: rgba(76,175,80,0.1); border-color: #4caf50; }
    .comment-header {
      display: flex;
      gap: 10px;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .severity {
      text-transform: uppercase;
      font-weight: bold;
    }
    .message { line-height: 1.6; }
    .suggestion {
      margin-top: 10px;
      padding: 10px;
      background: rgba(0,0,0,0.2);
      border-radius: 4px;
      font-style: italic;
    }
    .summary {
      padding: 20px;
      background: #252526;
      border-radius: 8px;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="score-container">
    <div class="score">${review.score}</div>
    <div>Code Quality Score</div>
  </div>
  
  <div class="metrics">
    <div class="metric">
      <div class="metric-value" style="color: #f44336">${review.metrics.bugs}</div>
      <div>Bugs</div>
    </div>
    <div class="metric">
      <div class="metric-value" style="color: #ff9800">${review.metrics.security}</div>
      <div>Security</div>
    </div>
    <div class="metric">
      <div class="metric-value" style="color: #2196f3">${review.metrics.performance}</div>
      <div>Performance</div>
    </div>
    <div class="metric">
      <div class="metric-value" style="color: #9c27b0">${review.metrics.style}</div>
      <div>Style</div>
    </div>
  </div>

  <div class="summary">
    <h3>Summary</h3>
    <p>${review.summary}</p>
  </div>

  <h3>Comments (${review.comments.length})</h3>
  ${commentHTML || "<p>No issues found!</p>"}
</body>
</html>`;
}

const REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer. Analyze the code and provide detailed feedback.

Return JSON in this format:
\`\`\`json
{
  "score": 85,
  "summary": "Overall assessment...",
  "metrics": {
    "bugs": 2,
    "security": 1,
    "performance": 0,
    "style": 3
  },
  "comments": [
    {
      "line": 5,
      "severity": "error|warning|info|suggestion",
      "category": "bug|security|performance|style|logic|naming",
      "message": "Description of the issue",
      "suggestion": "How to fix it"
    }
  ]
}
\`\`\`

Categories:
- error: Definite bugs or critical issues
- warning: Potential problems or code smells
- info: General observations or minor issues
- suggestion: Improvements that would make code better

Be thorough but fair. Focus on real issues, not style nitpicks.`;

