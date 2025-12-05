/**
 * Provider Types - Unified interface for all LLM providers
 * Supports: Ollama (local), OpenAI, Groq, Anthropic
 */

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface StreamChunk {
  type: "text" | "tool_use" | "done";
  text?: string;
  toolCall?: ToolCall;
}

export interface CompletionRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface CompletionResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason?: "end_turn" | "tool_use" | "max_tokens";
  model: string;
  provider: ProviderType;
}

export type ProviderType = "anthropic" | "openai" | "groq" | "ollama";

export interface ProviderConfig {
  type: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMProvider {
  readonly type: ProviderType;
  readonly model: string;
  
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  
  stream(
    request: CompletionRequest,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<CompletionResponse>;
  
  isAvailable(): Promise<boolean>;
  
  estimateCost(inputTokens: number, outputTokens: number): number;
}

// Model pricing per million tokens (input/output)
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  
  // Groq (fast & cheap)
  "llama-3.1-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  "mixtral-8x7b-32768": { input: 0.24, output: 0.24 },
  
  // Ollama (local - FREE)
  "llama3.2": { input: 0, output: 0 },
  "codellama": { input: 0, output: 0 },
  "deepseek-coder-v2": { input: 0, output: 0 },
  "qwen2.5-coder": { input: 0, output: 0 },
  "mistral": { input: 0, output: 0 },
};

// Task complexity levels for routing
export type TaskComplexity = "simple" | "medium" | "complex";

// Task categories for classification
export type TaskCategory = 
  | "explain" 
  | "autocomplete"
  | "refactor"
  | "generate_tests"
  | "fix_error"
  | "chat"
  | "multi_file_edit"
  | "architecture"
  | "debug_complex";

