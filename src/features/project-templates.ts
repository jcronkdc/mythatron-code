/**
 * Project Templates - Scaffold new projects
 * Built-in and custom project templates
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  files: TemplateFile[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  postCreate?: string[]; // Commands to run after creation
}

export interface TemplateFile {
  path: string;
  content: string;
}

// Built-in templates
export const BUILTIN_TEMPLATES: ProjectTemplate[] = [
  {
    id: "typescript-lib",
    name: "TypeScript Library",
    description: "A modern TypeScript library with ESM/CJS support",
    category: "Library",
    files: [
      {
        path: "src/index.ts",
        content: `/**
 * {{name}}
 * {{description}}
 */

export function hello(name: string): string {
  return \`Hello, \${name}!\`;
}

export default { hello };
`,
      },
      {
        path: "tsconfig.json",
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
`,
      },
      {
        path: ".gitignore",
        content: `node_modules
dist
*.log
.DS_Store
`,
      },
    ],
    dependencies: {},
    devDependencies: {
      typescript: "^5.3.0",
      "@types/node": "^20.0.0",
    },
    scripts: {
      build: "tsc",
      dev: "tsc --watch",
    },
  },
  {
    id: "vite-react",
    name: "Vite + React + TypeScript",
    description: "Fast React app with Vite and TypeScript",
    category: "Frontend",
    files: [
      {
        path: "index.html",
        content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{name}}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      },
      {
        path: "src/main.tsx",
        content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`,
      },
      {
        path: "src/App.tsx",
        content: `import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="app">
      <h1>{{name}}</h1>
      <button onClick={() => setCount(c => c + 1)}>
        Count: {count}
      </button>
    </div>
  )
}

export default App
`,
      },
      {
        path: "src/index.css",
        content: `:root {
  font-family: system-ui, sans-serif;
  color-scheme: dark;
}

body {
  margin: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #1a1a2e;
  color: #eee;
}

.app {
  text-align: center;
}

button {
  padding: 12px 24px;
  font-size: 16px;
  border: none;
  border-radius: 8px;
  background: #6366f1;
  color: white;
  cursor: pointer;
  transition: background 0.2s;
}

button:hover {
  background: #4f46e5;
}
`,
      },
      {
        path: "vite.config.ts",
        content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`,
      },
      {
        path: "tsconfig.json",
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
`,
      },
    ],
    devDependencies: {
      vite: "^5.0.0",
      typescript: "^5.3.0",
      react: "^18.2.0",
      "react-dom": "^18.2.0",
      "@types/react": "^18.2.0",
      "@types/react-dom": "^18.2.0",
      "@vitejs/plugin-react": "^4.2.0",
    },
    scripts: {
      dev: "vite",
      build: "tsc && vite build",
      preview: "vite preview",
    },
    postCreate: ["npm install"],
  },
  {
    id: "express-api",
    name: "Express API",
    description: "REST API with Express and TypeScript",
    category: "Backend",
    files: [
      {
        path: "src/index.ts",
        content: `import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Hello from {{name}}!' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(\`Server running on port \${port}\`);
});
`,
      },
      {
        path: "tsconfig.json",
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
`,
      },
    ],
    dependencies: {
      express: "^4.18.0",
      cors: "^2.8.0",
    },
    devDependencies: {
      typescript: "^5.3.0",
      "@types/node": "^20.0.0",
      "@types/express": "^4.17.0",
      "@types/cors": "^2.8.0",
      "ts-node-dev": "^2.0.0",
    },
    scripts: {
      dev: "ts-node-dev --respawn src/index.ts",
      build: "tsc",
      start: "node dist/index.js",
    },
    postCreate: ["npm install"],
  },
  {
    id: "cli-tool",
    name: "CLI Tool",
    description: "Command-line tool with Commander.js",
    category: "CLI",
    files: [
      {
        path: "src/cli.ts",
        content: `#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('{{name}}')
  .description('{{description}}')
  .version('1.0.0');

program
  .command('hello')
  .description('Say hello')
  .argument('[name]', 'Name to greet', 'World')
  .action((name) => {
    console.log(\`Hello, \${name}!\`);
  });

program.parse();
`,
      },
      {
        path: "tsconfig.json",
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
`,
      },
    ],
    dependencies: {
      commander: "^11.0.0",
    },
    devDependencies: {
      typescript: "^5.3.0",
      "@types/node": "^20.0.0",
    },
    scripts: {
      build: "tsc",
      start: "node dist/cli.js",
    },
  },
];

/**
 * Create project from template
 */
export async function createProjectFromTemplate(
  template: ProjectTemplate,
  targetDir: string,
  variables: Record<string, string>
): Promise<void> {
  // Create directory
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Create files
  for (const file of template.files) {
    const filePath = path.join(targetDir, file.path);
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Replace variables
    let content = file.content;
    for (const [key, value] of Object.entries(variables)) {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }

    fs.writeFileSync(filePath, content);
  }

  // Create package.json
  const packageJson = {
    name: variables.name || "my-project",
    version: "1.0.0",
    description: variables.description || "",
    main: "dist/index.js",
    scripts: template.scripts || {},
    dependencies: template.dependencies || {},
    devDependencies: template.devDependencies || {},
  };

  fs.writeFileSync(
    path.join(targetDir, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // Create README
  const readme = `# ${variables.name || "My Project"}

${variables.description || ""}

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`
`;

  fs.writeFileSync(path.join(targetDir, "README.md"), readme);
}

/**
 * Show template picker
 */
export async function showTemplatePicker(): Promise<ProjectTemplate | undefined> {
  const items = BUILTIN_TEMPLATES.map((t) => ({
    label: t.name,
    description: t.category,
    detail: t.description,
    template: t,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a project template",
  });

  return selected?.template;
}

/**
 * Create new project with UI
 */
export async function createNewProject(): Promise<void> {
  const template = await showTemplatePicker();
  if (!template) return;

  const name = await vscode.window.showInputBox({
    prompt: "Project name",
    placeHolder: "my-project",
  });
  if (!name) return;

  const description = await vscode.window.showInputBox({
    prompt: "Project description (optional)",
    placeHolder: "A new project",
  });

  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select parent folder",
  });

  if (!folders || folders.length === 0) return;

  const targetDir = path.join(folders[0].fsPath, name);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Creating ${name}...`,
    },
    async () => {
      await createProjectFromTemplate(template, targetDir, {
        name,
        description: description || "",
      });
    }
  );

  // Open the new project
  const uri = vscode.Uri.file(targetDir);
  await vscode.commands.executeCommand("vscode.openFolder", uri);
}

