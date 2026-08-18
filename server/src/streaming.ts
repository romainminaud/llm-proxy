import type { Request } from 'express';
import type { ProviderConfig } from './providers.js';

/**
 * Detect whether the incoming request asked for a streamed response.
 * - OpenAI/Anthropic: `stream: true` in the JSON body.
 * - Gemini: streaming is selected by the URL action `:streamGenerateContent`.
 */
export function isStreamingRequest(provider: ProviderConfig, req: Request): boolean {
  if (provider.name === 'gemini') {
    return /:streamGenerateContent/.test(req.path);
  }
  return req.body?.stream === true;
}

export type StreamResult = {
  model: string | null;
  usage: Record<string, unknown> | null;
  /**
   * A reconstructed response body in the provider's native (non-streaming)
   * shape, so stored streamed requests render the same as non-streamed ones.
   * Null if nothing could be reassembled.
   */
  responseBody: Record<string, unknown> | null;
};

/**
 * Accumulate provider usage AND reassemble the response message by reading
 * SSE/stream events as they pass through.
 *
 * Usage reporting per provider:
 * - Anthropic: `message_start` carries input/cache tokens; `message_delta` carries
 *   cumulative output tokens. We merge them.
 * - OpenAI: a trailing chunk carries `usage` (only when the client sets
 *   `stream_options.include_usage`). We take the last one seen.
 * - Gemini: each chunk may carry `usageMetadata`; the final values win.
 *
 * Message reconstruction rebuilds the assistant content (text, thinking, tool
 * calls) so the saved response body shows the actual reply, not just tokens.
 */
export class StreamUsageAccumulator {
  private provider: ProviderConfig;
  private buffer = '';
  private model: string | null = null;
  // Anthropic merges across two events, so we keep a mutable usage object.
  private usage: Record<string, unknown> | null = null;

  // --- Anthropic reconstruction state ---
  private anthropicMessage: Record<string, unknown> | null = null;
  // content blocks keyed by their stream index
  private anthropicBlocks: Record<string, unknown>[] = [];

  // --- OpenAI reconstruction state ---
  private openaiText = '';
  private openaiRole = 'assistant';
  private openaiFinish: string | null = null;
  // tool call fragments keyed by index, accumulated across delta chunks
  private openaiToolCalls: Record<number, { id?: string; name?: string; args: string }> = {};
  private sawOpenaiChunk = false;
  // Responses API: the terminal event carries the complete native response,
  // so no reconstruction is needed — keep it verbatim.
  private openaiResponse: Record<string, unknown> | null = null;

  // --- Gemini reconstruction state ---
  // Parts in stream order; consecutive text parts are merged, non-text parts
  // (functionCall etc.) are kept verbatim so streamed tool calls aren't lost.
  private geminiParts: Record<string, unknown>[] = [];
  private geminiFinish: string | null = null;

  constructor(provider: ProviderConfig) {
    this.provider = provider;
  }

