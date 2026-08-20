# 22 — Billing & AI Usage Model

## 0. First principles, not Dropmagic's model

Dropmagic's cost driver is structural: it regenerates a store from scratch, so essentially every unit of user activity is a generation event, and a flat "pay for AI usage" or "pay per store" model roughly tracks its actual compute cost.

Shopforge's cost driver is fundamentally different, by design (Principle 2: reuse existing capabilities; Principle 3: minimal AI generation). For a large share of real requests — recolor this, move that section, add this existing block, hide that on mobile — the Operation Planner resolves to a **structural** operation that never calls a generation model at execution time. Only when no existing capability satisfies the request does the planner fall back to a **generative** operation (`create_section_file`, `modify_liquid`, `modify_css`, `modify_js`), which is where our real marginal AI compute cost lives.

If we priced like Dropmagic — flat unlimited-AI subscription, or a single "AI usage" meter — we'd mis-price in both directions: merchants who mostly do structural edits (the majority, and the exact behavior we want to encourage) would be subsidizing merchants who lean on heavy generative edits, and we'd have no cost lever tied to what's actually expensive to run. So the model below is built the other way around: **price tracks the `estimatedCreditCost` already defined per `OperationType` in the architecture core (§3), which in turn tracks real marginal AI compute cost** — structural is (and stays) free, generative is metered, and the plan tiers exist to bundle predictable monthly credit allotments plus the collaboration/scale features (seats, stores) around that core metering unit.

---

## 1. Plan Tiers

| Tier | Indicative price | Connected stores | Seats | AI credits / month | Generative-op access | Support |
|---|---|---|---|---|---|---|
| **Free** | $0 | 1 | 1 | 0 (generative locked) | Locked — structural + chat only | Community/self-serve |
| **Starter** | $19/mo | 1 | 2 | 300 | Unlocked | Standard email (~48h) |
| **Growth** | $59/mo | 3 | 5 | 1,200 | Unlocked, standard queue priority | Priority chat/email |
| **Agency** | $199/mo | 25 (soft cap, contact sales beyond) | Unlimited | 5,000, pooled across all connected stores | Unlocked, highest queue priority | Dedicated support + onboarding |

Notes on the design of the tiers, not just the numbers:

- **Free is deliberately not a crippled trial.** Because most of Shopforge's everyday value (Principle 1/2 in action) is structural — reflow, restyle, rearrange, swap existing blocks — a Free user can accomplish a large share of realistic requests with zero AI credits and zero generative-op access. This is intentional: it lets a merchant experience the core "minimal, safe edits" promise fully before ever hitting a paywall, which is a stronger conversion story than a time-limited trial and costs us nothing in AI compute since Free has no generative access.
- **Generative-op access is gated by tier, not only by credit balance**, specifically on Free. This isn't a technical necessity (a credit-balance gate alone would work), it's a deliberate product/support decision: generative output (new Liquid/CSS/JS) is the highest-risk, highest-support-burden surface (highest `riskLevel`, requires the full validation pipeline from doc 15), and gating it behind a paid tier keeps that surface's usage tied to an account we have billing/support relationship with.
- **Seats/roles** scale with tier because collaboration is a Growth/Agency-shaped need (an in-house team or a client-services agency), not a solo-merchant one; roles (owner/admin/editor/viewer, per `OrgMembership`) are available at every paid tier, just capped in count on Starter.
- **Agency's pooled credits** reflect that an agency's value unit is "a client engagement," which doesn't map cleanly to any single store — pooling avoids forcing agencies to micromanage per-store allotments across a portfolio of client stores.

---

## 2. What is never paywalled

Per Principle 9 (cost-aware AI) and Principle 6 (everything is reversible), the following are **free on every tier, including Free, with no credit cost and no rate-based upsell pressure**:

