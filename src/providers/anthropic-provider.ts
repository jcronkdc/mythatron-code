/**
 * Anthropic Provider - Claude models
 * Your current provider, optimized
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ToolDefinition,
  MODEL_PRICING,
} from "./types";

export class AnthropicProvider implements LLMProvider {
  readonly type = "anthropic" as const;
  readonly model: string;
  private client: Anthropic;
  private pricing: { input: number; output: number };

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new Error("Anthropic API key required");
    }
    
    this.model = config.model;
    this.client = new Anthropic({ apiKey: config.apiKey });
    
    // Get pricing or default to Sonnet pricing
    const { MODEL_PRICING } = require("./types");
    this.pricing = MODEL_PRICING[this.model] || { input: 3, output: 15 };
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Quick ping to check API
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      });
      return true;
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
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const systemMessage = request.messages.find((m) => m.role === "system");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens || 8192,
      temperature: request.temperature ?? 0,
      system: systemMessage?.content,
      messages,
      tools: request.tools as Anthropic.Tool[],
    });

    // Extract content
    let content = "";
    const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          }
        : undefined,
      stopReason:
        response.stop_reason === "tool_use"
          ? "tool_use"
          : response.stop_reason === "max_tokens"
          ? "max_tokens"
          : "end_turn",
      model: this.model,
      provider: "anthropic",
    };
  }

  async stream(
    request: CompletionRequest,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<CompletionResponse> {
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const systemMessage = request.messages.find((m) => m.role === "system");

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: request.maxTokens || 8192,
      temperature: request.temperature ?? 0,
      system: systemMessage?.content,
      messages,
      tools: request.tools as Anthropic.Tool[],
    });

    let content = "";
    const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: "end_turn" | "tool_use" | "max_tokens" = "end_turn";

    // Current tool being streamed
    let currentToolId: string | null = null;
    let currentToolName: string | null = null;
    let currentToolInput = "";

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          currentToolId = event.content_block.id;
          currentToolName = event.content_block.name;
          currentToolInput = "";
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          content += event.delta.text;
          onChunk({ type: "text", text: event.delta.text });
        } else if (event.delta.type === "input_json_delta") {
          currentToolInput += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolId && currentToolName) {
          try {
            const input = JSON.parse(currentToolInput || "{}");
            const toolCall = {
              id: currentToolId,
              name: currentToolName,
              input,
            };
            toolCalls.push(toolCall);
            onChunk({ type: "tool_use", toolCall });
          } catch {
            // Invalid JSON, skip
          }
          currentToolId = null;
          currentToolName = null;
          currentToolInput = "";
        }
      } else if (event.type === "message_delta") {
        if (event.usage) {
          outputTokens = event.usage.output_tokens;
        }
        if (event.delta.stop_reason) {
          stopReason =
            event.delta.stop_reason === "tool_use"
              ? "tool_use"
              : event.delta.stop_reason === "max_tokens"
              ? "max_tokens"
              : "end_turn";
        }
      } else if (event.type === "message_start") {
        if (event.message.usage) {
          inputTokens = event.message.usage.input_tokens;
        }
      }
    }

    onChunk({ type: "done" });

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: { inputTokens, outputTokens },
      stopReason,
      model: this.model,
      provider: "anthropic",
    };
  }
}

