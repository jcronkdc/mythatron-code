# MythaTron Code v1.0

**Build faster. Spend less. Own your tools.**

🌐 **[mythatron.com](https://mythatron.com)**

## Overview

MythaTron Code is a VS Code extension that provides complete AI coding capabilities with **smart cost routing to reduce your LLM spending by 70%+**.

Unlike other AI coding tools that are designed to maximize your API consumption, MythaTron is built with **YOUR efficiency in mind** - minimizing tokens, caching responses, and routing to the cheapest capable model.

## Features

### Core AI Capabilities
- **Extended Thinking** - Deep reasoning with `<thinking>` blocks for complex problems
- **Vision Support** - Read and understand images (screenshots, diagrams, mockups)
- **Agent Loop** - Autonomous multi-step task execution with up to 25 iterations
- **Tool Use** - 25+ built-in tools for file operations, search, terminal, git, and more
- **Context Awareness** - Tracks cursor position, selections, open files, recent edits

### Smart Cost Optimization
- **Multi-Provider Routing** - Routes simple tasks to cheaper models automatically
- **Response Caching** - Avoids redundant API calls for similar queries
- **Token Tracking** - Real-time cost monitoring in the status bar
- **Local Models** - Full Ollama support for FREE local inference

### Code Intelligence
- **Semantic Search** - Find code by meaning, not just text
- **Web Search** - Real-time internet search
- **Go to Definition** - Navigate to symbol definitions
- **Find References** - Find all usages of a symbol
- **Diagnostics** - View TypeScript/ESLint errors

### MCP (Model Context Protocol)
- **Per-Project Servers** - Configure custom tool servers per project
- **Browser Automation** - Playwright MCP for web testing
- **GitHub Integration** - PR, issues, and code review tools
- **Database Access** - Query databases directly

### Memory & Persistence
- **Persistent Memory** - Remembers information across sessions
- **Project Rules** - Configure AI behavior per-project
- **Conversation History** - Full chat history preservation

### Developer Experience
- **Inline Completions** - Tab autocomplete (optional)
- **Diff Preview** - Review changes before applying
- **Notebook Support** - Edit Jupyter notebooks
- **Background Jobs** - Run long processes in background

## Installation

### From VSIX
```bash
code --install-extension mythatron-code-2.0.0.vsix
```

### From Source
```bash
git clone https://github.com/yourusername/mythatron-code
cd mythatron-code
npm install
npm run package
code --install-extension mythatron-code-2.0.0.vsix
```

## Configuration

### Required Settings
```json
{
  "mythaTron.apiKey": "sk-ant-xxx"  // Your Anthropic API key
}
```

### Optional Cost Optimization
```json
{
  "mythaTron.enableSmartRouting": true,       // Route simple tasks to cheaper models
  "mythaTron.openaiApiKey": "sk-xxx",         // GPT-4o-mini for medium tasks
  "mythaTron.groqApiKey": "gsk_xxx",          // Llama for fast simple tasks
  "mythaTron.ollamaUrl": "http://localhost:11434",  // Local models (FREE)
  "mythaTron.ollamaModel": "qwen2.5-coder",   // Fast local coding model
  "mythaTron.enableCaching": true             // Cache similar queries
}
```

### MCP Configuration
Create `.mythatron/mcp.json` in your project:
```json
{
  "servers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${env:GITHUB_TOKEN}"
      }
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-playwright"]
    }
  }
}
```

### Project Rules
Create `.mythatron/rules.json`:
```json
{
  "rules": [
    "Always use TypeScript strict mode",
    "Prefer functional components over class components",
    "Use Tailwind CSS for styling"
  ]
}
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+M` | Open MythaTron Code |
| `Cmd+Shift+N` | New Chat |
| `Cmd+Shift+L` | Send Selection to Chat |
| `Cmd+Shift+I` | Auto-fix Imports |
| `Cmd+Shift+G` | Generate Commit Message |

## Cost Comparison

| Provider | Model | Cost/1M tokens (in/out) | Best For |
|----------|-------|-------------------------|----------|
| Ollama | qwen2.5-coder | **FREE** | Simple tasks |
| Groq | llama-3.1-8b | $0.05 / $0.08 | Fast simple tasks |
| OpenAI | gpt-4o-mini | $0.15 / $0.60 | Medium tasks |
| Anthropic | claude-3.5-haiku | $0.80 / $4.00 | Quick complex tasks |
| Anthropic | claude-sonnet-4 | $3.00 / $15.00 | Complex coding |
| Anthropic | claude-opus-4 | $15.00 / $75.00 | Architecture decisions |

**Smart routing typically reduces costs by 70%+** by automatically selecting the most cost-effective model for each task.

## Setting Up Ollama (Free Local Models)

1. Install Ollama: https://ollama.ai
2. Pull a coding model:
   ```bash
   ollama pull qwen2.5-coder:7b
   # or
   ollama pull codellama:13b
   ```
3. Ollama runs automatically on localhost:11434

## Tools Available

### File Operations
- `read_file` - Read files (supports images)
- `write_file` - Create/overwrite files
- `edit_file` - Targeted string replacement
- `list_directory` - List directory contents
- `delete_file` - Delete files/directories
- `rename_file` - Move/rename files
- `edit_notebook` - Edit Jupyter notebooks

### Search
- `codebase_search` - Semantic code search
- `grep` - Regex pattern search
- `search_files` - Find files by name
- `web_search` - Internet search

### Terminal
- `run_terminal_command` - Execute commands
- `list_running_jobs` - List background jobs
- `kill_job` - Kill a background job

### Code Intelligence
- `get_diagnostics` - Get linter errors
- `get_definition` - Go to definition
- `get_references` - Find references
- `get_hover_info` - Get type info

### Git
- `get_git_status` - Repository status
- `git_diff` - Show changes
- `apply_diff` - Apply unified diff

### Memory
- `update_memory` - Create/update/delete memories
- `search_memories` - Search stored memories

### MCP
- `mcp_call` - Call MCP server tools
- `mcp_list_tools` - List available MCP tools

## Architecture

```
src/
├── agent/           # Core AI agent logic
├── features/        # Extended capabilities
│   ├── thinking.ts  # Extended thinking mode
│   ├── vision.ts    # Image support
│   ├── notebooks.ts # Jupyter support
│   ├── context.ts   # Context tracking
│   ├── completions.ts # Inline completions
│   ├── diff-preview.ts # Diff viewer
│   └── agent-loop.ts # Multi-step execution
├── providers/       # LLM providers
│   ├── anthropic-provider.ts
│   ├── openai-provider.ts
│   ├── groq-provider.ts
│   ├── ollama-provider.ts
│   ├── provider-manager.ts  # Smart routing
│   └── task-classifier.ts   # Complexity detection
├── mcp/             # Model Context Protocol
├── memory/          # Persistent memory
├── search/          # Code & web search
├── terminal/        # Terminal management
├── tools/           # Tool definitions & executor
└── extension.ts     # VS Code entry point
```

## License

MIT License - Use freely, attribution appreciated.

## Contributing

PRs welcome! Areas of interest:
- Additional MCP server integrations
- Improved semantic search (embeddings)
- More language-specific code intelligence
- UI improvements

