/**
 * Dual AI Agent System
 * 
 * Two AI agents working together for enhanced reasoning:
 * - Generator: Creates initial response
 * - Critic: Reviews, critiques, and refines
 * 
 * Modes:
 * - Sequential: Generator → Critic → Refined output
 * - Debate: Agents debate until consensus
 * - Ensemble: Both generate, best answer selected
 * - Chain-of-Thought: Deep reasoning with verification
 */

import * as vscode from "vscode";
import { getProviderManager } from "../providers";
import { Message, CompletionResponse, ToolDefinition } from "../providers/types";

export type DualAgentMode = "sequential" | "debate" | "ensemble" | "chain-of-thought";

export interface AgentConfig {
  name: string;
  role: "generator" | "critic" | "verifier" | "synthesizer";
  provider?: string; // anthropic, openai, groq, ollama
  model?: string;
  temperature?: number;
  systemPrompt?: string;
}

export interface DualAgentConfig {
  mode: DualAgentMode;
  agent1: AgentConfig;
  agent2: AgentConfig;
  maxIterations: number;
  consensusThreshold: number; // 0-1, how similar responses must be
  enableThinking: boolean;
  debugMode: boolean;
}

export interface DualAgentResult {
  finalResponse: string;
  thinking?: string;
  iterations: number;
  agent1Outputs: string[];
  agent2Outputs: string[];
  consensusReached: boolean;
  confidence: number;
  totalTokens: number;
  totalCost: number;
}

const DEFAULT_GENERATOR_PROMPT = `You are a Generator agent. Your role is to:
1. Analyze the user's request thoroughly
2. Generate a comprehensive, well-reasoned response
3. Show your reasoning step by step
4. Be creative but accurate

Focus on producing the best possible initial response.`;

const DEFAULT_CRITIC_PROMPT = `You are a Critic agent. Your role is to:
1. Carefully review the Generator's response
2. Identify any errors, gaps, or areas for improvement
3. Provide specific, actionable feedback
4. Suggest concrete improvements

Be constructive but thorough. If the response is good, acknowledge it.
Format your response as:
STRENGTHS: [list strengths]
WEAKNESSES: [list issues]
SUGGESTIONS: [specific improvements]
REVISED: [improved version if needed]`;

const DEFAULT_VERIFIER_PROMPT = `You are a Verifier agent. Your role is to:
1. Check the logical consistency of the response
2. Verify any facts or claims made
3. Ensure the response fully addresses the request
4. Rate confidence in the response (0-100%)

Format: VERIFIED: yes/no | CONFIDENCE: X% | ISSUES: [list any issues]`;

const DEFAULT_SYNTHESIZER_PROMPT = `You are a Synthesizer agent. Your role is to:
1. Combine multiple responses into one optimal answer
2. Take the best elements from each response
3. Resolve any contradictions
4. Produce a final, polished response

Your output should be the definitive answer incorporating all valuable insights.`;

export class DualAgentSystem {
  private config: DualAgentConfig;
  private outputChannel?: vscode.OutputChannel;
  private totalTokens: number = 0;
  private totalCost: number = 0;

  constructor(config?: Partial<DualAgentConfig>) {
    this.config = {
      mode: "sequential",
      agent1: {
        name: "Generator",
        role: "generator",
        systemPrompt: DEFAULT_GENERATOR_PROMPT,
        temperature: 0.7,
      },
      agent2: {
        name: "Critic",
        role: "critic",
        systemPrompt: DEFAULT_CRITIC_PROMPT,
        temperature: 0.3,
      },
      maxIterations: 3,
      consensusThreshold: 0.8,
      enableThinking: true,
      debugMode: false,
      ...config,
    };
  }

  /**
   * Set output channel for debug logging
   */
  setOutputChannel(channel: vscode.OutputChannel): void {
    this.outputChannel = channel;
  }

  /**
   * Log debug message
   */
  private log(message: string): void {
    if (this.config.debugMode && this.outputChannel) {
      this.outputChannel.appendLine(`[DualAgent] ${message}`);
    }
  }

