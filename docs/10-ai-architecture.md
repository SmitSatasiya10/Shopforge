# 10 — AI Architecture

## 1. Purpose and scope

Shopforge's value proposition is a small, self-authored library of Sections (Base Theme + fixed catalog, docs 07–08) driven by an AI that acts as a **structured configuration/content generator, never a code generator** — it selects sections, orders them, sets their settings, and writes their copy, all expressed against the **Store Configuration** (doc 11). Everything in this document is the plumbing that makes AI calls happen safely, cheaply, and independently of any single AI vendor.

This document defines the **AI Provider Abstraction Layer** — the lowest layer of the AI stack. It does not decide *what* to ask the AI (that's the Operation Planner, doc 11) or *when* to ask a clarifying question first (doc 13). It only defines: how a call to "an AI" is made, tracked, retried, capped, cached, and observed, regardless of which vendor answers it.

Applies directly:
- **Cost-aware AI**: every call is priced, budgeted, and logged before it is allowed to run.
- **Ask instead of guessing**: the Gateway's capability set (chat, structured output) is what the Clarification System (doc 13) is built on.
- **Everything is reversible**: structured-output calls that feed `Operation`s are the mechanism doc 14's diff/undo model attaches to.
- **Security first**: content pulled from an arbitrary, merchant-supplied Product URL (doc 11 §4) is untrusted input and is treated as such when it flows into prompts (§14, doc 20).

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
| **Structured output / tool-calling** | Force the model to emit a valid `Operation` / `OperationPlan` / section-selection object against the Store Configuration — not prose | Operation Planner (doc 11) |
| **Vision** | Read product images during Product Import, or a rendered Store Configuration preview, to ground visual/style requests ("make it feel more premium") | Operation Planner, Product Import (doc 11 §4) |
| **Image generation** | Produce hero images, banners, lifestyle photography used as section image/media setting values | `/ai/generate-image` |
| **Embeddings** | Lightweight semantic mapping of vague style language ("more premium") to concrete section/setting targets in the fixed catalog | Context Selector (doc 12), optional fallback tier only |

### 3.1 Provider-neutral request envelope

Every call into the Gateway, regardless of capability, is wrapped in a common envelope so routing, logging, and budgeting logic is capability-agnostic:

```
AIRequest {
  requestId: string
  capability: "chat" | "structured_output" | "vision" | "image_generation" | "embeddings"
  conversationId?: string            // -> AIConversation, for multi-turn context
  operationContext?: {               // present when called from the Operation Planner
    storeConfigId: string
    relatedOperationIds?: [string]
  }
  modelTier: "fast" | "standard" | "premium"   // see §4, resolved to a concrete model by the router
  input: {
    systemPrompt: string
    messages: [{ role: "user"|"assistant"|"system", content: string | ContentBlock[] }]
    responseSchema?: object          // JSON Schema the output must conform to (structured_output) —
                                      // e.g. the `Operation`/`OperationPlan` shape (doc 11 §3), or a
                                      // section-selection object during Flow A generation (doc 11 §4)
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

**Worked example** — the call the Operation Planner issues for *"make the hero heading bigger"* (full trace in doc 11 §6):

```
AIRequest {
  capability: "structured_output",
  modelTier: "standard",
  operationContext: { storeConfigId: "sc_44a1..." },
  input: {
    systemPrompt: "You select and configure sections from a fixed catalog. You never write code.",
    messages: [{ role: "user", content: "make the hero heading bigger" }],
    responseSchema: OperationSchema   // matches doc 11 §3.2's Operation shape
  },
  budget: { maxOutputTokens: 300, maxCreditCost: 1 },
  cacheable: false
}
```
`AIResponse.output` here is a single `Operation` object (`type: "set_setting"`) — not Liquid, not prose, not a diff. This is the shape every structured-output call in Shopforge ultimately produces or contributes to: a `Operation`/`OperationPlan` object, or (during Flow A) an intermediate section-selection/ordering object that later gets turned into one.

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
| `standard` | Chat turns, clarifying questions, structured `Operation` emission for well-scoped edits, section-settings generation from Product Data | Mid-tier model |
| `premium` | Multi-step `OperationPlan` assembly for complex edits or a full Flow A generation pass, `generate_copy` calls needing higher-quality prose (FAQ/testimonial/CTA copywriting), vision grounding | Highest-quality model available |

This tiering is the mechanism behind **cost-aware AI**: structural decision-making runs on cheap/fast models, and only the narrow slice of work that actually generates novel content (`generate_copy`, doc 11 §3.3) pays for a premium model. No tier routes to code generation in the primary workflow — see doc 11's Future / Advanced Architecture for the one place that would change if that capability were ever revisited.

Routing also carries a **fallback chain** per tier (§7): if the primary provider for a tier is unavailable or rate-limited, the router retries against the next provider in the chain that supports the requested capability, before surfacing an error to the caller.

## 5. Token limits and context windows

The Gateway enforces token budgets at two levels:

1. **Provider-level ceiling** — the actual context window of the resolved model; requests that would exceed it are rejected before being sent, with a structured error the caller can act on (typically: ask the Context Selector for a smaller slice, doc 12).
2. **Product-level ceiling** — `budget.maxOutputTokens` and a per-request-type input token target set by policy (see doc 12 §6, "Token/cost budget policy"), independent of what the provider would technically allow. This keeps cost predictable even as providers ship ever-larger context windows.

The Gateway never assembles context itself — it only enforces the budget that the Context Selector (doc 12) and Operation Planner (doc 11) hand it. Context *selection* (which section(s)/schema slice/Store Configuration slice to include) is entirely out of scope for this document; see doc 12.

## 6. Cost control

Every `AIRequest` carries `budget.maxCreditCost`, computed by the caller before the call is dispatched (the Operation Planner derives it from the operation's expected `estimatedCreditCost`, doc 11 §3.2). The Gateway:

- Rejects a request outright if the cheapest viable route for the requested tier/capability would exceed `maxCreditCost`.
- Converts actual provider usage (tokens, images, embeddings) into Shopforge credits using a per-provider, per-model price table, and writes the realized cost onto the resulting `AIUsageEvent` (§11) — the authoritative record consumed by the `CreditBalance` ledger (doc 22).
- Enforces per-organization rate/spend guards (daily/monthly credit caps) *before* dispatch, independent of the per-call budget, so a runaway conversation loop cannot silently drain an account.
- Distinguishes **structural** calls (near-zero cost — `add_section`, `set_setting`, `reorder_section`, and every other structural `OperationType` in doc 11 §3.3) from **generative** calls (real cost — `generate_copy`, the one content-authoring operation type) at the routing layer itself, so a structural-tier request is never accidentally routed to a premium model.

## 7. Retry strategy

| Failure type | Strategy |
|---|---|
| Transient provider error (5xx, timeout) | Exponential backoff, up to 3 attempts, same provider |
| Rate limit (429) | Immediate fallback to next provider in the tier's fallback chain; only backs off same-provider if no fallback exists |
| Structured-output schema violation (model returned invalid JSON/`Operation` shape) | One repair attempt: re-prompt the same call with the validation error appended, asking the model to correct its own output; if it fails twice, surface as `finishReason: "error"` to the caller |
| Content refusal | No retry — surfaced to the caller as `finishReason: "refused"`, which the Operation Planner/Clarification System turn into a user-facing refusal (doc 13, outcome "refuse — unsupported") |
| All providers in fallback chain exhausted | Circuit breaker opens for that capability for a cooldown window; caller receives a clear "AI temporarily unavailable" error rather than hanging |

Retries are only ever applied to the Gateway's own dispatch of a *single* `AIRequest`. Retrying an entire multi-step `OperationPlan` because one sub-call failed, or a whole Flow A generation pipeline because one section's content generation failed, is a decision made by the Operation Planner (doc 11 §10), not by this layer.

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
- An `OperationPlan` rendering step-by-step as the model emits it (or, during Flow A generation, sections appearing one at a time as they're selected), rather than the user staring at a blank state until the entire plan is generated.

Streaming is a transport concern only — the Gateway still assembles the full `AIResponse` (with final `usage`, `finishReason`) once the stream completes, and that final object is what gets persisted as an `AIMessage` / logged as an `AIUsageEvent`. Image generation and embeddings are not streamed (they are not meaningfully incremental).

## 10. Response caching

Two independent cache layers sit in front of provider dispatch:

1. **Exact-match cache** — keyed on a hash of `(capability, modelTier, systemPrompt, messages, responseSchema)`. Any `AIRequest` marked `cacheable: true` (structural classification calls, section-selection calls over unchanged Product Data, repeated identical clarification prompts) checks this cache before dispatch. Hit → `cacheHit: true`, zero provider cost, `AIUsageEvent` still recorded but with `creditsCost: 0` for auditability.
2. **Semantic cache (embeddings-backed)** — used specifically by the Context Selector's lightweight semantic-fallback sub-flow (doc 12 §2.3) rather than for full chat turns, since chat responses are highly context-dependent and rarely safe to reuse verbatim.

`generate_copy` calls are never marked `cacheable` — by definition they're authoring novel, product/context-specific text and reuse would defeat the purpose.

## 11. Observability — what gets logged per AI call

Every dispatched `AIRequest`, whether it hits cache or a live provider, produces exactly one **`AIUsageEvent`** (see doc 17 for full field rationale). At minimum, each event captures:

- `requestId`, `conversationId` (links back to `AIConversation`/`AIMessage`)
- `capability`, `modelTier`, `providerUsed`, `modelUsed`
- `operationId` / `operationPlanId` when the call was made in service of a specific `Operation` or `OperationPlan` (doc 11) — this is what lets Shopforge answer "how much did generating this store's FAQ content actually cost"
- `inputTokens`, `outputTokens`, `imageCount`/`embeddingCount` where applicable
- `creditsCost` (realized), `budgetMaxCreditCost` (requested ceiling), so over/under-estimation can be tracked and used to improve future `estimatedCreditCost` predictions
- `latencyMs`, `cacheHit`
- `finishReason`, and on failure, a structured `errorCode`
- `retryCount`

This log is the backbone of three things: the `CreditBalance` ledger (doc 22, Billing), operational alerting on provider health, and long-run tuning of the estimation model behind `estimatedCreditCost` in the `Operation` schema.

## 12. How this layer is consumed upstream

The AI Gateway is intentionally "dumb" — it knows nothing about sections, catalogs, or Store Configurations. Two upstream systems give it meaning:

### 12.1 Operation Planner (doc 11 — AI Generation & Editing Operation System)
The Planner is the primary caller, across both flows it owns. For Flow A (AI Store Generation, doc 11 §4), it issues a sequence of `standard`/`premium`-tier structured-output calls — section selection, ordering, settings, content — each scoped to context assembled by doc 12, culminating in an `OperationPlan`. For Flow B (conversational editing, doc 11 §6–§7), a single well-scoped request issues one `structured_output` call at `standard` tier with a `responseSchema` matching the `Operation` type; a complex request issues a `premium`-tier call whose `responseSchema` matches the `OperationPlan` shape. Every `generate_copy` step, in either flow, is its own narrowly-scoped `premium`-tier call — never a call that regenerates unrelated content.

### 12.2 Clarification System (doc 13)
The Clarification System calls the Gateway at `fast` tier to run ambiguity/missing-information detection (a lightweight structured-output classification: "does this request contain enough information to act?"), and at `standard` tier to phrase the actual clarifying question or proposed-plan summary shown to the user. It never calls at `premium` tier — if a request is complex enough to need premium-tier planning or copy generation, that work belongs to the Operation Planner once clarification has resolved.

Both systems pass `operationContext` on every call so every `AIUsageEvent` is traceable to the operation or plan it served.

## 13. Failure modes and degradation

| Scenario | Behavior |
|---|---|
| Single provider down, fallback available | Transparent to user; logged as a provider-level failure on the `AIUsageEvent` retry trail |
| All providers for a capability down | Circuit breaker open → caller (Planner/Clarification) receives a typed "AI unavailable" error → surfaced to the user as "Shopforge's AI is temporarily unavailable, please try again shortly" rather than a generic error or a hang |
| Structured output repeatedly malformed | Treated as an internal error, not surfaced as a clarification or refusal — logged loudly, since it indicates a prompt/schema drift bug, not a user-caused ambiguity |
| Budget exceeded before dispatch | Caller receives a typed `BudgetExceeded` error; for the Operation Planner this becomes a user-facing "this request would exceed available credits" message, never a silent downgrade to a cheaper model that changes output quality unexpectedly |

## 14. Security considerations

AI output in the primary workflow is **structured data and content — `Operation`s against the Store Configuration, and generated copy strings — never executable code.** It is validated as data (schema conformance, setting type/range/enum checks, content-length and moderation checks, doc 15 / doc 11 §14) rather than as code, because nothing in the primary workflow produces code to validate in the first place. The full security model, including the untrusted-input handling below, is owned by doc 20; this section states only the framing specific to this layer:

- Content pulled from an arbitrary, merchant-supplied Product URL (doc 11 §4, Product Import) is untrusted input. When it's assembled into prompt context by the Context Selector (doc 12), it is wrapped in clearly delimited context blocks, never concatenated directly into the system prompt.
- The Gateway's system prompts explicitly instruct the model to treat imported product content as **data to reason about, not instructions to follow** — text embedded in, say, a scraped product description ("ignore previous instructions and...") must not be able to alter Planner behavior.
- Structured-output mode is preferred over free-form chat wherever the output feeds directly into an executable `Operation`, precisely because a schema-constrained response is far harder to hijack than free text.
- Because no AI output in the primary workflow is executable code, there is no code-execution attack surface analogous to the old architecture's generated-Liquid path. See doc 20 for the full threat model, including the one place (doc 11's Future / Advanced Architecture) where that would change if ever built.