| Capability | Why it must never be paywalled |
|---|---|
| **All structural operations** (`update_setting`, `update_block_setting`, `add_section`, `remove_section`, `move_section`, `duplicate_section`, `add_block`, `remove_block`, `reorder_block`, `update_global_style`, `update_theme_setting`, `update_asset`) | This *is* the core product differentiator (Principle 1/2). Paywalling the majority of everyday edits would paywall the majority of the product and directly contradict "minimal AI generation" — if merchants have to reach for a credit-consuming path to do routine edits, we've quietly become Dropmagic-shaped. |
| **Previews** | A merchant must be able to see any pending change — AI-proposed or self-authored — before committing to it, with zero friction. Charging to *look* at a change would suppress the exact cautious behavior (Principle 4, Principle 6) we're trying to build trust around. |
| **Undo / revert-single-operation** | Reversibility (Principle 6) is a safety guarantee, not a premium feature. Monetizing the safety net creates a perverse incentive for a nervous merchant to avoid using it. |
| **Baseline theme parsing / re-sync** | Keeping the Manifest and Model in sync with the actual Shopify theme is table stakes for the product to function at all — closer to "the app being able to boot" than to a feature. This is the mechanical, static-rule-based parse/re-sync; see §3.2 for the one deliberately-priced exception (deep AI-enhanced re-analysis). |
| **Visual editor usage** | The visual editor mutates the same `ThemeModel` through the same mutation functions as the AI (Principle 7). Since AI-issued structural ops are free, human-issued structural edits through the visual editor must be free too — treating the two authorship paths differently would be inconsistent with the architecture's core design.

---

## 3. Credit Cost Table

### 3.1 Operation types (from architecture core §3)

| `OperationType` | `requiresNewCode` | Typical `riskLevel` | Credit cost | Reasoning |
|---|---|---|---|---|
| `update_setting` | false | safe | **0** | Pure write of an existing, schema-defined setting value. No inference at execution time. |
| `update_block_setting` | false | safe | **0** | Same as above, scoped to a block instance. |
| `add_section` | false | safe | **0** | Reuses an existing section type/preset already compiled into the theme; no new code generated. |
| `remove_section` | false | safe/review | **0** | Structural removal; fully reversible via undo, no generation involved. |
| `move_section` | false | safe | **0** | Pure reordering. |
| `duplicate_section` | false | safe | **0** | Copies an existing instance's settings/blocks; no generation. |
| `add_block` | false | safe | **0** | Reuses an existing block type already defined in the section's schema. |
| `remove_block` | false | safe | **0** | Structural. |
| `reorder_block` | false | safe | **0** | Structural. |
| `update_global_style` | false | safe | **0** | Still a `settings_data` write, even though theme-wide in effect. |
| `update_theme_setting` | false | safe | **0** | Structural. |
| `update_asset` | false | safe/review | **0*** | Swapping an asset *reference* is structural. *If the new asset must first be AI-generated, that generation is billed once under "image generation" in §3.2 — the swap operation itself is never billed a second time. |
| `create_section_file` | **true** | review | **15** | Full new Liquid partial + `schema.json`, generated and self-reviewed across multiple model passes, then run through the entire validation pipeline (doc 15). Highest scrutiny, highest cost driver of any op. |
| `modify_liquid` | **true** | review | **8** | Targeted diff against an existing file's real context; still generative and still runs the full validation pipeline, but smaller scope than a net-new file. |
| `modify_css` | **true** | review | **4** | Narrowest, cheapest generative surface — typically short diffs, lower token cost, lighter validation surface than Liquid. |
| `modify_js` | **true** | review | **6** | Narrower than a full section, but behavioral/interactivity risk justifies more validation/self-check passes than CSS, hence priced above `modify_css`. |

### 3.2 Other AI actions

