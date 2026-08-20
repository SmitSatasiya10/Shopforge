# 22 — Billing & AI Usage Model

## 0. First principles, and where they still diverge from Dropmagic's

The earlier version of this document built its billing philosophy in direct opposition to Dropmagic: Dropmagic regenerates a store from scratch, so nearly every unit of activity is a generation event and a flat "pay for AI usage" meter roughly tracks its real compute cost, whereas Shopforge's old architecture resolved most real requests to a **structural** mutation of an arbitrary parsed merchant theme that never touched a generation model at execution time — so pricing tracked a per-operation-type credit cost, with structural free and generative metered.

That contrast doesn't hold cleanly anymore, and it's worth saying so plainly rather than quietly carrying old language forward. Per doc 01 §4, Shopforge's architecture has pivoted: it no longer parses an arbitrary existing theme and makes a minimal diff against it. It owns a **Base Theme** and a fixed **Section Library** (doc 07), and generates a new store from a product URL — product import/scrape → AI generation of section selection, ordering, settings, and copy → a **Store Configuration** (doc 08) → a LiquidJS preview → publish. That is, structurally, the same basic shape as Dropmagic's own documented workflow (doc 01 §4.1: "both products now take a product URL and generate a new Shopify store"). The old story — "we barely touch a generation model, they regenerate everything" — is no longer an accurate description of what Shopforge actually does. So the honest question for this document is the one doc 01 §4 already asks about positioning generally: given that we now do roughly what Dropmagic does architecturally, should our billing model converge with theirs too?

**Where convergence is warranted:** Dropmagic's free tier reportedly lets a user build and preview unlimited stores and gates only the ability to publish to a real Shopify store behind its single paid tier. That's a genuinely good idea independent of Dropmagic — the core "paste a URL, get a store" value moment is exactly what a prospective customer needs to experience before they'll pay for anything, and gating the highest-support-burden, highest-leverage action (writing to a merchant's live store) behind a billing relationship is sound regardless of who does it first. §1 below adopts that shape: Free can build and preview, only publish is tier-gated.

**Where it isn't:** two things Shopforge still has, and Dropmagic isn't documented as having, argue against fully converging to a flat "unlimited generation, meter nothing, gate only publish" model.

