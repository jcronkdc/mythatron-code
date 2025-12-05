/**
 * Smart Imports - Auto-add missing imports
 * Analyzes code and suggests/adds imports automatically
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface ImportSuggestion {
  symbol: string;
  module: string;
  isDefault: boolean;
  confidence: number;
}

export interface MissingImport {
  symbol: string;
  line: number;
  suggestions: ImportSuggestion[];
}

// Common module mappings
const COMMON_IMPORTS: Record<string, string> = {
  // React
  useState: "react",
  useEffect: "react",
  useContext: "react",
  useReducer: "react",
  useCallback: "react",
  useMemo: "react",
  useRef: "react",
  React: "react",
  
  // React DOM
  createRoot: "react-dom/client",
  
  // Next.js
  useRouter: "next/router",
  usePathname: "next/navigation",
  useSearchParams: "next/navigation",
  Image: "next/image",
  Link: "next/link",
  Head: "next/head",
  
  // Express
  Request: "express",
  Response: "express",
  NextFunction: "express",
  Router: "express",
  
  // Node.js
  fs: "fs",
  path: "path",
  http: "http",
  https: "https",
  os: "os",
  util: "util",
  events: "events",
  stream: "stream",
  crypto: "crypto",
  
  // Lodash
  _: "lodash",
  debounce: "lodash",
  throttle: "lodash",
  cloneDeep: "lodash",
  
  // Axios
  axios: "axios",
  AxiosError: "axios",
  AxiosResponse: "axios",
  
  // Zod
  z: "zod",
  ZodError: "zod",
  
  // Date-fns
  format: "date-fns",
  parseISO: "date-fns",
  addDays: "date-fns",
  
  // Testing
  describe: "vitest",
  it: "vitest",
  expect: "vitest",
  vi: "vitest",
  jest: "@jest/globals",
};

/**
 * Find missing imports in a file
 */
export async function findMissingImports(
  document: vscode.TextDocument
): Promise<MissingImport[]> {
  const text = document.getText();
  const missing: MissingImport[] = [];
  
  // Get existing imports
  const existingImports = new Set<string>();
  const importRegex = /import\s+(?:\{([^}]+)\}|(\w+))\s+from/g;
  let match;
  
  while ((match = importRegex.exec(text)) !== null) {
    if (match[1]) {
      // Named imports
      match[1].split(",").forEach((name) => {
        const trimmed = name.trim().split(" as ")[0].trim();
        existingImports.add(trimmed);
      });
    }
    if (match[2]) {
      // Default import
      existingImports.add(match[2]);
    }
  }
  
  // Find undefined identifiers
  const identifierRegex = /\b([A-Z][a-zA-Z0-9]*)\b/g;
  const lines = text.split("\n");
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip import/export lines
    if (line.trim().startsWith("import ") || line.trim().startsWith("export ")) {
      continue;
    }
    
    let identifierMatch;
    while ((identifierMatch = identifierRegex.exec(line)) !== null) {
      const symbol = identifierMatch[1];
      
      // Skip if already imported
      if (existingImports.has(symbol)) continue;
      
      // Skip common JS globals
      if (["String", "Number", "Boolean", "Object", "Array", "Promise", "Error", "Map", "Set", "Date", "JSON", "Math", "console", "window", "document", "process"].includes(symbol)) {
        continue;
      }
      
      // Check if we have a suggestion
      const suggestions = getSuggestionsForSymbol(symbol, document);
      if (suggestions.length > 0) {
        // Check if already added
        if (!missing.some((m) => m.symbol === symbol)) {
          missing.push({
            symbol,
            line: i + 1,
            suggestions,
          });
        }
      }
    }
  }
  
  // Also check lowercase identifiers from common imports
  for (const [symbol, module] of Object.entries(COMMON_IMPORTS)) {
    if (symbol[0] === symbol[0].toLowerCase()) {
      const regex = new RegExp(`\\b${symbol}\\b`, "g");
      if (regex.test(text) && !existingImports.has(symbol)) {
        if (!missing.some((m) => m.symbol === symbol)) {
          missing.push({
            symbol,
            line: 1,
            suggestions: [{
              symbol,
              module,
              isDefault: symbol === module,
              confidence: 0.9,
            }],
          });
        }
      }
    }
  }
  
  return missing;
}

