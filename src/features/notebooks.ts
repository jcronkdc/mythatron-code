/**
 * Notebook Support - Edit Jupyter notebooks
 * Supports: .ipynb files, cell-level editing, execution
 */

import * as fs from "fs";
import * as path from "path";

export interface NotebookCell {
  cell_type: "code" | "markdown" | "raw";
  source: string[];
  metadata?: Record<string, unknown>;
  outputs?: Array<{
    output_type: string;
    text?: string[];
    data?: Record<string, unknown>;
  }>;
  execution_count?: number | null;
}

export interface NotebookDocument {
  cells: NotebookCell[];
  metadata: {
    kernelspec?: {
      display_name: string;
      language: string;
      name: string;
    };
    language_info?: {
      name: string;
      version?: string;
    };
  };
  nbformat: number;
  nbformat_minor: number;
}

/**
 * Read a Jupyter notebook file
 */
export function readNotebook(filePath: string): NotebookDocument | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as NotebookDocument;
  } catch (error) {
    console.error("Failed to read notebook:", error);
    return null;
  }
}

/**
 * Write a Jupyter notebook file
 */
export function writeNotebook(filePath: string, notebook: NotebookDocument): boolean {
  try {
    const content = JSON.stringify(notebook, null, 1);
    fs.writeFileSync(filePath, content, "utf-8");
    return true;
  } catch (error) {
    console.error("Failed to write notebook:", error);
    return false;
  }
}

/**
 * Get cell content as a single string
 */
export function getCellContent(cell: NotebookCell): string {
  return cell.source.join("");
}

/**
 * Set cell content from a string
 */
export function setCellContent(cell: NotebookCell, content: string): void {
  const lines = content.split("\n");
  cell.source = lines.map((line, i) => 
    i < lines.length - 1 ? line + "\n" : line
  );
}

/**
 * Edit a specific cell in a notebook
 */
export function editNotebookCell(
  filePath: string,
  cellIndex: number,
  oldString: string,
  newString: string
): { success: boolean; error?: string } {
  const notebook = readNotebook(filePath);
  if (!notebook) {
    return { success: false, error: "Could not read notebook" };
  }

  if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
    return { success: false, error: `Cell index ${cellIndex} out of range (0-${notebook.cells.length - 1})` };
  }

  const cell = notebook.cells[cellIndex];
  const content = getCellContent(cell);

  if (!content.includes(oldString)) {
    return { success: false, error: "old_string not found in cell" };
  }

  const newContent = content.replace(oldString, newString);
  setCellContent(cell, newContent);

  if (!writeNotebook(filePath, notebook)) {
    return { success: false, error: "Failed to write notebook" };
  }

  return { success: true };
}

/**
 * Create a new cell in a notebook
 */
export function createNotebookCell(
  filePath: string,
  cellIndex: number,
  cellType: "code" | "markdown" | "raw",
  content: string
): { success: boolean; error?: string } {
  const notebook = readNotebook(filePath);
  if (!notebook) {
    return { success: false, error: "Could not read notebook" };
  }

  const newCell: NotebookCell = {
    cell_type: cellType,
    source: [],
    metadata: {},
  };

  if (cellType === "code") {
    newCell.outputs = [];
    newCell.execution_count = null;
  }

  setCellContent(newCell, content);
  notebook.cells.splice(cellIndex, 0, newCell);

  if (!writeNotebook(filePath, notebook)) {
    return { success: false, error: "Failed to write notebook" };
  }

  return { success: true };
}

/**
 * Delete a cell from a notebook
 */
export function deleteNotebookCell(
  filePath: string,
  cellIndex: number
): { success: boolean; error?: string } {
  const notebook = readNotebook(filePath);
  if (!notebook) {
    return { success: false, error: "Could not read notebook" };
  }

  if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
    return { success: false, error: `Cell index ${cellIndex} out of range` };
  }

  notebook.cells.splice(cellIndex, 1);

  if (!writeNotebook(filePath, notebook)) {
    return { success: false, error: "Failed to write notebook" };
  }

  return { success: true };
}

/**
 * Get notebook summary for context
 */
export function getNotebookSummary(filePath: string): string {
  const notebook = readNotebook(filePath);
  if (!notebook) {
    return "Could not read notebook";
  }

  const lines: string[] = [
    `Notebook: ${path.basename(filePath)}`,
    `Cells: ${notebook.cells.length}`,
    `Kernel: ${notebook.metadata.kernelspec?.display_name || "Unknown"}`,
    "",
    "Cells:",
  ];

  notebook.cells.forEach((cell, i) => {
    const preview = getCellContent(cell).slice(0, 50).replace(/\n/g, " ");
    const hasOutput = cell.outputs && cell.outputs.length > 0;
    lines.push(`  [${i}] ${cell.cell_type}${hasOutput ? " ✓" : ""}: ${preview}...`);
  });

  return lines.join("\n");
}

/**
 * Create a new empty notebook
 */
export function createNotebook(
  filePath: string,
  language = "python"
): { success: boolean; error?: string } {
  const notebook: NotebookDocument = {
    cells: [],
    metadata: {
      kernelspec: {
        display_name: language === "python" ? "Python 3" : language,
        language: language,
        name: language === "python" ? "python3" : language,
      },
      language_info: {
        name: language,
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };

  if (!writeNotebook(filePath, notebook)) {
    return { success: false, error: "Failed to create notebook" };
  }

  return { success: true };
}

