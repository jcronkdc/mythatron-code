/**
 * Terminal Manager - Advanced terminal with permissions, background jobs, monitoring
 * Mirrors Cursor's terminal capabilities
 */

import * as vscode from "vscode";
import { spawn, ChildProcess, exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";

const execAsync = promisify(exec);

export type TerminalPermission = "network" | "git_write" | "all";

export interface TerminalJob {
  id: string;
  command: string;
  cwd: string;
  pid?: number;
  startTime: Date;
  endTime?: Date;
  exitCode?: number;
  isBackground: boolean;
  output: string;
  error: string;
  status: "running" | "completed" | "failed" | "killed";
  permissions: TerminalPermission[];
}

export interface TerminalOptions {
  cwd?: string;
  timeout?: number;
  isBackground?: boolean;
  permissions?: TerminalPermission[];
  env?: Record<string, string>;
}

export class TerminalManager {
  private workspaceRoot: string;
  private jobs: Map<string, TerminalJob> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private terminalsDir: string;
  private jobCounter = 0;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot =
      workspaceRoot ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      process.cwd();
    
    // Create terminals tracking directory
    this.terminalsDir = path.join(this.workspaceRoot, ".mythatron", "terminals");
    this.ensureTerminalsDir();
  }

  private ensureTerminalsDir(): void {
    if (!fs.existsSync(this.terminalsDir)) {
      fs.mkdirSync(this.terminalsDir, { recursive: true });
    }
  }

  /**
   * Check if a command requires specific permissions
   */
  private analyzeCommandPermissions(command: string): TerminalPermission[] {
    const required: TerminalPermission[] = [];
    const cmd = command.toLowerCase();

    // Network permissions
    if (
      cmd.includes("curl") ||
      cmd.includes("wget") ||
      cmd.includes("npm install") ||
      cmd.includes("npm i ") ||
      cmd.includes("yarn add") ||
      cmd.includes("pnpm add") ||
      cmd.includes("pip install") ||
      cmd.includes("fetch") ||
      cmd.includes("http://") ||
      cmd.includes("https://")
    ) {
      required.push("network");
    }

    // Git write permissions
    if (
      cmd.includes("git commit") ||
      cmd.includes("git push") ||
      cmd.includes("git checkout") ||
      cmd.includes("git merge") ||
      cmd.includes("git rebase") ||
      cmd.includes("git reset") ||
      cmd.includes("git stash")
    ) {
      required.push("git_write");
    }

    return required;
  }

  /**
   * Check if command has required permissions
   */
  private checkPermissions(
    command: string,
    grantedPermissions: TerminalPermission[]
  ): { allowed: boolean; missing: TerminalPermission[] } {
    if (grantedPermissions.includes("all")) {
      return { allowed: true, missing: [] };
    }

    const required = this.analyzeCommandPermissions(command);
    const missing = required.filter((p) => !grantedPermissions.includes(p));

    return {
      allowed: missing.length === 0,
      missing,
    };
  }

  /**
   * Run a terminal command
   */
  async run(
    command: string,
    options: TerminalOptions = {}
  ): Promise<TerminalJob> {
    const jobId = `job-${++this.jobCounter}-${Date.now()}`;
    const cwd = options.cwd || this.workspaceRoot;
    const permissions = options.permissions || [];

    // Check permissions
    const permCheck = this.checkPermissions(command, permissions);
    if (!permCheck.allowed) {
      const job: TerminalJob = {
        id: jobId,
        command,
        cwd,
        startTime: new Date(),
        endTime: new Date(),
        isBackground: false,
        output: "",
        error: `Permission denied. Command requires: ${permCheck.missing.join(", ")}`,
        status: "failed",
        permissions,
      };
      return job;
    }

    const job: TerminalJob = {
      id: jobId,
      command,
      cwd,
      startTime: new Date(),
      isBackground: options.isBackground || false,
      output: "",
      error: "",
      status: "running",
      permissions,
    };

    this.jobs.set(jobId, job);
    this.writeTerminalFile(job);

    if (options.isBackground) {
      // Run in background
      this.runBackground(job, options);
      return job;
    } else {
      // Run and wait for completion
      return this.runForeground(job, options);
    }
  }

  private async runForeground(
    job: TerminalJob,
    options: TerminalOptions
  ): Promise<TerminalJob> {
    const timeout = options.timeout || 60000;

    try {
      const { stdout, stderr } = await execAsync(job.command, {
        cwd: job.cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, ...options.env },
      });

      job.output = stdout;
      job.error = stderr;
      job.exitCode = 0;
      job.status = "completed";
    } catch (error: any) {
      job.output = error.stdout || "";
      job.error = error.stderr || error.message;
      job.exitCode = error.code || 1;
      job.status = "failed";
    }

    job.endTime = new Date();
    this.writeTerminalFile(job);
    return job;
  }

  private runBackground(job: TerminalJob, options: TerminalOptions): void {
    const [cmd, ...args] = job.command.split(" ");

    const proc = spawn(cmd, args, {
      cwd: job.cwd,
      env: { ...process.env, ...options.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    job.pid = proc.pid;
    this.processes.set(job.id, proc);

    proc.stdout?.on("data", (data: Buffer) => {
      job.output += data.toString();
      this.writeTerminalFile(job);
    });

    proc.stderr?.on("data", (data: Buffer) => {
      job.error += data.toString();
      this.writeTerminalFile(job);
    });

    proc.on("close", (code) => {
      job.exitCode = code ?? undefined;
      job.endTime = new Date();
      job.status = code === 0 ? "completed" : "failed";
      this.processes.delete(job.id);
      this.writeTerminalFile(job);
    });

    proc.on("error", (error) => {
      job.error += `\nProcess error: ${error.message}`;
      job.status = "failed";
      job.endTime = new Date();
      this.processes.delete(job.id);
      this.writeTerminalFile(job);
    });

    // Unref to allow parent to exit
    proc.unref();
  }

  /**
   * Kill a background job
   */
  async kill(jobId: string): Promise<boolean> {
    const proc = this.processes.get(jobId);
    const job = this.jobs.get(jobId);

    if (proc) {
      proc.kill("SIGTERM");
      this.processes.delete(jobId);
    }

    if (job) {
      job.status = "killed";
      job.endTime = new Date();
      this.writeTerminalFile(job);
    }

    return !!proc || !!job;
  }

  /**
   * Get job status
   */
  getJob(jobId: string): TerminalJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all running jobs
   */
  getRunningJobs(): TerminalJob[] {
    return Array.from(this.jobs.values()).filter((j) => j.status === "running");
  }

  /**
   * Get recent jobs
   */
  getRecentJobs(count = 10): TerminalJob[] {
    return Array.from(this.jobs.values())
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, count);
  }

  /**
   * Write terminal state to file (for monitoring)
   */
  private writeTerminalFile(job: TerminalJob): void {
    const filePath = path.join(this.terminalsDir, `${job.id}.txt`);
    
    const content = `---
pid: ${job.pid || "N/A"}
cwd: ${job.cwd}
command: ${job.command}
status: ${job.status}
exit_code: ${job.exitCode ?? "N/A"}
start_time: ${job.startTime.toISOString()}
end_time: ${job.endTime?.toISOString() || "running"}
---
${job.output}
${job.error ? `\nSTDERR:\n${job.error}` : ""}`;

    try {
      fs.writeFileSync(filePath, content);
    } catch {
      // Ignore write errors
    }
  }

  /**
   * List terminal files
   */
  listTerminalFiles(): string[] {
    try {
      return fs.readdirSync(this.terminalsDir).filter((f) => f.endsWith(".txt"));
    } catch {
      return [];
    }
  }

  /**
   * Read terminal file
   */
  readTerminalFile(filename: string): string | null {
    try {
      return fs.readFileSync(path.join(this.terminalsDir, filename), "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Cleanup old terminal files
   */
  cleanup(maxAge = 24 * 60 * 60 * 1000): void {
    const files = this.listTerminalFiles();
    const now = Date.now();

    for (const file of files) {
      const filePath = path.join(this.terminalsDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Ignore errors
      }
    }
  }
}

// Singleton
let terminalManager: TerminalManager | null = null;

export function getTerminalManager(): TerminalManager {
  if (!terminalManager) {
    terminalManager = new TerminalManager();
  }
  return terminalManager;
}