| Action | Credit cost | Reasoning |
|---|---|---|
| Chat message / analysis that produces **no** operation ("what sections does my theme have?", "why did you suggest that?") | **0** | Encourages exploration and builds trust in the assistant before any commitment; compute cost is low (short context + short completion) and is controlled by a rate limit rather than a credit meter, so it can stay free without being abusable. |
| Copy generation (headline/product description text, no code) | **2** | A single, lightweight LLM call with no validation pipeline attached — priced well below any code-touching op. |
| Image generation | **10** | Direct pass-through of a genuinely expensive third-party image-generation API call — the single most expensive per-call cost driver in the system, priced accordingly. |
| Section code generation, invoked standalone (e.g. "just show me what the code would look like" without committing) | **15** | Same cost driver as `create_section_file` — it *is* that operation's generation step, just previewed before commit; priced identically to avoid an exploit where users repeatedly "preview" for free. |
| Full plan generation for a complex multi-step request (Principle 5) | **3 flat** | The planning/reasoning pass itself, independent of what it recommends. Kept low and flat so merchants aren't discouraged from asking for a plan before committing (which is exactly the cautious behavior we want) — but not free, so planning can't be used as a way to repeatedly extract heavy reasoning output for free. **Executing** the plan's individual steps is billed per-step, per the tables above, only on approval — never double-charged with the planning fee. |
| Theme re-analysis — user-triggered **deep / AI-enhanced** pass (embedding-based capability enrichment beyond the static rule engine) | **5** | Compute-heavy (embeds all sections/snippets/settings) but non-generative. This is deliberately distinct from baseline parsing/re-sync (§2, always free): the free path keeps the Manifest mechanically correct after any file change; this paid path is an optional, deeper semantic pass a merchant can trigger when they want sharper AI capability-matching (e.g. after a lot of manual Liquid edits made outside Shopforge) — the *ability to use the product* stays free, the *optional depth upgrade* is metered. |

---

## 4. Usage Tracking

Every credit-consuming action — every row in §3.2, and every generative operation in §3.1 — writes one **`AIUsageEvent`** at the moment of charge, carrying at minimum: the acting user/org/store, the action or `OperationType`, the `creditsCharged`, a timestamp, and provider/model metadata sufficient for internal cost reconciliation against the actual third-party API bill.

`AIUsageEvent` is the append-only ledger; **`CreditBalance`** is the derived, current-balance projection per organization (or per pooled-org for Agency), decremented atomically inside the same transaction that writes the usage event, to prevent a race where two concurrent generative requests both pass a pre-flight balance check against a stale balance.

Structural operations and free actions (§2, and the `0`-cost rows in §3) still get a lightweight `AIUsageEvent` for telemetry and product-analytics purposes (this is how we validate the "most requests are structural" thesis behind the whole model), but with `creditsCharged: 0` and no `CreditBalance` mutation — they never touch the billing path.

### 4.1 Reserve-then-settle for variable-cost generative ops

Because a generative op's actual compute cost can vary (e.g. a `modify_liquid` diff that ends up larger than the planner estimated), charging happens in two steps:

1. **Reserve**, pre-flight, at the `estimatedCreditCost` from the `Operation` (this is also what's shown to the user in the Operation Plan before they approve execution — no surprise cost after the fact).
2. **Settle**, post-flight, against actual measured cost, within a capped variance band (e.g. ±20% of the estimate). Settling down refunds the difference to `CreditBalance` immediately; settling up beyond the cap does **not** silently charge more — it's absorbed as platform cost and logged for planner cost-estimation tuning, never surfaced as a surprise deduction to the merchant.

This mirrors an auth-and-capture pattern deliberately: it lets us block execution before an expensive call is made when a merchant can't afford it (§5), without ever debiting more than what was quoted at approval time.

---

## 5. Overage Handling

**Decision for v1: hard stop, with optional pre-purchased top-up packs. No automatic overage billing.**

When a generative action's reserved cost (§4.1) would exceed the current `CreditBalance`, the action is blocked **before** any third-party AI compute is invoked (structural ops, previews, and undo are of course unaffected — they're never gated, per §2). The user is offered two paths: wait for the next monthly reset, or buy a one-time top-up credit pack immediately.