  /** Feed a decoded text chunk from the upstream stream. */
  push(text: string): void {
    this.buffer += text;

    if (this.provider.name === 'gemini') {
      // Gemini streams a JSON array; we can't reliably split it line-by-line,
      // so we extract objects greedily from the buffer.
      this.scanGemini();
      return;
    }

    // SSE: split on newlines, process complete lines, keep the remainder.
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.startsWith('data:')) {
        this.processSseData(line.slice(5).trim());
      }
    }
  }

  private processSseData(data: string): void {
    if (!data || data === '[DONE]') return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }

    if (this.provider.name === 'anthropic') {
      this.processAnthropicEvent(event);
      return;
    }

    this.processOpenAiChunk(event);
  }

  private processAnthropicEvent(event: Record<string, unknown>): void {
    const type = event.type as string | undefined;
    switch (type) {
      case 'message_start': {
        const message = event.message as Record<string, unknown> | undefined;
        if (message) {
          this.model = (message.model as string) ?? this.model;
          // Keep the message envelope (id, role, model, stop_reason, ...) minus
          // content/usage which we rebuild from subsequent events.
          const { content: _content, usage: u, ...envelope } = message;
          void _content;
          this.anthropicMessage = envelope;
          if (u) this.usage = { ...(this.usage ?? {}), ...(u as Record<string, unknown>) };
        }
        break;
      }
      case 'content_block_start': {
        const index = event.index as number;
        const block = event.content_block as Record<string, unknown> | undefined;
        if (block) {
          // Seed the block; text/thinking accumulate via deltas below.
          this.anthropicBlocks[index] = { ...block };
          // tool_use input arrives as partial_json deltas — buffer it as a string.
          if (block.type === 'tool_use') {
            this.anthropicBlocks[index]._partialJson = '';
          }
        }
        break;
      }
      case 'content_block_delta': {
        const index = event.index as number;
        const delta = event.delta as Record<string, unknown> | undefined;
        const block = this.anthropicBlocks[index];
        if (!delta || !block) break;
        const dtype = delta.type as string;
        if (dtype === 'text_delta') {
          block.text = ((block.text as string) ?? '') + (delta.text as string);
        } else if (dtype === 'thinking_delta') {
          block.thinking = ((block.thinking as string) ?? '') + (delta.thinking as string);
        } else if (dtype === 'input_json_delta') {
          block._partialJson = ((block._partialJson as string) ?? '') + (delta.partial_json as string);
        }
        break;
      }
      case 'message_delta': {
        const u = event.usage as Record<string, unknown> | undefined;
        if (u) this.usage = { ...(this.usage ?? {}), ...u };
        // stop_reason / stop_sequence land in the top-level delta.
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta && this.anthropicMessage) {
          if ('stop_reason' in delta) this.anthropicMessage.stop_reason = delta.stop_reason;
          if ('stop_sequence' in delta) this.anthropicMessage.stop_sequence = delta.stop_sequence;
        }
        break;
      }
    }
  }

  private processOpenAiChunk(event: Record<string, unknown>): void {
    // Responses API events are typed "response.*"; the terminal ones embed
    // the full response object with model + usage.
    const eventType = event.type as string | undefined;
    if (eventType?.startsWith('response.')) {
      if (
        eventType === 'response.completed' ||
        eventType === 'response.incomplete' ||
        eventType === 'response.failed'
      ) {
        const response = event.response as Record<string, unknown> | undefined;
        if (response) {
          this.openaiResponse = response;
          this.model = (response.model as string) ?? this.model;
          const responseUsage = response.usage as Record<string, unknown> | undefined;
          if (responseUsage) this.usage = responseUsage;
        }
      }
      return;
    }

    this.model = (event.model as string) ?? this.model;
    const u = event.usage as Record<string, unknown> | undefined | null;
    if (u) this.usage = u;

    const choices = event.choices as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(choices) || choices.length === 0) return;
    this.sawOpenaiChunk = true;

    const choice = choices[0];
    const delta = choice.delta as Record<string, unknown> | undefined;
    if (delta) {
      if (typeof delta.role === 'string') this.openaiRole = delta.role;
      if (typeof delta.content === 'string') this.openaiText += delta.content;

      const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          const idx = (tc.index as number) ?? 0;
          const slot = (this.openaiToolCalls[idx] ??= { args: '' });
          if (typeof tc.id === 'string') slot.id = tc.id;
          const fn = tc.function as Record<string, unknown> | undefined;
          if (fn) {
            if (typeof fn.name === 'string') slot.name = fn.name;
            if (typeof fn.arguments === 'string') slot.args += fn.arguments;
          }
        }
      }
    }
    if (typeof choice.finish_reason === 'string') this.openaiFinish = choice.finish_reason;
  }

  private scanGemini(): void {
    const modelMatch = this.buffer.match(/"modelVersion"\s*:\s*"([^"]+)"/);
    if (modelMatch) this.model = modelMatch[1];

    // Walk every complete top-level {...} object in the buffer, extracting text
    // parts, finishReason, and usageMetadata. We track how far we've consumed so
    // repeated calls don't double-count text.
    let searchFrom = this.geminiConsumed;
    while (true) {
      const objStart = this.buffer.indexOf('{', searchFrom);
      if (objStart === -1) break;
      const end = this.matchBrace(objStart);
      if (end === -1) break; // incomplete trailing object; wait for more data
      const objText = this.buffer.slice(objStart, end + 1);
      try {
        const obj = JSON.parse(objText);
        this.consumeGeminiObject(obj);
      } catch {
        // Not a standalone object (nested); skip past its opening brace only.
      }
      searchFrom = end + 1;
      this.geminiConsumed = searchFrom;
    }
  }

  private geminiConsumed = 0;

  private consumeGeminiObject(obj: Record<string, unknown>): void {
    const usage = obj.usageMetadata as Record<string, unknown> | undefined;
    if (usage) this.usage = usage;

    const candidates = obj.candidates as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(candidates) && candidates.length > 0) {
      const cand = candidates[0];
      const content = cand.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(parts)) {
        for (const p of parts) {
          if (typeof p.text === 'string') {
            const last = this.geminiParts[this.geminiParts.length - 1];
            if (last && typeof last.text === 'string' && Object.keys(last).length === 1) {
              last.text += p.text;
            } else {
              this.geminiParts.push({ text: p.text });
            }
          } else {
            this.geminiParts.push(p);
          }
        }
      }
      if (typeof cand.finishReason === 'string') this.geminiFinish = cand.finishReason;
    }
  }

  /** Return the index of the brace that closes the one at `start`, or -1. */
  private matchBrace(start: number): number {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  private buildResponseBody(): Record<string, unknown> | null {
    if (this.provider.name === 'anthropic') {
      if (!this.anthropicMessage && this.anthropicBlocks.length === 0) return null;
      const content = this.anthropicBlocks.filter(Boolean).map((b) => {
        const { _partialJson, ...rest } = b;
        // Finalize tool_use input from the buffered partial JSON.
        if (rest.type === 'tool_use' && typeof _partialJson === 'string') {
          try {
            rest.input = _partialJson ? JSON.parse(_partialJson) : {};
          } catch {
            rest.input = {};
          }
        }
        return rest;
      });
      return {
        ...(this.anthropicMessage ?? { type: 'message', role: 'assistant' }),
        content,
        ...(this.usage ? { usage: this.usage } : {}),
      };
    }

    if (this.provider.name === 'gemini') {
      if (this.geminiParts.length === 0 && !this.geminiFinish) return null;
      return {
        candidates: [
          {
            content: { role: 'model', parts: this.geminiParts },
            finishReason: this.geminiFinish ?? undefined,
          },
        ],
        ...(this.model ? { modelVersion: this.model } : {}),
        ...(this.usage ? { usageMetadata: this.usage } : {}),
      };
    }

    // OpenAI Responses API: the final event's response object is already the
    // native non-streamed shape.
    if (this.openaiResponse) return this.openaiResponse;

    // OpenAI chat completions.
    if (!this.sawOpenaiChunk) return null;
    const toolCalls = Object.entries(this.openaiToolCalls)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, tc]) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.args },
      }));
    const message: Record<string, unknown> = {
      role: this.openaiRole,
      content: this.openaiText || null,
    };
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    return {
      ...(this.model ? { model: this.model } : {}),
      choices: [{ index: 0, message, finish_reason: this.openaiFinish }],
      ...(this.usage ? { usage: this.usage } : {}),
    };
  }

  result(): StreamResult {
    return {
      model: this.model,
      usage: this.usage,
      responseBody: this.buildResponseBody(),
    };
  }
}