First, **AI Store Generation is now, honestly, our single largest and most variable per-action AI compute cost** — a chained pass of section selection, ordering, settings generation, and copy generation across every section and page a store ends up with, plus whatever image generation it triggers along the way (§3.1). That is exactly the action Dropmagic's own free tier apparently allows without limit, and we don't have (and shouldn't assume we have) the same unit economics or funding posture behind that choice — doc 02 §6 flags "unlimited free generation, cannot publish" as a self-reported/search-snippet claim, not something with disclosed cost data behind it, and Dropmagic's own free tier caps something as comparatively cheap as image generation at 2 credits/month, which suggests even Dropmagic doesn't treat every AI action as free to give away without limit. Making AI Store Generation itself credit-metered — even on Free, even generously — is the more defensible default until real usage data says otherwise, for the same cost-predictability reasoning that already drives the hard-stop-no-overage decision in §5.

Second, and more structurally: **Shopforge still has a real, ongoing AI-assisted editing loop after generation**, via the Visual Editor and AI-assisted conversational editing (doc 06, doc 11) — this isn't a one-shot builder that hands off to manual drag-and-drop the way Dropmagic's documented editor appears to (doc 02 §4 describes only a proprietary manual editor, no AI-editing capability in that loop). Within Shopforge's editing loop, the old distinction between a **structural** mutation (a deterministic write to the Store Configuration — reorder a section, swap in one that already exists, change a setting value) and a **generative** action (an actual model call — regenerate a section's settings and copy, regenerate one field's copy, generate an image) is still completely real. It isn't an artifact of the old parsed-theme architecture; it's a general fact about any system that mixes deterministic data writes with inferential generation, and it's still the more honest way to price actual marginal cost per action. A merchant asking the AI to "make the hero heading bigger" is not spending anything close to the compute of "regenerate this section's copy for a punchier tone," which in turn isn't close to "generate my whole store." Collapsing that into one flat meter — the Dropmagic-style binary — would either overcharge cheap structural chat requests or underprice expensive regenerations; keeping the per-action-type table in §3 preserves a cost lever Shopforge has real information for and Dropmagic likely doesn't need, because it isn't documented as having the same editing-loop surface at all.

So the model below converges with Dropmagic on **what gets gated** — publish, not the ability to try the product — and stays deliberately apart from it on **how AI usage inside that experience is priced**: metered by credits, differentiated by action type, not a flat unlimited allowance. Free is broadened from the old model's "generative locked entirely" (§1) to "AI Store Generation available, credit-limited" — closer to Dropmagic's openness at the front door — while the per-action credit table in §3, and the structural/generative split behind it, is retargeted to the new operation vocabulary but not abandoned.

---

## 1. Plan Tiers

| Tier | Indicative price | Publishable connected stores | Seats | AI credits / month | Publish access | Support |
|---|---|---|---|---|---|---|
| **Free** | $0 | 0 (build & preview only; connecting a store for publish requires a paid tier) | 1 | 50 | Locked — build, generate, and preview only | Community/self-serve |
| **Starter** | $19/mo | 1 | 2 | 300 | Unlocked | Standard email (~48h) |
| **Growth** | $59/mo | 3 | 5 | 1,200 | Unlocked, standard queue priority | Priority chat/email |
| **Agency** | $199/mo | 25 (soft cap, contact sales beyond) | Unlimited | 5,000, pooled across all connected stores | Unlocked, highest queue priority | Dedicated support + onboarding |

Notes on the design of the tiers, not just the numbers:

- **Free is deliberately not a crippled trial, and it's now generation-forward rather than generation-locked.** 50 credits/month is enough to run a full AI Store Generation pass (25 credits, §3.1) and still have room for a section regeneration or a few copy regenerations, or two full generations against different products. A merchant can experience the actual core product — paste a product URL, watch a real store get built and rendered in the real LiquidJS preview — without ever paying, which is a stronger conversion story than a time-limited trial and mirrors the part of Dropmagic's own free tier worth adopting (§0). What's still gated is publishing that store to a real Shopify connection, not the AI generation that makes the product legible in the first place.
- **Publish access is gated by tier, not only by credit balance.** This isn't a technical necessity — a credit-balance gate alone would work — it's a deliberate product/support decision: writing to a merchant's live, real Shopify store is the highest-leverage, highest-support-burden action in the system, and keeping it behind a paid tier ties that surface's usage to an account we have a billing/support relationship with. This is the same underlying reasoning the old model applied to generative-op access; it's just been retargeted to the action that actually carries that risk under the new architecture, which is publish, not generation.
- **Seats/roles** scale with tier because collaboration is a Growth/Agency-shaped need (an in-house team or a client-services agency), not a solo-merchant one; roles (owner/admin/editor/viewer, per `OrgMembership`) are available at every paid tier, just capped in count on Starter.
- **Agency's pooled credits** reflect that an agency's value unit is "a client engagement" — one AI Store Generation pass per client store, plus ongoing edits — which doesn't map cleanly to any single store; pooling avoids forcing agencies to micromanage per-store allotments across a portfolio of client stores.

---

## 2. What is never paywalled

The following are **free on every tier, including Free, with no credit cost and no rate-based upsell pressure**:

| Capability | Why it must never be paywalled |
|---|---|
| **Product Import / Scrape** — pasting a product URL and getting back structured Product Data | This is the entry point to the entire product. A merchant needs to try the very first step — see that we can actually read their product — with zero commitment before spending a single credit on anything downstream. Charging for the on-ramp would suppress the exact trial behavior Free exists to enable (also priced at 0 in §3.1). |
| **All structural editing operations** (add an already-existing section from the library, remove a section, reorder/move a section, duplicate a section) | This *is* the core editing surface of the product. These are deterministic writes to the Store Configuration — no AI generation happens at execution time — and paywalling the majority of everyday editing would paywall the majority of the product. |
| **Direct content edits a merchant makes themselves** — typing their own text into a field, uploading their own image, picking a color, adjusting typography or spacing values by hand | This is manual authorship, not AI generation. The merchant is doing the work, not the model; charging for typing into your own store would be paywalling basic ownership of the thing being built. This is the line that separates it from AI Copy/Section Regeneration in §3.1, where the AI — not the merchant — is doing the generating. |
| **Previews** | A merchant must be able to see any pending change — AI-proposed or self-authored — rendered in the real LiquidJS preview before committing to it, with zero friction. Charging to *look* at a change would suppress the cautious, trust-building behavior the preview exists to enable. |
| **Undo / revert-single-operation** | Reversibility is a safety guarantee, not a premium feature. Monetizing the safety net creates a perverse incentive for a nervous merchant to avoid using it. |
| **Visual editor usage** | The Visual Editor mutates the same Store Configuration through the same structural operations the AI issues when it resolves a request structurally (doc 06, doc 11). Since AI-issued structural ops are free, human-issued structural edits through the Visual Editor must be free too — treating the two authorship paths differently would be inconsistent with the architecture's design. |

One row from the old version of this table is deliberately dropped rather than translated: **baseline theme parsing/re-sync**. That row existed because the old architecture derived a Theme Manifest from an arbitrary merchant theme and had to keep it mechanically in sync. Under the new architecture there is no arbitrary theme to parse or stay in sync with — the Store Configuration is authored directly by AI generation and the merchant, never derived or silently regenerated (doc 08 §1) — so there's nothing left in that category to price or exempt.

---

## 3. Credit Cost Table

### 3.1 AI action types

The naming below follows the AI generation and editing operation vocabulary described conceptually in this document (doc 11 owns the authoritative spelling of individual operation types as that document is finalized) and the Section Library / Store Configuration model in doc 07 / doc 08. Nothing here assumes a specific `OperationType` enum from a prior architecture-core document — that document doesn't exist in this repository and shouldn't be cited.

| AI action type | What it does | Credit cost | Reasoning |
|---|---|---|---|
| **Product Import / Scrape** | Fetches one product URL and extracts structured Product Data (title, images, price, description, specs, reviews) | **0** | Mechanical fetch plus light, largely deterministic structured extraction — no meaningful generative inference happens here. Kept free so a merchant can try the product's entry point with zero commitment; see §2. |
| **AI Store Generation** | The full initial generation pass: section selection, section ordering, settings generation, and copy generation across every page of a new store, grounded in the imported Product Data | **25** | The flagship action, and by design the single biggest per-call AI compute cost in the system — it chains a section-selection pass, a per-page ordering pass, and settings/copy generation across every section instance the store ends up with. This is the action that plays the same role in Shopforge's cost model that Dropmagic's core "generate my store" action plays in theirs (§0) — which is exactly why it's priced as the dominant, expected cost driver rather than treated as a rare fallback the way the old model's generative ops were. This price covers text/structure only; if the generation pass also produces images (e.g. lifestyle shots, enhanced product photos), each is billed separately under Image Generation/Enhancement below, which is why this action is reserved-then-settled (§4.1) rather than debited as a single flat charge — its true cost is genuinely variable depending on how many sections, pages, and images the result needs. |
| **AI Section Regeneration** | Re-runs section selection/settings/copy generation for one existing section in place, leaving the rest of the store untouched | **4** | Same generation machinery as AI Store Generation, scoped to a single section — roughly what one section's share of a full pass costs. Used when a merchant likes most of a generated store but wants another AI attempt at one section specifically (e.g. "try a different hero"). |
| **AI Copy Regeneration** | Re-runs copy generation only, for one field or one section's copy, with section choice and settings unchanged | **2** | The narrowest generative surface in the system — a single lightweight LLM call against existing context (the section, its current settings, the underlying product data), with no section-selection or settings-schema reasoning involved. |
| **AI-Assisted Conversational Editing** | A chat-issued request that resolves to a structural edit against the Store Configuration — e.g. "make the hero heading bigger," "move reviews above the FAQ," "swap this for a testimonial section" | **0** | The request arrives through the AI chat surface, but when it resolves to a structural mutation — a setting value, an ordering change, swapping in a section type that already exists in the library — nothing was generated; it's billed exactly like the same edit made by hand in the Visual Editor, because it's the same write against the same Store Configuration (see §2's "Visual editor usage" reasoning). If a conversational request *can't* resolve structurally and genuinely requires the AI to generate new settings or copy (e.g. "rewrite this headline to sound more urgent"), it's billed once, under AI Copy Regeneration or AI Section Regeneration above — never stacked on top of this row. |
| **Image Generation / Enhancement** | One AI-generated or AI-enhanced image, whether produced automatically as part of AI Store Generation or requested standalone in the editor | **10** | Direct pass-through of a genuinely expensive third-party image-generation API call — still the single most expensive per-call cost driver in the system, unchanged in relative weight from the old model. Billed per image regardless of whether it happens inside a generation pass or on its own. |

### 3.2 Other AI actions

| Action | Credit cost | Reasoning |
|---|---|---|
| Chat message / analysis that produces **no** operation ("what sections are on my homepage?", "why did you pick this hero image?") | **0** | Encourages exploration and builds trust in the assistant before any commitment; compute cost is low (short context + short completion) and controlled by a rate limit rather than a credit meter, so it can stay free without being abusable. |
| Full plan / clarification pass for a complex multi-step request (e.g. "refresh my About page and its images to match a new brand tone") | **3 flat** | The planning/reasoning pass itself, independent of what it recommends. Kept low and flat so merchants aren't discouraged from asking for a plan before committing — but not free, so planning can't be used to repeatedly extract heavy reasoning output for nothing. **Executing** the plan's individual steps is billed per-action, per §3.1, only on approval — never double-charged with the planning fee. |

Two rows from the old version of this table are deliberately not carried forward, rather than force-mapped onto something that doesn't fit:

- **"Section code generation, invoked standalone"** doesn't have an equivalent anymore. The AI never authors Liquid, CSS, or JS under the current architecture, in preview or otherwise — every section's code is fixed, first-party library code (doc 07). There is no generative-code-preview action left to price.
- **"Theme re-analysis — deep AI-enhanced pass"** also doesn't translate directly. That action existed to re-enrich a capability manifest derived from an arbitrary parsed merchant theme via embeddings; Shopforge no longer parses an arbitrary theme or maintains that kind of manifest at all (doc 07 §1, doc 08 §1). The closest available levers for "I want the AI to take another, deeper pass" are already priced above: re-running AI Store Generation for a full redo, or AI Section/Copy Regeneration for a narrower one. No separate "deep re-analysis" tier is needed because there's no manifest left to re-analyze.

---

## 4. Usage Tracking

Every credit-consuming action — every row in §3.2, and every AI action in §3.1 — writes one **`AIUsageEvent`** at the moment of charge, carrying at minimum: the acting user/org/store, the action type, the `creditsCharged`, a timestamp, and provider/model metadata sufficient for internal cost reconciliation against the actual third-party API bill.

`AIUsageEvent` is the append-only ledger; **`CreditBalance`** is the derived, current-balance projection per organization (or per pooled-org for Agency), decremented atomically inside the same transaction that writes the usage event, to prevent a race where two concurrent generative requests both pass a pre-flight balance check against a stale balance.

Structural operations and free actions (§2, and the `0`-cost rows in §3) still get a lightweight `AIUsageEvent` for telemetry and product-analytics purposes (this is how we validate assumptions like "most post-generation editing is structural, not regenerative" behind the whole model), but with `creditsCharged: 0` and no `CreditBalance` mutation — they never touch the billing path.

### 4.1 Reserve-then-settle for variable-cost generative actions

Because a generative action's actual compute cost can vary — most notably AI Store Generation, whose cost depends on how many sections, pages, and images the result ends up needing, but also AI Section Regeneration and AI Copy Regeneration to a lesser degree — charging happens in two steps:

1. **Reserve**, pre-flight, at the estimated credit cost shown to the merchant in the AI's proposed plan before they approve execution — no surprise cost after the fact.
2. **Settle**, post-flight, against actual measured cost, within a capped variance band (e.g. ±20% of the estimate). Settling down refunds the difference to `CreditBalance` immediately; settling up beyond the cap does **not** silently charge more — it's absorbed as platform cost and logged for cost-estimation tuning, never surfaced as a surprise deduction to the merchant.

This mirrors an auth-and-capture pattern deliberately: it lets us block execution before an expensive call is made when a merchant can't afford it (§5), without ever debiting more than what was quoted at approval time. This matters more, not less, under the new architecture — AI Store Generation's variable image count (§3.1) makes its true cost genuinely unpredictable up front in a way the old model's per-file generative ops mostly weren't.

Fixed-cost actions — Product Import/Scrape, AI-Assisted Conversational Editing that resolves structurally, and every `0`-cost row — skip reserve-then-settle entirely; there's no variance to settle when the cost is fixed at zero.

---

## 5. Overage Handling

**Decision for v1: hard stop, with optional pre-purchased top-up packs. No automatic overage billing.**

When a generative action's reserved cost (§4.1) would exceed the current `CreditBalance` — an AI Store Generation, a section or copy regeneration, or an image generation/enhancement — the action is blocked **before** any third-party AI compute is invoked (structural ops, previews, undo, and Product Import/Scrape are of course unaffected — they're never gated, per §2). The user is offered two paths: wait for the next monthly reset, or buy a one-time top-up credit pack immediately.

Reasoning:

- **Cost predictability.** Shopforge pays real, metered third-party bills for LLM and image-generation compute. Automatic overage billing means our own infra cost is directly exposed to unbounded per-merchant usage with only after-the-fact reconciliation — a hard stop keeps our cost exposure bounded by design, which matters most while the business is still small enough that one runaway account (or, per §0, one Free account leaning hard on repeated full-store generations) could be a meaningful line item.
- **No bill shock.** SMB Shopify merchants and dropshippers are the core early audience, and an unexpected overage charge on a monthly SaaS bill is a disproportionately trust-damaging experience relative to the revenue it recovers. A hard stop with a clear, opt-in top-up purchase keeps every charge something the merchant explicitly chose.
- **Simplicity.** V1 does not need dunning, mid-cycle invoice adjustments, or usage-based billing reconciliation infrastructure — a hard stop plus a simple one-time purchase (same mechanics as the credit pack itself) is dramatically less to build and to support correctly at launch.
- **Revenue isn't left on the table.** A merchant who hits their cap is, by definition, a merchant getting real value from AI generation — exactly who top-up packs (and tier upgrades) are aimed at monetizing, without us taking on open-ended billing liability to do it.

This is revisited post-v1 once there's enough real usage-pattern data to price soft-overage safely; hard stop is the correct conservative default to launch with, not a permanent architectural commitment.

---

## 6. Subscription Lifecycle

### 6.1 Upgrade / downgrade / cancel

| Event | Behavior |
|---|---|
| **Upgrade** (e.g. Starter → Growth) | Takes effect immediately. `CreditBalance` is topped up immediately by the prorated difference between the new and old tier's monthly allotment for the remainder of the current billing cycle, so the merchant gets the benefit right away rather than waiting for the next cycle. |
| **Downgrade** (e.g. Growth → Starter) | Takes effect at the **end of the current billing cycle**, not immediately. This is the standard SaaS-safe pattern and is deliberate here specifically because credits are the metered unit: allowing an immediate downgrade would let a merchant buy a high tier, burn the large allotment, then immediately downgrade before paying the higher price again next cycle — end-of-cycle downgrade closes that gap. |
| **Cancel** | Access continues through the end of the paid period (same as downgrade timing), after which the org reverts to Free-tier behavior: **already-published stores are never disconnected, un-published, or reverted as a punitive measure** — the merchant's Base Theme keeps serving traffic through Shopify's own Liquid engine regardless of Shopforge subscription status, since it was never a runtime dependency on our servers (doc 01 §4.2) to begin with. What locks is publish access for *further* changes (per §1) and generative credits reset to the Free allotment; any remaining unused monthly-allotment credits are forfeited (see rollover policy below) while purchased top-up credits, if any, remain usable. |

### 6.2 Credit rollover policy

**Decision: monthly plan-included credits do not roll over and expire at cycle end; purchased top-up credit packs never expire.**

Reasoning: plan-included credits are priced into the subscription as a monthly allotment, and treating them like a use-it-or-lose-it utility (mirroring how most metered-SaaS credit systems work) keeps our cost forecasting clean — we know that at most one month's worth of generative-compute liability is outstanding against any subscription at a time, which matters for the same infra-cost-predictability reason behind the hard-stop decision in §5. Top-up packs are treated differently because they're a direct one-time cash purchase rather than a bundled subscription entitlement — a merchant who pays for a specific number of credits has a reasonable expectation that it behaves like a wallet, not a subscription perk, so those never expire and are drawn down only after the current cycle's plan-included allotment is exhausted (plan credits are always consumed first, to keep the non-expiring wallet balance a true reflection of "credits we still owe regardless of subscription status").

This is a deliberate choice over a goodwill-rollover model (e.g. carrying forward up to 20% of unused monthly credits): goodwill rollover is friendlier to light-usage months, but it reintroduces exactly the unbounded/creeping liability problem the hard-stop-no-automatic-overage decision in §5 is designed to avoid, and it's straightforward to introduce later as a retention lever (e.g. targeted at at-risk accounts) without it being a load-bearing part of the v1 pricing model.