  /**
   * Execute dual agent reasoning
   */
  async execute(
    query: string,
    context?: string,
    tools?: ToolDefinition[]
  ): Promise<DualAgentResult> {
    this.totalTokens = 0;
    this.totalCost = 0;

    switch (this.config.mode) {
      case "sequential":
        return this.executeSequential(query, context, tools);
      case "debate":
        return this.executeDebate(query, context, tools);
      case "ensemble":
        return this.executeEnsemble(query, context, tools);
      case "chain-of-thought":
        return this.executeChainOfThought(query, context, tools);
      default:
        return this.executeSequential(query, context, tools);
    }
  }

  /**
   * Sequential mode: Generator → Critic → Refined
   */
  private async executeSequential(
    query: string,
    context?: string,
    tools?: ToolDefinition[]
  ): Promise<DualAgentResult> {
    const agent1Outputs: string[] = [];
    const agent2Outputs: string[] = [];
    let currentResponse = "";
    let thinking = "";

    this.log("Starting Sequential mode");

    // Step 1: Generator creates initial response
    this.log("Agent 1 (Generator) processing...");
    const generatorResponse = await this.callAgent(
      this.config.agent1,
      [
        { role: "system", content: this.config.agent1.systemPrompt || DEFAULT_GENERATOR_PROMPT },
        { role: "user", content: context ? `Context:\n${context}\n\nQuery: ${query}` : query },
      ],
      tools
    );
    currentResponse = generatorResponse.content;
    agent1Outputs.push(currentResponse);
    thinking += `## Generator Output\n${currentResponse}\n\n`;
    this.log(`Generator output: ${currentResponse.slice(0, 200)}...`);

    // Step 2: Critic reviews and suggests improvements
    this.log("Agent 2 (Critic) reviewing...");
    const criticResponse = await this.callAgent(
      this.config.agent2,
      [
        { role: "system", content: this.config.agent2.systemPrompt || DEFAULT_CRITIC_PROMPT },
        { role: "user", content: `Original query: ${query}\n\nResponse to review:\n${currentResponse}` },
      ]
    );
    agent2Outputs.push(criticResponse.content);
    thinking += `## Critic Feedback\n${criticResponse.content}\n\n`;
    this.log(`Critic output: ${criticResponse.content.slice(0, 200)}...`);

    // Step 3: Generator refines based on feedback
    this.log("Agent 1 refining based on feedback...");
    const refinedResponse = await this.callAgent(
      this.config.agent1,
      [
        { role: "system", content: this.config.agent1.systemPrompt || DEFAULT_GENERATOR_PROMPT },
        { role: "user", content: query },
        { role: "assistant", content: currentResponse },
        { role: "user", content: `Please refine your response based on this feedback:\n${criticResponse.content}` },
      ],
      tools
    );
    agent1Outputs.push(refinedResponse.content);
    thinking += `## Refined Response\n${refinedResponse.content}\n\n`;

    return {
      finalResponse: refinedResponse.content,
      thinking: this.config.enableThinking ? thinking : undefined,
      iterations: 1,
      agent1Outputs,
      agent2Outputs,
      consensusReached: true,
      confidence: this.extractConfidence(criticResponse.content),
      totalTokens: this.totalTokens,
      totalCost: this.totalCost,
    };
  }