Reasoning:

- **Cost predictability.** Shopforge pays real, metered third-party bills for LLM and image-generation compute. Automatic overage billing means our own infra cost is directly exposed to unbounded per-merchant usage with only after-the-fact reconciliation — a hard stop keeps our cost exposure bounded by design, which matters most while the business is still small enough that one runaway account could be a meaningful line item.
- **No bill shock.** SMB Shopify merchants are the core early audience, and an unexpected overage charge on a monthly SaaS bill is a disproportionately trust-damaging experience relative to the revenue it recovers. A hard stop with a clear, opt-in top-up purchase keeps every charge something the merchant explicitly chose.
- **Simplicity.** V1 does not need dunning, mid-cycle invoice adjustments, or usage-based billing reconciliation infrastructure — a hard stop plus a simple one-time purchase (same mechanics as the credit pack itself) is dramatically less to build and to support correctly at launch.
- **Revenue isn't left on the table.** A merchant who hits their cap is, by definition, a merchant getting real value from generative features — exactly the user top-up packs (and tier upgrades) are aimed at monetizing, without us taking on open-ended billing liability to do it.

This is revisited post-v1 once there's enough real usage-pattern data to price soft-overage safely; hard stop is the correct conservative default to launch with, not a permanent architectural commitment.

---

## 6. Subscription Lifecycle

### 6.1 Upgrade / downgrade / cancel

| Event | Behavior |
|---|---|
| **Upgrade** (e.g. Starter → Growth) | Takes effect immediately. `CreditBalance` is topped up immediately by the prorated difference between the new and old tier's monthly allotment for the remainder of the current billing cycle, so the merchant gets the benefit right away rather than waiting for the next cycle. |
| **Downgrade** (e.g. Growth → Starter) | Takes effect at the **end of the current billing cycle**, not immediately. This is the standard SaaS-safe pattern and is deliberate here specifically because credits are the metered unit: allowing an immediate downgrade would let a merchant buy a high tier, burn the large allotment, then immediately downgrade before paying the higher price again next cycle — end-of-cycle downgrade closes that gap. |
| **Cancel** | Access continues through the end of the paid period (same as downgrade timing), after which the org reverts to Free-tier behavior: connected stores remain connected (never disconnected as a punitive measure — Principle 1's "preserve the existing theme" extends to not orphaning a merchant's live store), generative access locks per §1, and any remaining unused monthly-allotment credits are forfeited (see rollover policy below) while purchased top-up credits, if any, remain usable. |

### 6.2 Credit rollover policy

**Decision: monthly plan-included credits do not roll over and expire at cycle end; purchased top-up credit packs never expire.**

Reasoning: plan-included credits are priced into the subscription as a monthly allotment, and treating them like a use-it-or-lose-it utility (mirroring how most metered-SaaS credit systems work) keeps our cost forecasting clean — we know that at most one month's worth of generative-compute liability is outstanding against any subscription at a time, which matters for the same infra-cost-predictability reason behind the hard-stop decision in §5. Top-up packs are treated differently because they're a direct one-time cash purchase rather than a bundled subscription entitlement — a merchant who pays for a specific number of credits has a reasonable expectation that it behaves like a wallet, not a subscription perk, so those never expire and are drawn down only after the current cycle's plan-included allotment is exhausted (plan credits are always consumed first, to keep the non-expiring wallet balance a true reflection of "credits we still owe regardless of subscription status").

This is a deliberate choice over a goodwill-rollover model (e.g. carrying forward up to 20% of unused monthly credits): goodwill rollover is friendlier to light-usage months, but it reintroduces exactly the unbounded/creeping liability problem the hard-stop-no-automatic-overage decision in §5 is designed to avoid, and it's straightforward to introduce later as a retention lever (e.g. targeted at at-risk accounts) without it being a load-bearing part of the v1 pricing model.
