/**
 * Tool definitions for Claude Code
 * COMPLETE replication of ALL Cursor/Claude capabilities
 */

import type Anthropic from "@anthropic-ai/sdk";

export const tools: Anthropic.Tool[] = [
  // ============================================
  // FILE OPERATIONS
  // ============================================
  {
    name: "read_file",
    description:
      "Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Returns file contents with line numbers for text, or image data for images.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The absolute or relative path to the file to read",
        },
        start_line: {
          type: "number",
          description: "Optional starting line number (1-indexed, text files only)",
        },
        end_line: {
          type: "number",
          description: "Optional ending line number (1-indexed, text files only)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Write or overwrite content to a file. Creates parent directories if needed.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The path to write the file to",
        },
        content: {
          type: "string",
          description: "The content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Make a targeted edit by replacing a specific string. The old_string must match exactly.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The path to the file to edit",
        },
        old_string: {
          type: "string",
          description: "The exact string to find and replace",
        },
        new_string: {
          type: "string",
          description: "The string to replace it with",
        },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences (default false)",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "multi_edit",
    description: "Apply multiple edits to multiple files atomically.",
    input_schema: {
      type: "object" as const,
      properties: {
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              old_string: { type: "string" },
              new_string: { type: "string" },
            },
          },
          description: "Array of edits to apply",
        },
      },
      required: ["edits"],
    },
  },
  {
    name: "list_directory",
    description: "List files and directories in a path.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Directory path to list" },
        recursive: { type: "boolean", description: "List recursively (default false)" },
        max_depth: { type: "number", description: "Maximum depth (default 3)" },
        pattern: { type: "string", description: "Glob pattern to filter (e.g. '*.ts')" },
      },
      required: ["path"],
    },
  },
  {
    name: "create_directory",
    description: "Create a new directory. Creates parent directories if needed.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Path of directory to create" },
      },
      required: ["path"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file or directory.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Path to delete" },
        recursive: { type: "boolean", description: "Delete directories recursively" },
      },
      required: ["path"],
    },
  },
  {
    name: "rename_file",
    description: "Rename or move a file/directory.",
    input_schema: {
      type: "object" as const,
      properties: {
        old_path: { type: "string", description: "Current path" },
        new_path: { type: "string", description: "New path" },
      },
      required: ["old_path", "new_path"],
    },
  },
  {
    name: "copy_file",
    description: "Copy a file or directory.",
    input_schema: {
      type: "object" as const,
      properties: {
        source: { type: "string", description: "Source path" },
        destination: { type: "string", description: "Destination path" },
      },
      required: ["source", "destination"],
    },
  },

  // ============================================
  // NOTEBOOK OPERATIONS
  // ============================================
  {
    name: "edit_notebook",
    description:
      "Edit a Jupyter notebook cell. Can edit existing cells or create new ones.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Path to the notebook file" },
        cell_index: { type: "number", description: "Index of cell (0-based)" },
        is_new_cell: { type: "boolean", description: "True to create new cell at index" },
        cell_type: {
          type: "string",
          enum: ["code", "markdown", "raw"],
          description: "Type of cell (for new cells)",
        },
        old_string: { type: "string", description: "Text to replace (for editing)" },
        new_string: { type: "string", description: "Replacement text or new cell content" },
      },
      required: ["path", "cell_index", "new_string"],
    },
  },

  // ============================================
  // SEARCH OPERATIONS
  // ============================================
  {
    name: "codebase_search",
    description:
      "Semantic search that finds code by meaning. Use complete questions like 'Where is user authentication handled?'",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "A complete question about what to find" },
        target_directory: { type: "string", description: "Optional directory to limit search" },
        max_results: { type: "number", description: "Maximum results (default 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "grep",
    description: "Search for text/regex patterns in files. Returns matching lines.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        directory: { type: "string", description: "Directory to search (default: workspace)" },
        file_pattern: { type: "string", description: "Glob to filter files (e.g. '*.ts')" },
        case_sensitive: { type: "boolean", description: "Case sensitive (default true)" },
        context_lines: { type: "number", description: "Context lines around match" },
        max_results: { type: "number", description: "Maximum results (default 100)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "search_files",
    description: "Find files by name pattern using glob matching.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g. '**/*.ts')" },
        directory: { type: "string", description: "Base directory (default: workspace)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "web_search",
    description: "Search the web for real-time information.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "number", description: "Maximum results (default 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description: "Fetch content from a URL and extract text.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "URL to fetch" },
        extract_text: { type: "boolean", description: "Extract text from HTML (default true)" },
      },
      required: ["url"],
    },
  },

  // ============================================
  // TERMINAL OPERATIONS
  // ============================================
  {
    name: "run_terminal_command",
    description: "Execute a shell command. Use is_background for long-running processes.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "Command to execute" },
        cwd: { type: "string", description: "Working directory" },
        timeout: { type: "number", description: "Timeout in ms (default 60000)" },
        is_background: { type: "boolean", description: "Run in background" },
        permissions: {
          type: "array",
          items: { type: "string" },
          description: "Required: 'network', 'git_write', or 'all'",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "list_running_jobs",
    description: "List all running background terminal jobs.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "kill_job",
    description: "Kill a running background job by ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: { type: "string", description: "Job ID to kill" },
      },
      required: ["job_id"],
    },
  },
  {
    name: "read_terminal_output",
    description: "Read recent output from a terminal.",
    input_schema: {
      type: "object" as const,
      properties: {
        terminal_id: { type: "string", description: "Terminal ID (optional, defaults to active)" },
        lines: { type: "number", description: "Number of lines to read (default 100)" },
      },
      required: [],
    },
  },

  // ============================================
  // CODE INTELLIGENCE (FULL LSP)
  // ============================================
  {
    name: "get_diagnostics",
    description: "Get TypeScript/ESLint errors and warnings.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Optional path for specific file" },
      },
      required: [],
    },
  },
  {
    name: "get_definition",
    description: "Go to definition of a symbol at a position.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path" },
        line: { type: "number", description: "Line number (1-indexed)" },
        character: { type: "number", description: "Character position (0-indexed)" },
      },
      required: ["path", "line", "character"],
    },
  },
  {
    name: "get_references",
    description: "Find all references to a symbol.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path" },
        line: { type: "number", description: "Line number (1-indexed)" },
        character: { type: "number", description: "Character position (0-indexed)" },
      },
      required: ["path", "line", "character"],
    },
  },
  {
    name: "get_hover_info",
    description: "Get type information and documentation for a symbol.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path" },
        line: { type: "number", description: "Line number (1-indexed)" },
        character: { type: "number", description: "Character position (0-indexed)" },
      },
      required: ["path", "line", "character"],
    },
  },
  {
    name: "rename_symbol",
    description: "Rename a symbol across the entire codebase.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path" },
        line: { type: "number", description: "Line number (1-indexed)" },
        character: { type: "number", description: "Character position (0-indexed)" },
        new_name: { type: "string", description: "New name for the symbol" },
      },
      required: ["path", "line", "character", "new_name"],
    },
  },
  {
    name: "find_implementations",
    description: "Find all implementations of an interface or abstract class.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path" },
        line: { type: "number", description: "Line number (1-indexed)" },
        character: { type: "number", description: "Character position (0-indexed)" },
      },
      required: ["path", "line", "character"],
    },
  },
  {
    name: "workspace_symbols",
    description: "Search for symbols across the entire workspace.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Symbol name to search for" },
      },
      required: ["query"],
    },
  },
  {
    name: "document_symbols",
    description: "Get all symbols in a document (outline view).",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path" },
      },
      required: ["path"],
    },
  },
  {
    name: "call_hierarchy",
    description: "Get incoming/outgoing calls for a function.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path" },
        line: { type: "number", description: "Line number (1-indexed)" },
        character: { type: "number", description: "Character position (0-indexed)" },
        direction: { type: "string", enum: ["incoming", "outgoing"], description: "Call direction" },
      },
      required: ["path", "line", "character"],
    },
  },
  {
    name: "type_hierarchy",
    description: "Get type hierarchy (supertypes/subtypes) for a class.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path" },
        line: { type: "number", description: "Line number (1-indexed)" },
        character: { type: "number", description: "Character position (0-indexed)" },
        direction: { type: "string", enum: ["supertypes", "subtypes"], description: "Hierarchy direction" },
      },
      required: ["path", "line", "character"],
    },
  },
  {
    name: "get_code_actions",
    description: "Get available code actions (quick fixes, refactors) at a position.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path" },
        line: { type: "number", description: "Line number (1-indexed)" },
        character: { type: "number", description: "Character position (0-indexed)" },
      },
      required: ["path", "line", "character"],
    },
  },
  {
    name: "apply_code_action",
    description: "Apply a code action (quick fix, refactor).",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path" },
        line: { type: "number", description: "Line number" },
        character: { type: "number", description: "Character position" },
        action_title: { type: "string", description: "Title of the code action to apply" },
      },
      required: ["path", "line", "character", "action_title"],
    },
  },
  {
    name: "format_document",
    description: "Format a document using the configured formatter.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path to format" },
      },
      required: ["path"],
    },
  },

  // ============================================
  // GIT OPERATIONS (FULL)
  // ============================================
  {
    name: "get_git_status",
    description: "Get git status: branch, staged, modified, untracked files.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Optional directory path" },
      },
      required: [],
    },
  },
  {
    name: "git_diff",
    description: "Get git diff showing what has changed.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Optional path for specific file" },
        staged: { type: "boolean", description: "Show staged changes" },
        commit: { type: "string", description: "Compare against specific commit" },
      },
      required: [],
    },
  },
  {
    name: "git_log",
    description: "Get commit history.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Optional path for file history" },
        max_count: { type: "number", description: "Maximum commits to show (default 20)" },
        author: { type: "string", description: "Filter by author" },
        since: { type: "string", description: "Show commits since date" },
      },
      required: [],
    },
  },
  {
    name: "git_commit",
    description: "Commit staged changes.",
    input_schema: {
      type: "object" as const,
      properties: {
        message: { type: "string", description: "Commit message" },
        files: { type: "array", items: { type: "string" }, description: "Files to stage and commit" },
      },
      required: ["message"],
    },
  },
  {
    name: "git_push",
    description: "Push commits to remote.",
    input_schema: {
      type: "object" as const,
      properties: {
        remote: { type: "string", description: "Remote name (default: origin)" },
        branch: { type: "string", description: "Branch name (default: current)" },
        force: { type: "boolean", description: "Force push" },
      },
      required: [],
    },
  },
  {
    name: "git_pull",
    description: "Pull changes from remote.",
    input_schema: {
      type: "object" as const,
      properties: {
        remote: { type: "string", description: "Remote name (default: origin)" },
        branch: { type: "string", description: "Branch name (default: current)" },
        rebase: { type: "boolean", description: "Use rebase instead of merge" },
      },
      required: [],
    },
  },
  {
    name: "git_branch",
    description: "Create, list, or delete branches.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["create", "list", "delete"], description: "Branch action" },
        name: { type: "string", description: "Branch name (for create/delete)" },
      },
      required: ["action"],
    },
  },
  {
    name: "git_checkout",
    description: "Switch branches or restore files.",
    input_schema: {
      type: "object" as const,
      properties: {
        target: { type: "string", description: "Branch name or commit hash" },
        create: { type: "boolean", description: "Create new branch (-b)" },
        files: { type: "array", items: { type: "string" }, description: "Files to restore" },
      },
      required: ["target"],
    },
  },
  {
    name: "git_stash",
    description: "Stash or restore changes.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["push", "pop", "list", "drop"], description: "Stash action" },
        message: { type: "string", description: "Stash message (for push)" },
        index: { type: "number", description: "Stash index (for pop/drop)" },
      },
      required: ["action"],
    },
  },
  {
    name: "git_blame",
    description: "Show who last modified each line of a file.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path" },
        line_start: { type: "number", description: "Start line (optional)" },
        line_end: { type: "number", description: "End line (optional)" },
      },
      required: ["path"],
    },
  },
  {
    name: "git_add",
    description: "Stage files for commit.",
    input_schema: {
      type: "object" as const,
      properties: {
        files: { type: "array", items: { type: "string" }, description: "Files to stage" },
        all: { type: "boolean", description: "Stage all changes" },
      },
      required: [],
    },
  },
  {
    name: "git_reset",
    description: "Unstage files or reset to a commit.",
    input_schema: {
      type: "object" as const,
      properties: {
        files: { type: "array", items: { type: "string" }, description: "Files to unstage" },
        commit: { type: "string", description: "Commit to reset to" },
        mode: { type: "string", enum: ["soft", "mixed", "hard"], description: "Reset mode" },
      },
      required: [],
    },
  },
  {
    name: "apply_diff",
    description: "Apply a unified diff to a file.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path to apply diff to" },
        diff: { type: "string", description: "Unified diff content" },
      },
      required: ["path", "diff"],
    },
  },

  // ============================================
  // MEMORY OPERATIONS
  // ============================================
  {
    name: "update_memory",
    description: "Create, update, or delete a persistent memory for future sessions.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["create", "update", "delete"], description: "Action" },
        id: { type: "string", description: "Memory ID (required for update/delete)" },
        title: { type: "string", description: "Short title (required for create/update)" },
        content: { type: "string", description: "Content (required for create/update)" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
      },
      required: ["action"],
    },
  },
  {
    name: "search_memories",
    description: "Search stored memories.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_memories",
    description: "List all stored memories.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  // ============================================
  // WORKSPACE & CONTEXT
  // ============================================
  {
    name: "get_workspace_info",
    description: "Get workspace info: root path, open files, git status, structure.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_context",
    description: "Get full context: cursor position, selection, open files, recent edits, terminals.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_open_files",
    description: "Get list of currently open files with their state.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_selection",
    description: "Get the current text selection in the active editor.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  // ============================================
  // TASK MANAGEMENT
  // ============================================
  {
    name: "todo_write",
    description: "Create or update a task list for tracking multi-step work.",
    input_schema: {
      type: "object" as const,
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              content: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
            },
          },
          description: "Array of todo items",
        },
        merge: { type: "boolean", description: "Merge with existing or replace" },
      },
      required: ["todos"],
    },
  },

  // ============================================
  // BROWSER AUTOMATION
  // ============================================
  {
    name: "browser_navigate",
    description: "Navigate browser to a URL.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "URL to navigate to" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_snapshot",
    description: "Get accessibility tree snapshot of current page (better than screenshot for interaction).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "browser_click",
    description: "Click an element on the page.",
    input_schema: {
      type: "object" as const,
      properties: {
        element: { type: "string", description: "Element description" },
        ref: { type: "string", description: "Element reference from snapshot" },
      },
      required: ["element", "ref"],
    },
  },
  {
    name: "browser_type",
    description: "Type text into an element.",
    input_schema: {
      type: "object" as const,
      properties: {
        element: { type: "string", description: "Element description" },
        ref: { type: "string", description: "Element reference from snapshot" },
        text: { type: "string", description: "Text to type" },
        submit: { type: "boolean", description: "Press Enter after typing" },
      },
      required: ["element", "ref", "text"],
    },
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of the current page.",
    input_schema: {
      type: "object" as const,
      properties: {
        full_page: { type: "boolean", description: "Capture full scrollable page" },
        element: { type: "string", description: "Element to screenshot (optional)" },
      },
      required: [],
    },
  },
  {
    name: "browser_console",
    description: "Get browser console messages.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "browser_network",
    description: "Get network requests made by the page.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  // ============================================
  // MCP TOOLS
  // ============================================
  {
    name: "mcp_call",
    description: "Call a tool from an MCP server. Use mcp_list_tools first to see available tools.",
    input_schema: {
      type: "object" as const,
      properties: {
        server: { type: "string", description: "MCP server name" },
        tool: { type: "string", description: "Tool name" },
        arguments: { type: "object", description: "Tool arguments" },
      },
      required: ["server", "tool"],
    },
  },
  {
    name: "mcp_list_tools",
    description: "List all available tools from connected MCP servers.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  // ============================================
  // CHECKPOINTS
  // ============================================
  {
    name: "create_checkpoint",
    description: "Save current state as a checkpoint for potential rollback.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Checkpoint name" },
      },
      required: ["name"],
    },
  },
  {
    name: "restore_checkpoint",
    description: "Restore to a previous checkpoint.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Checkpoint ID to restore" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_checkpoints",
    description: "List all available checkpoints.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

export type ToolName = typeof tools[number]["name"];

export interface ToolInput {
  [key: string]: unknown;
}