  /**
   * Debate mode: Agents debate until consensus
   */
  private async executeDebate(
    query: string,
    context?: string,
    tools?: ToolDefinition[]
  ): Promise<DualAgentResult> {
    const agent1Outputs: string[] = [];
    const agent2Outputs: string[] = [];
    let thinking = "";
    let consensusReached = false;
    let iterations = 0;

    this.log("Starting Debate mode");

    // Initial positions
    const agent1Initial = await this.callAgent(
      { ...this.config.agent1, systemPrompt: `You are debating agent. Take a clear position and defend it with reasoning. ${this.config.agent1.systemPrompt || ""}` },
      [{ role: "user", content: context ? `${context}\n\n${query}` : query }],
      tools
    );
    agent1Outputs.push(agent1Initial.content);
    thinking += `## Round 1 - Agent 1\n${agent1Initial.content}\n\n`;

    const agent2Initial = await this.callAgent(
      { ...this.config.agent2, systemPrompt: `You are debating agent. Consider the other perspective and provide your analysis. ${this.config.agent2.systemPrompt || ""}` },
      [
        { role: "user", content: query },
        { role: "assistant", content: `Other agent says: ${agent1Initial.content}` },
        { role: "user", content: "What is your perspective? Do you agree or disagree? Why?" },
      ],
      tools
    );
    agent2Outputs.push(agent2Initial.content);
    thinking += `## Round 1 - Agent 2\n${agent2Initial.content}\n\n`;
    iterations++;

    // Debate rounds
    let lastAgent1 = agent1Initial.content;
    let lastAgent2 = agent2Initial.content;

    while (!consensusReached && iterations < this.config.maxIterations) {
      this.log(`Debate round ${iterations + 1}`);

      // Agent 1 responds to Agent 2
      const agent1Response = await this.callAgent(
        this.config.agent1,
        [
          { role: "user", content: query },
          { role: "assistant", content: lastAgent1 },
          { role: "user", content: `The other agent responds: ${lastAgent2}\n\nDo you want to update your position? Have you reached agreement?` },
        ]
      );
      agent1Outputs.push(agent1Response.content);
      thinking += `## Round ${iterations + 1} - Agent 1\n${agent1Response.content}\n\n`;
      lastAgent1 = agent1Response.content;

      // Agent 2 responds to Agent 1
      const agent2Response = await this.callAgent(
        this.config.agent2,
        [
          { role: "user", content: query },
          { role: "assistant", content: lastAgent2 },
          { role: "user", content: `The other agent responds: ${lastAgent1}\n\nDo you want to update your position? Have you reached agreement?` },
        ]
      );
      agent2Outputs.push(agent2Response.content);
      thinking += `## Round ${iterations + 1} - Agent 2\n${agent2Response.content}\n\n`;
      lastAgent2 = agent2Response.content;

      iterations++;

      // Check for consensus
      consensusReached = this.checkConsensus(lastAgent1, lastAgent2);
      this.log(`Consensus check: ${consensusReached}`);
    }

    // Synthesize final answer
    const synthesizer = await this.callAgent(
      { name: "Synthesizer", role: "synthesizer", systemPrompt: DEFAULT_SYNTHESIZER_PROMPT },
      [
        { role: "user", content: `Query: ${query}\n\nAgent 1's final position: ${lastAgent1}\n\nAgent 2's final position: ${lastAgent2}\n\nSynthesize the best answer from both perspectives.` },
      ]
    );
    thinking += `## Synthesis\n${synthesizer.content}\n\n`;

    return {
      finalResponse: synthesizer.content,
      thinking: this.config.enableThinking ? thinking : undefined,
      iterations,
      agent1Outputs,
      agent2Outputs,
      consensusReached,
      confidence: consensusReached ? 0.9 : 0.7,
      totalTokens: this.totalTokens,
      totalCost: this.totalCost,
    };
  }

  /**
   * Ensemble mode: Both generate, best selected
   */
  private async executeEnsemble(
    query: string,
    context?: string,
    tools?: ToolDefinition[]
  ): Promise<DualAgentResult> {
    this.log("Starting Ensemble mode");
    let thinking = "";

    // Both agents generate responses in parallel
    const [response1, response2] = await Promise.all([
      this.callAgent(
        this.config.agent1,
        [
          { role: "system", content: this.config.agent1.systemPrompt || "Generate the best possible response." },
          { role: "user", content: context ? `${context}\n\n${query}` : query },
        ],
        tools
      ),
      this.callAgent(
        this.config.agent2,
        [
          { role: "system", content: this.config.agent2.systemPrompt || "Generate the best possible response." },
          { role: "user", content: context ? `${context}\n\n${query}` : query },
        ],
        tools
      ),
    ]);

    thinking += `## Agent 1 Response\n${response1.content}\n\n`;
    thinking += `## Agent 2 Response\n${response2.content}\n\n`;

    // Use a judge to select the best
    const judge = await this.callAgent(
      { name: "Judge", role: "critic", systemPrompt: "You are a fair judge. Compare two responses and select the better one. Explain your reasoning briefly, then output WINNER: 1 or WINNER: 2" },
      [
        { role: "user", content: `Query: ${query}\n\nResponse 1:\n${response1.content}\n\nResponse 2:\n${response2.content}\n\nWhich response is better and why?` },
      ]
    );

    thinking += `## Judge Decision\n${judge.content}\n\n`;

    const winner = judge.content.includes("WINNER: 2") ? response2.content : response1.content;

    return {
      finalResponse: winner,
      thinking: this.config.enableThinking ? thinking : undefined,
      iterations: 1,
      agent1Outputs: [response1.content],
      agent2Outputs: [response2.content],
      consensusReached: true,
      confidence: 0.85,
      totalTokens: this.totalTokens,
      totalCost: this.totalCost,
    };
  }

