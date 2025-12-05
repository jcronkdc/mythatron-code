/**
 * Ollama Provider - Local models (FREE!)
 * Great for: Privacy-sensitive work, offline, unlimited usage
 * Models: Llama 3.2, CodeLlama, DeepSeek Coder, Qwen 2.5 Coder, Mistral
 */

import type {
  LLMProvider,
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ToolCall,
} from "./types";

export class OllamaProvider implements LLMProvider {
  readonly type = "ollama" as const;
  readonly model: string;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    this.model = config.model;
    this.baseUrl = config.baseUrl || "http://localhost:11434";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
      });
      if (!response.ok) return false;
      
      const data = await response.json() as { models?: Array<{ name: string }> };
      // Check if the model is installed
      const models = data.models || [];
      return models.some((m) => 
        m.name === this.model || m.name.startsWith(`${this.model}:`)
      );
    } catch {
      return false;
    }
  }

  // Ollama is FREE - runs locally
  estimateCost(_inputTokens: number, _outputTokens: number): number {
    return 0;
  }

  private convertToolsToPrompt(tools?: CompletionRequest["tools"]): string {
    if (!tools || tools.length === 0) return "";

    const toolDescriptions = tools.map((tool) => {
      const params = Object.entries(tool.input_schema.properties || {})
        .map(([name, schema]: [string, any]) => {
          const required = tool.input_schema.required?.includes(name)
            ? " (required)"
            : "";
          return `  - ${name}${required}: ${schema.description || schema.type}`;
        })
        .join("\n");

      return `### ${tool.name}\n${tool.description}\nParameters:\n${params}`;
    });

    return `\n\nYou have access to the following tools. To use a tool, respond with a JSON object in this exact format:
\`\`\`json
{"tool": "tool_name", "input": {"param1": "value1"}}
\`\`\`

Available tools:
${toolDescriptions.join("\n\n")}

After receiving a tool result, continue your response. Only use tools when necessary.`;
  }

  private parseToolCalls(content: string): { cleanContent: string; toolCalls: ToolCall[] } {
    const toolCalls: ToolCall[] = [];
    let cleanContent = content;

    // Look for JSON tool calls in code blocks
    const jsonBlockRegex = /```(?:json)?\s*\n?\{[\s\S]*?"tool"[\s\S]*?\}\s*\n?```/g;
    const matches = content.match(jsonBlockRegex) || [];

    for (const match of matches) {
      try {
        const jsonStr = match.replace(/```(?:json)?\s*\n?/g, "").replace(/\s*```/g, "");
        const parsed = JSON.parse(jsonStr);
        
        if (parsed.tool && typeof parsed.tool === "string") {
          toolCalls.push({
            id: `ollama-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name: parsed.tool,
            input: parsed.input || {},
          });
          cleanContent = cleanContent.replace(match, "");
        }
      } catch {
        // Not a valid tool call
      }
    }

    return { cleanContent: cleanContent.trim(), toolCalls };
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    // Build messages with tool instructions
    const toolPrompt = this.convertToolsToPrompt(request.tools);
    const messages = request.messages.map((m) => {
      if (m.role === "system" && toolPrompt) {
        return { ...m, content: m.content + toolPrompt };
      }
      return m;
    });

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: {
          temperature: request.temperature ?? 0,
          num_predict: request.maxTokens || 8192,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama error: ${error}`);
    }

    const data = await response.json() as {
      message?: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const rawContent = data.message?.content || "";

    // Parse any tool calls from the response
    const { cleanContent, toolCalls } = this.parseToolCalls(rawContent);

    return {
      content: cleanContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: data.prompt_eval_count || 0,
        outputTokens: data.eval_count || 0,
      },
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
      model: this.model,
      provider: "ollama",
    };
  }

  async stream(
    request: CompletionRequest,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<CompletionResponse> {
    // Build messages with tool instructions
    const toolPrompt = this.convertToolsToPrompt(request.tools);
    const messages = request.messages.map((m) => {
      if (m.role === "system" && toolPrompt) {
        return { ...m, content: m.content + toolPrompt };
      }
      return m;
    });

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        options: {
          temperature: request.temperature ?? 0,
          num_predict: request.maxTokens || 8192,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama error: ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let content = "";
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);

          if (parsed.message?.content) {
            content += parsed.message.content;
            onChunk({ type: "text", text: parsed.message.content });
          }

          if (parsed.done) {
            inputTokens = parsed.prompt_eval_count || 0;
            outputTokens = parsed.eval_count || 0;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    // Parse any tool calls from the complete response
    const { cleanContent, toolCalls } = this.parseToolCalls(content);

    // Emit tool calls if found
    for (const toolCall of toolCalls) {
      onChunk({ type: "tool_use", toolCall });
    }

    onChunk({ type: "done" });

    return {
      content: cleanContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: { inputTokens, outputTokens },
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
      model: this.model,
      provider: "ollama",
    };
  }
}

