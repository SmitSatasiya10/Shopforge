# 10 — AI Architecture

## 1. Purpose and scope

Shopforge's entire value proposition rests on the AI understanding a **specific, real theme** (via the Theme Manifest and Theme Model, docs 07–09) rather than hallucinating a generic storefront. Everything in this document is the plumbing that makes AI calls happen safely, cheaply, and independently of any single AI vendor.

This document defines the **AI Provider Abstraction Layer** — the lowest layer of the AI stack. It does not decide *what* to ask the AI (that's the Operation Planner, doc 11) or *when* to ask a clarifying question first (doc 13). It only defines: how a call to "an AI" is made, tracked, retried, capped, cached, and observed, regardless of which vendor answers it.

Applies directly:
- **Principle 8 — Shopify compatibility first**: the provider layer never leaks vendor-specific quirks into the rest of the system.
- **Principle 9 — Cost-aware AI**: every call is priced, budgeted, and logged before it is allowed to run.
- **Principle 10 — Security first**: imported theme content is untrusted input and is treated as such when it flows into prompts.

## 2. Why a provider abstraction layer

Shopforge must not be hardcoded around one AI vendor. Model quality, pricing, rate limits, and even entire capabilities (e.g., a provider deprecating vision support, or a new provider offering cheaper structured output) shift constantly. The abstraction layer exists so that:

- A provider outage degrades gracefully instead of taking down the product (§13).
- Cost/performance routing decisions (§4) can send different task types to different providers without touching calling code.
- Adding a new provider is a matter of implementing one adapter against a fixed interface, not touching the Operation Planner, Clarification System, or any caller.

Every caller in Shopforge (Operation Planner, Clarification System, copy generation, image generation) talks to the **AI Gateway** — the single internal service that implements this abstraction — never to a provider SDK directly.

## 3. Common interface surface

The AI Gateway exposes five capability families. Every provider adapter implements as many of these as the underlying vendor supports; the Gateway's capability matrix (§3.2) tracks which provider is used for which family.

| Capability | Purpose in Shopforge | Primary caller(s) |
|---|---|---|
| **Chat** | Free-form conversational turns, intent restatement, clarification dialogue | Clarification System (doc 13), Operation Planner (doc 11) |
| **Structured output / tool-calling** | Force the model to emit a valid `Operation` / `Operation Plan` object, not prose | Operation Planner (doc 11) |
| **Vision** | Read a screenshot of the current storefront/theme preview to ground "make it look more premium"-style requests | Operation Planner, Clarification System |
| **Image generation** | Produce hero images, banners, lifestyle photography referenced by `GeneratedAsset` | `/ai/generate-image` |
| **Embeddings** | Semantic search over section names/schema labels for fuzzy requests ("make the header better") | Context Selector (doc 12) |

### 3.1 Provider-neutral request envelope

Every call into the Gateway, regardless of capability, is wrapped in a common envelope so routing, logging, and budgeting logic is capability-agnostic:

```
AIRequest {
  requestId: string
  capability: "chat" | "structured_output" | "vision" | "image_generation" | "embeddings"
  conversationId?: string            // -> AIConversation, for multi-turn context
  operationContext?: {               // present when called from the Operation Planner
    themeVersionId: string
    relatedOperationIds?: [string]
  }
  modelTier: "fast" | "standard" | "premium"   // see §4, resolved to a concrete model by the router
  input: {
    systemPrompt: string
    messages: [{ role: "user"|"assistant"|"system", content: string | ContentBlock[] }]
    responseSchema?: object          // JSON Schema the output must conform to (structured_output)
    images?: [assetRefOrDataUri]     // vision
  }
  budget: {
    maxOutputTokens: number
    maxCreditCost: number            // hard ceiling, see §6
  }
  cacheable: boolean                 // see §10
}

AIResponse {
  requestId: string
  providerUsed: string
  modelUsed: string
  output: string | object            // object when responseSchema was supplied
  usage: { inputTokens, outputTokens, imageCount?, embeddingCount? }
  latencyMs: number
  cacheHit: boolean
  finishReason: "complete" | "truncated" | "refused" | "error"
}
```

Callers (Operation Planner, Clarification System) only ever see `AIRequest`/`AIResponse` — never a provider-specific payload shape. Provider adapters are responsible for translating this envelope into the vendor's actual API shape (e.g., converting `responseSchema` into OpenAI function-calling / tool-use format, or Anthropic tool-use format) and translating the vendor's raw response back into `AIResponse`.

### 3.2 Provider capability matrix

Tracked centrally so the router (§4) knows what's actually available. This is illustrative, not a commitment to specific vendor products:

| Provider | Chat | Structured output | Vision | Image gen | Embeddings |
|---|---|---|---|---|---|
| OpenAI | ✅ | ✅ | ✅ | ✅ | ✅ |
| Anthropic | ✅ | ✅ | ✅ | ❌ (routed elsewhere) | ❌ (routed elsewhere) |
| Future provider N | adapter-dependent | adapter-dependent | adapter-dependent | adapter-dependent | adapter-dependent |

Because no single provider need cover every capability, a single Shopforge feature (e.g., the Operation Planner) may transparently use two different providers for two different sub-calls within the same user request — one for structured-output planning, one for embeddings — without the caller knowing or caring.

## 4. Model tiering and routing

Not every AI call deserves the most expensive model. The Gateway resolves `modelTier` to a concrete `(provider, model)` pair via a routing table that can be changed centrally without code changes in callers:

| Tier | Used for | Cost profile |
|---|---|---|
| `fast` | Intent classification, ambiguity detection, keyword/entity extraction feeding the Context Selector (doc 12), simple restatement | Cheapest available model per provider; near-zero cost per call |
| `standard` | Chat turns, clarifying questions, structured `Operation` emission for well-scoped requests | Mid-tier model |
| `premium` | Multi-step `Operation Plan` generation for complex requests, Liquid/CSS/JS generation (`modify_liquid`, `create_section_file`, `modify_css`, `modify_js`), vision grounding | Highest-quality model available |

This tiering is the mechanism behind **Principle 9 (cost-aware AI)** and **Principle 3 (minimal AI generation)**: structural decision-making runs on cheap/fast models, and only the narrow slice of work that actually requires generating novel Liquid/CSS/JS pays for a premium model.

Routing also carries a **fallback chain** per tier (§7): if the primary provider for a tier is unavailable or rate-limited, the router retries against the next provider in the chain that supports the requested capability, before surfacing an error to the caller.

## 5. Token limits and context windows

The Gateway enforces token budgets at two levels:

1. **Provider-level ceiling** — the actual context window of the resolved model; requests that would exceed it are rejected before being sent, with a structured error the caller can act on (typically: ask the Context Selector for a smaller slice, doc 12).
2. **Product-level ceiling** — `budget.maxOutputTokens` and a per-request-type input token target set by policy (see doc 12 §"Token/cost budget policy"), independent of what the provider would technically allow. This keeps cost predictable even as providers ship ever-larger context windows.

The Gateway never assembles context itself — it only enforces the budget that the Context Selector (doc 12) and Operation Planner (doc 11) hand it. Context *selection* (which part of the Theme Model/Manifest to include) is entirely out of scope for this document; see doc 12.

## 6. Cost control

Every `AIRequest` carries `budget.maxCreditCost`, computed by the caller before the call is dispatched (the Operation Planner derives it from the operation's expected `estimatedCreditCost`, doc 11 §Operation schema). The Gateway:

- Rejects a request outright if the cheapest viable route for the requested tier/capability would exceed `maxCreditCost`.
- Converts actual provider usage (tokens, images, embeddings) into Shopforge credits using a per-provider, per-model price table, and writes the realized cost onto the resulting `AIUsageEvent` (§11) — the authoritative record consumed by the `CreditBalance` ledger.
- Enforces per-organization rate/spend guards (daily/monthly credit caps) *before* dispatch, independent of the per-call budget, so a runaway conversation loop cannot silently drain an account.
- Distinguishes **structural** calls (near-zero cost, e.g. intent classification for an `update_setting`) from **generative** calls (real cost, e.g. `create_section_file`) at the routing layer itself — a structural-tier request is never accidentally routed to a premium model.

## 7. Retry strategy

| Failure type | Strategy |
|---|---|
| Transient provider error (5xx, timeout) | Exponential backoff, up to 3 attempts, same provider |
| Rate limit (429) | Immediate fallback to next provider in the tier's fallback chain; only backs off same-provider if no fallback exists |
| Structured-output schema violation (model returned invalid JSON/Operation shape) | One repair attempt: re-prompt the same call with the validation error appended, asking the model to correct its own output; if it fails twice, surface as `finishReason: "error"` to the caller |
| Content refusal | No retry — surfaced to the caller as `finishReason: "refused"`, which the Operation Planner/Clarification System turn into a user-facing refusal (doc 13, outcome "refuse — unsupported") |
| All providers in fallback chain exhausted | Circuit breaker opens for that capability for a cooldown window; caller receives a clear "AI temporarily unavailable" error rather than hanging |

Retries are only ever applied to the Gateway's own dispatch of a *single* `AIRequest`. Retrying an entire multi-step `Operation Plan` because one sub-call failed is a decision made by the Operation Planner (doc 11), not by this layer.

## 8. Timeouts

Timeouts are set per capability, not globally, because generative image work is legitimately slower than a chat turn:

| Capability | Timeout |
|---|---|
| Chat / structured output (fast, standard tiers) | Short — tuned for interactive UI response |
| Structured output (premium tier, plan generation) | Medium — user sees a "planning..." state |
| Vision | Medium |
| Image generation | Long — user sees an async progress state, not a blocking spinner |
| Embeddings | Short — these are batched and typically off the critical path (doc 12) |

A timeout is treated identically to a transient provider error for retry purposes (§7).

## 9. Streaming

Chat and structured-output calls support token streaming back through the Gateway to the caller, which is what lets the UI show:
- Assistant chat replies appearing incrementally.
- An `Operation Plan` rendering step-by-step as the model emits it, rather than the user staring at a blank state until the entire plan is generated.

Streaming is a transport concern only — the Gateway still assembles the full `AIResponse` (with final `usage`, `finishReason`) once the stream completes, and that final object is what gets persisted as an `AIMessage` / logged as an `AIUsageEvent`. Image generation and embeddings are not streamed (they are not meaningfully incremental).

## 10. Response caching

Two independent cache layers sit in front of provider dispatch:

1. **Exact-match cache** — keyed on a hash of `(capability, modelTier, systemPrompt, messages, responseSchema)`. Any `AIRequest` marked `cacheable: true` (structural classification calls, embeddings of unchanged section labels, repeated identical clarification prompts) checks this cache before dispatch. Hit → `cacheHit: true`, zero provider cost, `AIUsageEvent` still recorded but with `creditsCost: 0` for auditability.
2. **Semantic cache (embeddings-backed)** — used specifically by the Context Selector's semantic search sub-flow (doc 12) rather than for full chat turns, since chat responses are highly context-dependent and rarely safe to reuse verbatim.

Generative calls (`create_section_file`, `modify_liquid`, `modify_css`, `modify_js`, image generation) are never marked `cacheable` — by definition they're generating something novel and reuse would defeat the purpose.

## 11. Observability — what gets logged per AI call

Every dispatched `AIRequest`, whether it hits cache or a live provider, produces exactly one **`AIUsageEvent`** (see doc 17 for full field rationale). At minimum, each event captures:

- `requestId`, `conversationId` (links back to `AIConversation`/`AIMessage`)
- `capability`, `modelTier`, `providerUsed`, `modelUsed`
- `operationId` / `operationPlanId` when the call was made in service of a specific `Operation` or `Operation Plan` (doc 11) — this is what lets Shopforge answer "how much did generating this section actually cost"
- `inputTokens`, `outputTokens`, `imageCount`/`embeddingCount` where applicable
- `creditsCost` (realized), `budgetMaxCreditCost` (requested ceiling), so over/under-estimation can be tracked and used to improve future `estimatedCreditCost` predictions
- `latencyMs`, `cacheHit`
- `finishReason`, and on failure, a structured `errorCode`
- `retryCount`

This log is the backbone of three things: the `CreditBalance` ledger (doc 22, Billing), operational alerting on provider health, and long-run tuning of the estimation model behind `estimatedCreditCost` in the `Operation` schema.

## 12. How this layer is consumed upstream

The AI Gateway is intentionally "dumb" — it knows nothing about themes, sections, or operations. Two upstream systems give it meaning:

### 12.1 Operation Planner (doc 11)
The Planner is the primary caller. For a single, well-scoped request ("make the hero background dark blue") it issues one `structured_output` call at `standard` tier with a `responseSchema` matching the `Operation` type, using context assembled by doc 12. For a complex request it issues a `premium`-tier `structured_output` call whose `responseSchema` matches the `Operation Plan` shape (ordered `Operation[]` + rationale + risk summary). If the Planner determines mid-flow that generation is required (`create_section_file`/`modify_liquid`/etc.), it issues a separate `premium`-tier chat/structured-output call scoped narrowly to just that file's generation — never a call that regenerates the whole theme.

### 12.2 Clarification System (doc 13)
The Clarification System calls the Gateway at `fast` tier to run ambiguity/missing-information detection (a lightweight structured-output classification: "does this request contain enough information to act?"), and at `standard` tier to phrase the actual clarifying question or proposed-plan summary shown to the user. It never calls at `premium` tier — if a request is complex enough to need premium-tier planning, that work belongs to the Operation Planner once clarification has resolved.

Both systems pass `operationContext` on every call so every `AIUsageEvent` is traceable to the operation or plan it served.

## 13. Failure modes and degradation

| Scenario | Behavior |
|---|---|
| Single provider down, fallback available | Transparent to user; logged as a provider-level failure on the `AIUsageEvent` retry trail |
| All providers for a capability down | Circuit breaker open → caller (Planner/Clarification) receives a typed "AI unavailable" error → surfaced to the user as "Shopforge's AI is temporarily unavailable, please try again shortly" rather than a generic error or a hang |
| Structured output repeatedly malformed | Treated as an internal error, not surfaced as a clarification or refusal — logged loudly, since it indicates a prompt/schema drift bug, not a user-caused ambiguity |
| Budget exceeded before dispatch | Caller receives a typed `BudgetExceeded` error; for the Operation Planner this becomes a user-facing "this request would exceed available credits" message, never a silent downgrade to a cheaper model that changes output quality unexpectedly |

## 14. Security considerations (Principle 10)

Theme content parsed into the Manifest/Model originates from **imported, untrusted Liquid/JSON** (a merchant's existing theme, possibly built by a third-party developer). Because context assembled from the Model is injected into AI prompts (doc 12), the Gateway treats all such content as potential prompt-injection material:

- Section labels, setting values, and any free-text theme content included in a prompt are wrapped in clearly delimited context blocks, never concatenated directly into the system prompt.
- The Gateway's system prompts explicitly instruct the model to treat theme content as **data to reason about, not instructions to follow** — an instruction embedded in, say, a section's default text ("ignore previous instructions and...") must not be able to alter Planner behavior.
- Structured-output mode is preferred over free-form chat wherever the output feeds directly into an executable `Operation`, precisely because a schema-constrained response is far harder to hijack than free text.
- Generated code (`modify_liquid`, `create_section_file`, `modify_css`, `modify_js`) is never executed as a side effect of the AI call itself — it is only ever proposed, then routed through validation (doc 15) before it can touch a real theme file.