  /**
   * Chain-of-Thought mode: Deep reasoning with verification
   */
  private async executeChainOfThought(
    query: string,
    context?: string,
    tools?: ToolDefinition[]
  ): Promise<DualAgentResult> {
    this.log("Starting Chain-of-Thought mode");
    let thinking = "";
    const agent1Outputs: string[] = [];
    const agent2Outputs: string[] = [];

    // Step 1: Break down the problem
    const breakdown = await this.callAgent(
      this.config.agent1,
      [
        { role: "system", content: "Break down complex problems into steps. Think carefully about what needs to be done." },
        { role: "user", content: `Let's solve this step by step.\n\nProblem: ${query}\n${context ? `\nContext: ${context}` : ""}\n\nFirst, break this down into smaller steps. What do we need to figure out?` },
      ]
    );
    agent1Outputs.push(breakdown.content);
    thinking += `## Step 1: Problem Breakdown\n${breakdown.content}\n\n`;

    // Step 2: Solve each step
    const solution = await this.callAgent(
      this.config.agent1,
      [
        { role: "system", content: "Solve problems methodically, showing your reasoning at each step." },
        { role: "user", content: query },
        { role: "assistant", content: breakdown.content },
        { role: "user", content: "Now solve each step you identified. Show your work and reasoning clearly." },
      ],
      tools
    );
    agent1Outputs.push(solution.content);
    thinking += `## Step 2: Solution\n${solution.content}\n\n`;

    // Step 3: Verify the solution
    const verification = await this.callAgent(
      { ...this.config.agent2, systemPrompt: DEFAULT_VERIFIER_PROMPT },
      [
        { role: "user", content: `Original problem: ${query}\n\nProposed solution:\n${solution.content}\n\nVerify this solution. Check the logic, look for errors, and rate your confidence.` },
      ]
    );
    agent2Outputs.push(verification.content);
    thinking += `## Step 3: Verification\n${verification.content}\n\n`;

    // Step 4: If issues found, refine
    let finalResponse = solution.content;
    if (verification.content.toLowerCase().includes("verified: no") || 
        verification.content.toLowerCase().includes("issues:")) {
      const refined = await this.callAgent(
        this.config.agent1,
        [
          { role: "user", content: query },
          { role: "assistant", content: solution.content },
          { role: "user", content: `The verifier found issues:\n${verification.content}\n\nPlease fix these issues and provide a corrected solution.` },
        ],
        tools
      );
      agent1Outputs.push(refined.content);
      thinking += `## Step 4: Refined Solution\n${refined.content}\n\n`;
      finalResponse = refined.content;
    }

    return {
      finalResponse,
      thinking: this.config.enableThinking ? thinking : undefined,
      iterations: agent1Outputs.length,
      agent1Outputs,
      agent2Outputs,
      consensusReached: !verification.content.toLowerCase().includes("verified: no"),
      confidence: this.extractConfidence(verification.content),
      totalTokens: this.totalTokens,
      totalCost: this.totalCost,
    };
  }

  /**
   * Call an agent with messages
   */
  private async callAgent(
    agent: AgentConfig,
    messages: Message[],
    tools?: ToolDefinition[]
  ): Promise<CompletionResponse> {
    const provider = getProviderManager();

    // Use agent-specific model if configured, otherwise use default
    const response = await provider.complete({
      messages,
      tools,
      temperature: agent.temperature,
    });

    // Track tokens and cost
    if (response.usage) {
      this.totalTokens += response.usage.inputTokens + response.usage.outputTokens;
      // Estimate cost (rough approximation based on model)
      const inputCost = (response.usage.inputTokens / 1_000_000) * 3; // ~$3/M input
      const outputCost = (response.usage.outputTokens / 1_000_000) * 15; // ~$15/M output
      this.totalCost += inputCost + outputCost;
    }

    return response;
  }

