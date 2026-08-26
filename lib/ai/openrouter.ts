import { AiConfig, requireApiKey } from "./config";
import { startAIRequest, logAIRequestInput, logAIRequestOutput, finishAIRequest, logAIRequestError } from "./debug-logger";
import type { PromptPart, GenerationMeta } from "./prompt-breakdown";

// Minimal OpenRouter client. Only the chat-completions call the generator needs, with the
// JSON-object response format so the model cannot wrap its output in prose or a code fence.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface ChatOptions {
  messages: ChatMessage[];
  config: AiConfig;
  /** Ask the model for a JSON object rather than free text. */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Per-component breakdown of the user-message content, for the audit log's "Context breakdown" table. Never sent to the provider. */
  promptBreakdown?: PromptPart[];
  /** Full-page-generation structure (page type, section/block counts), for the audit log's "Generation structure" table. Never sent to the provider. */
  generationMeta?: GenerationMeta;
}

export async function chat(options: ChatOptions): Promise<string> {
  const { config, messages } = options;
  const handle = startAIRequest({ model: config.model, provider: "OpenRouter", messages });
  logAIRequestInput(handle, messages, {
    promptBreakdown: options.promptBreakdown,
    generationMeta: options.generationMeta,
  });

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${requireApiKey(config)}`,
        "content-type": "application/json",
        "x-title": "Shopforge",
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: options.maxTokens ?? 16000,
        temperature: options.temperature ?? 0.7,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new OpenRouterError(
        `OpenRouter returned ${response.status}: ${body.slice(0, 400)}`,
        response.status,
      );
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    if (payload.error) throw new OpenRouterError(payload.error.message ?? "OpenRouter error");

    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new OpenRouterError("OpenRouter returned no content");

    logAIRequestOutput(handle, content);
    finishAIRequest(handle, { usage: extractUsage(payload.usage) });
    return content;
  } catch (error) {
    logAIRequestError(handle, error);
    throw error;
  }
}

function extractUsage(raw?: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}): { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } {
  return {
    inputTokens: typeof raw?.prompt_tokens === "number" ? raw.prompt_tokens : null,
    outputTokens: typeof raw?.completion_tokens === "number" ? raw.completion_tokens : null,
    totalTokens: typeof raw?.total_tokens === "number" ? raw.total_tokens : null,
  };
}

/**
 * Parses a model response as JSON, tolerating a ```json fence — `response_format` removes
 * the fence on models that honour it, and not every model on OpenRouter does.
 */
export function parseJsonResponse<T = unknown>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : raw).trim();
  try {
    return JSON.parse(body) as T;
  } catch {
    // A truncated or prose-wrapped response: recover the outermost JSON object if there is one.
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(body.slice(start, end + 1)) as T;
    throw new OpenRouterError(`Model did not return JSON: ${body.slice(0, 200)}`);
  }
}