/**
 * Get import suggestions for a symbol
 */
function getSuggestionsForSymbol(
  symbol: string,
  document: vscode.TextDocument
): ImportSuggestion[] {
  const suggestions: ImportSuggestion[] = [];
  
  // Check common imports
  if (COMMON_IMPORTS[symbol]) {
    suggestions.push({
      symbol,
      module: COMMON_IMPORTS[symbol],
      isDefault: symbol === COMMON_IMPORTS[symbol] || symbol[0] === symbol[0].toUpperCase() && !symbol.includes("use"),
      confidence: 0.95,
    });
  }
  
  // Check for local files with the same name
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    const possiblePaths = [
      `./${symbol}`,
      `../${symbol}`,
      `@/${symbol}`,
      `~/components/${symbol}`,
      `~/utils/${symbol}`,
    ];
    
    for (const modulePath of possiblePaths) {
      suggestions.push({
        symbol,
        module: modulePath,
        isDefault: true,
        confidence: 0.5,
      });
    }
  }
  
  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Add import to document
 */
export async function addImport(
  document: vscode.TextDocument,
  suggestion: ImportSuggestion
): Promise<boolean> {
  const text = document.getText();
  
  // Find insertion point (after last import or at start)
  let insertLine = 0;
  const lines = text.split("\n");
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("import ")) {
      insertLine = i + 1;
    }
  }
  
  // Check if import from this module already exists
  const existingImportRegex = new RegExp(`import\\s+(?:\\{([^}]+)\\})?(?:\\s*,?\\s*(\\w+))?\\s+from\\s+['"]${suggestion.module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`);
  const existingMatch = text.match(existingImportRegex);
  
  const edit = new vscode.WorkspaceEdit();
  
  if (existingMatch) {
    // Add to existing import
    const existingLine = text.split("\n").findIndex((l) => existingImportRegex.test(l));
    if (existingLine >= 0 && existingMatch[1]) {
      // Add to named imports
      const line = lines[existingLine];
      const newLine = line.replace(
        /\{([^}]+)\}/,
        `{ ${existingMatch[1].trim()}, ${suggestion.symbol} }`
      );
      
      edit.replace(
        document.uri,
        new vscode.Range(existingLine, 0, existingLine, line.length),
        newLine
      );
    }
  } else {
    // Add new import
    const importStatement = suggestion.isDefault
      ? `import ${suggestion.symbol} from '${suggestion.module}';\n`
      : `import { ${suggestion.symbol} } from '${suggestion.module}';\n`;
    
    edit.insert(document.uri, new vscode.Position(insertLine, 0), importStatement);
  }
  
  return vscode.workspace.applyEdit(edit);
}

/**
 * Auto-fix all missing imports
 */
export async function autoFixImports(
  document: vscode.TextDocument
): Promise<number> {
  const missing = await findMissingImports(document);
  let fixed = 0;
  
  for (const item of missing) {
    if (item.suggestions.length > 0 && item.suggestions[0].confidence > 0.8) {
      const success = await addImport(document, item.suggestions[0]);
      if (success) fixed++;
    }
  }
  
  return fixed;
}

/**
 * Show import picker for symbol
 */
export async function showImportPicker(
  document: vscode.TextDocument,
  symbol: string
): Promise<void> {
  const missing = await findMissingImports(document);
  const item = missing.find((m) => m.symbol === symbol);
  
  if (!item || item.suggestions.length === 0) {
    vscode.window.showWarningMessage(`No import suggestions for ${symbol}`);
    return;
  }
  
  const picks = item.suggestions.map((s) => ({
    label: s.isDefault ? `import ${s.symbol}` : `import { ${s.symbol} }`,
    description: `from '${s.module}'`,
    detail: `${Math.round(s.confidence * 100)}% confidence`,
    suggestion: s,
  }));
  
  const selected = await vscode.window.showQuickPick(picks, {
    placeHolder: `Import ${symbol} from...`,
  });
  
  if (selected) {
    await addImport(document, selected.suggestion);
  }
}