  /**
   * Check if two responses have reached consensus
   */
  private checkConsensus(response1: string, response2: string): boolean {
    // Simple similarity check - can be enhanced with embeddings
    const words1 = new Set(response1.toLowerCase().split(/\s+/));
    const words2 = new Set(response2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    const similarity = intersection.size / union.size;

    // Also check for agreement keywords
    const agreementKeywords = ["agree", "correct", "yes", "right", "consensus", "same"];
    const hasAgreement = agreementKeywords.some(
      (kw) => response1.toLowerCase().includes(kw) && response2.toLowerCase().includes(kw)
    );

    return similarity >= this.config.consensusThreshold || hasAgreement;
  }

  /**
   * Extract confidence score from response
   */
  private extractConfidence(response: string): number {
    const match = response.match(/confidence:\s*(\d+)%?/i);
    if (match) {
      return parseInt(match[1], 10) / 100;
    }
    return 0.75; // Default confidence
  }

  /**
   * Configure the dual agent system
   */
  configure(config: Partial<DualAgentConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): DualAgentConfig {
    return { ...this.config };
  }

  /**
   * Get usage statistics
   */
  getUsage(): { tokens: number; cost: number } {
    return {
      tokens: this.totalTokens,
      cost: this.totalCost,
    };
  }
}

// Preset configurations
export const DUAL_AGENT_PRESETS = {
  // Code review: Generator writes, Critic reviews
  codeReview: {
    mode: "sequential" as DualAgentMode,
    agent1: {
      name: "Coder",
      role: "generator" as const,
      systemPrompt: "You are an expert programmer. Write clean, efficient, well-documented code.",
      temperature: 0.5,
    },
    agent2: {
      name: "Reviewer",
      role: "critic" as const,
      systemPrompt: "You are a senior code reviewer. Check for bugs, security issues, performance problems, and style. Be thorough but constructive.",
      temperature: 0.2,
    },
    maxIterations: 2,
    consensusThreshold: 0.8,
    enableThinking: true,
    debugMode: false,
  },

  // Problem solving: Deep reasoning with verification
  problemSolving: {
    mode: "chain-of-thought" as DualAgentMode,
    agent1: {
      name: "Reasoner",
      role: "generator" as const,
      systemPrompt: "You are a logical problem solver. Break down problems, think step by step, and show your reasoning.",
      temperature: 0.3,
    },
    agent2: {
      name: "Verifier",
      role: "verifier" as const,
      systemPrompt: DEFAULT_VERIFIER_PROMPT,
      temperature: 0.1,
    },
    maxIterations: 3,
    consensusThreshold: 0.9,
    enableThinking: true,
    debugMode: false,
  },

  // Creative: Generate multiple options
  creative: {
    mode: "ensemble" as DualAgentMode,
    agent1: {
      name: "Creative1",
      role: "generator" as const,
      systemPrompt: "You are highly creative. Think outside the box and generate innovative solutions.",
      temperature: 0.9,
    },
    agent2: {
      name: "Creative2",
      role: "generator" as const,
      systemPrompt: "You are creative but practical. Generate solutions that are both innovative and feasible.",
      temperature: 0.7,
    },
    maxIterations: 1,
    consensusThreshold: 0.5,
    enableThinking: true,
    debugMode: false,
  },

  // Debate: Multiple perspectives
  debate: {
    mode: "debate" as DualAgentMode,
    agent1: {
      name: "Advocate",
      role: "generator" as const,
      systemPrompt: "You advocate for the proposed approach. Highlight benefits and address concerns.",
      temperature: 0.6,
    },
    agent2: {
      name: "Skeptic",
      role: "critic" as const,
      systemPrompt: "You are a healthy skeptic. Question assumptions, identify risks, and suggest alternatives.",
      temperature: 0.4,
    },
    maxIterations: 3,
    consensusThreshold: 0.7,
    enableThinking: true,
    debugMode: false,
  },
};

// Singleton instance
let instance: DualAgentSystem | null = null;

export function getDualAgentSystem(config?: Partial<DualAgentConfig>): DualAgentSystem {
  if (!instance) {
    instance = new DualAgentSystem(config);
  } else if (config) {
    instance.configure(config);
  }
  return instance;
}

