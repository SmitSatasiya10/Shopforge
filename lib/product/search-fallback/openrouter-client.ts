// Low-level, bounded OpenRouter chat-completions caller. Never throws — every failure (missing
// key, network error, timeout, non-2xx, oversized/malformed body) resolves to a typed
// {ok:false} result the caller can turn directly into an honest ProductSearchResult error.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 45_000; // a web-search + page-fetch tool chain regularly exceeds 20s
const MAX_RESPONSE_BYTES = 2_000_000;
// A search-native model: it performs its own web search on every request and needs (and
// accepts) no tools. Verified live to return far more relevant product candidates than a
// general-purpose model driving OpenRouter's web_search tool (see docs/etsy-supplier-import-audit.md §4).
const DEFAULT_MODEL = "perplexity/sonar";

/**
 * Which model the fallback will call (OPENROUTER_MODEL overrides the default), and whether it
 * searches the web natively. Perplexity's models reject a `tools` array outright (OpenRouter
 * returns 404 "No endpoints found that support tool use" — verified live), so callers must
 * skip the openrouter:web_search/web_fetch tools and word the prompt for built-in search.
 */
export function resolveSearchModel(): { model: string; nativeSearch: boolean } {
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  return { model, nativeSearch: /^perplexity\//i.test(model) };
}

export interface OpenRouterTool {
  type: string;
  [key: string]: unknown;
}

export interface OpenRouterChatRequest {
  systemPrompt: string;
  userPrompt: string;
  tools: OpenRouterTool[];
}

/**
 * A search citation attached to the model's answer. Search-native models (Perplexity via
 * OpenRouter) return the actual pages their answer drew on as `annotations` of type
 * `url_citation` — verified live, these regularly include real product/listing URLs (with
 * titles) that the model's JSON answer omitted, so callers treat them as an additional
 * candidate source rather than throwing them away.
 */
export interface SearchCitation {
  url: string;
  title: string | null;
}

export type OpenRouterChatResult =
  | { ok: true; text: string; citations: SearchCitation[] }
  | { ok: false; error: string };

function parseCitations(message: unknown): SearchCitation[] {
  const annotations = (message as { annotations?: unknown })?.annotations;
  if (!Array.isArray(annotations)) return [];
  const citations: SearchCitation[] = [];
  for (const entry of annotations) {
    const citation = (entry as { type?: unknown; url_citation?: { url?: unknown; title?: unknown } })?.url_citation;
    if ((entry as { type?: unknown })?.type !== "url_citation") continue;
    if (typeof citation?.url !== "string" || !citation.url) continue;
    citations.push({ url: citation.url, title: typeof citation.title === "string" && citation.title ? citation.title : null });
  }
  return citations;
}

async function readTextWithLimit(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const decoder = new TextDecoder();
  let received = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Response exceeded the size limit");
    }
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

export async function callOpenRouterChat(req: OpenRouterChatRequest): Promise<OpenRouterChatResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Web search isn't configured — set OPENROUTER_API_KEY." };
  }
  const { model } = resolveSearchModel();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userPrompt },
        ],
        // Search-native models reject a tools array outright — omit it entirely when empty.
        ...(req.tools.length > 0 ? { tools: req.tools } : {}),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Could not reach the web search service." };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "The web search service rejected the configured API key." };
    }
    if (res.status === 429) {
      return { ok: false, error: "The web search service is rate-limiting requests — try again shortly." };
    }
    return { ok: false, error: `The web search service returned an error (status ${res.status}).` };
  }

  let bodyText: string;
  try {
    bodyText = await readTextWithLimit(res);
  } catch {
    return { ok: false, error: "The web search service response was too large to read." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { ok: false, error: "The web search service returned an unreadable response." };
  }

  const message = (parsed as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content !== "string" || !content.trim()) {
    return { ok: false, error: "The web search service returned an empty response." };
  }
  return { ok: true, text: content, citations: parseCitations(message) };
}
