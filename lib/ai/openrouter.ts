import { AiConfig, requireApiKey } from "./config";

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
}

export async function chat(options: ChatOptions): Promise<string> {
  const { config, messages } = options;
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
  };
  if (payload.error) throw new OpenRouterError(payload.error.message ?? "OpenRouter error");

  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new OpenRouterError("OpenRouter returned no content");
  return content;
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
