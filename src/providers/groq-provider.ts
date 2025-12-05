/**
 * Groq Provider - Ultra-fast inference
 * Great for: Quick responses, simple tasks
 * Models: Llama 3.1 70B, Llama 3.1 8B, Mixtral
 */

import type {
  LLMProvider,
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ToolCall,
} from "./types";

export class GroqProvider implements LLMProvider {
  readonly type = "groq" as const;
  readonly model: string;
  private apiKey: string;
  private baseUrl = "https://api.groq.com/openai/v1";
  private pricing: { input: number; output: number };

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new Error("Groq API key required");
    }

    this.model = config.model;
    this.apiKey = config.apiKey;

    // Get pricing
    const { MODEL_PRICING } = require("./types");
    this.pricing = MODEL_PRICING[this.model] || { input: 0.59, output: 0.79 };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    return (
      (inputTokens * this.pricing.input + outputTokens * this.pricing.output) /
      1_000_000
    );
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const tools = request.tools?.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
        max_tokens: request.maxTokens || 8192,
        temperature: request.temperature ?? 0,
        tools: tools && tools.length > 0 ? tools : undefined,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: { content: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
        finish_reason: string;
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const message = data.choices[0].message;

    const toolCalls: ToolCall[] | undefined = message.tool_calls?.map(
      (tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      })
    );

    return {
      content: message.content || "",
      toolCalls,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
          }
        : undefined,
      stopReason:
        data.choices[0].finish_reason === "tool_calls"
          ? "tool_use"
          : data.choices[0].finish_reason === "length"
          ? "max_tokens"
          : "end_turn",
      model: this.model,
      provider: "groq",
    };
  }

  async stream(
    request: CompletionRequest,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<CompletionResponse> {
    const tools = request.tools?.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
        max_tokens: request.maxTokens || 8192,
        temperature: request.temperature ?? 0,
        tools: tools && tools.length > 0 ? tools : undefined,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let content = "";
    const toolCalls: ToolCall[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: "end_turn" | "tool_use" | "max_tokens" = "end_turn";

    const partialToolCalls: Map<
      number,
      { id: string; name: string; arguments: string }
    > = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

            if (delta?.content) {
              content += delta.content;
              onChunk({ type: "text", text: delta.content });
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (!partialToolCalls.has(idx)) {
                  partialToolCalls.set(idx, {
                    id: tc.id || "",
                    name: tc.function?.name || "",
                    arguments: "",
                  });
                }
                const partial = partialToolCalls.get(idx)!;
                if (tc.id) partial.id = tc.id;
                if (tc.function?.name) partial.name = tc.function.name;
                if (tc.function?.arguments)
                  partial.arguments += tc.function.arguments;
              }
            }

            if (parsed.choices?.[0]?.finish_reason) {
              const reason = parsed.choices[0].finish_reason;
              stopReason =
                reason === "tool_calls"
                  ? "tool_use"
                  : reason === "length"
                  ? "max_tokens"
                  : "end_turn";
            }

            // Groq includes usage in the final chunk
            if (parsed.x_groq?.usage) {
              inputTokens = parsed.x_groq.usage.prompt_tokens;
              outputTokens = parsed.x_groq.usage.completion_tokens;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }

    // Finalize tool calls
    for (const [, partial] of partialToolCalls) {
      try {
        const toolCall = {
          id: partial.id,
          name: partial.name,
          input: JSON.parse(partial.arguments || "{}"),
        };
        toolCalls.push(toolCall);
        onChunk({ type: "tool_use", toolCall });
      } catch {
        // Skip invalid tool call
      }
    }

    onChunk({ type: "done" });

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: { inputTokens, outputTokens },
      stopReason,
      model: this.model,
      provider: "groq",
    };
  }
}

