// The one-click rewrite actions offered on a selected section — the "Quick suggestions" and
// "Change angle" chips (docs/SECTION-AI-EDITING.md). Defined once and imported by both the
// editor UI (labels/grouping) and the rewrite API route (the instruction actually sent to
// the model), so a chip can never drift from what it does.

export interface RewritePreset {
  id: string;
  /** Icon key resolved to a Lucide component in AiRewritePopover (kept a plain string so this file stays server-safe). */
  icon: string;
  label: string;
  group: "quick" | "angle";
  /**
   * The short, human-phrased prompt a chip click fills into the popover's input for the
   * user to edit and submit. If they submit it unedited, the richer `instruction` below
   * is sent instead (via the preset id); if they edit it, their text is sent as typed.
   */
  prompt: string;
  /** The instruction handed to the section rewriter, exactly as a typed prompt would be. */
  instruction: string;
}

export const REWRITE_PRESETS: RewritePreset[] = [
  {
    id: "shorter",
    label: "Shorter",
    icon: "minus",
    group: "quick",
    prompt: "Make the texts shorter.",
    instruction:
      "Make the copy in this section noticeably shorter. Keep the meaning and the strongest claim; cut filler words, repeated ideas and secondary clauses.",
  },
  {
    id: "longer",
    label: "Longer",
    icon: "plus",
    group: "quick",
    prompt: "Make the texts longer with more detail.",
    instruction:
      "Expand the copy in this section with more concrete detail about the product — materials, use cases, practical benefits. Add substance, not filler.",
  },
  {
    id: "simplify",
    label: "Simplify",
    icon: "sparkles",
    group: "quick",
    prompt: "Simplify the language so it is easy to read.",
    instruction:
      "Rewrite the copy in this section in plain, simple language. Short sentences, everyday words, no jargon or marketing clichés.",
  },
  {
    id: "fix_spelling",
    label: "Fix spelling",
    icon: "spell-check",
    group: "quick",
    prompt: "Fix any spelling and grammar mistakes.",
    instruction:
      "Fix spelling, grammar, punctuation and capitalisation in this section's copy. Change nothing else — keep the tone, meaning, length and structure exactly as they are.",
  },
  {
    id: "emotional",
    label: "More emotional",
    icon: "heart",
    group: "angle",
    prompt: "Rewrite this section to make it more emotional and appealing.",
    instruction:
      "Rewrite this section's copy to lead with emotion: how it feels to own and use this product, the relief or joy it brings. Keep claims truthful to the product described.",
  },
  {
    id: "logical",
    label: "Logical benefits",
    icon: "diamond",
    group: "angle",
    prompt: "Focus on the logical, practical benefits of the product.",
    instruction:
      "Rewrite this section's copy to lead with concrete, rational benefits: specifications, durability, savings, practical outcomes. Minimal adjectives, maximal substance.",
  },
  {
    id: "social_proof",
    label: "Social proof",
    icon: "smile",
    group: "angle",
    prompt: "Emphasize social proof and customer trust.",
    instruction:
      "Rewrite this section's copy to lean on social proof: what customers love about it, how widely it is trusted. Phrase it credibly and never invent specific statistics, counts or named reviewers.",
  },
  {
    id: "urgency",
    label: "Urgency/Scarcity",
    icon: "alarm-clock",
    group: "angle",
    prompt: "Add urgency or scarcity to encourage action.",
    instruction:
      "Rewrite this section's copy to create urgency: limited availability, why acting now matters. Keep it plausible and grounded — no fabricated stock counts or fake deadlines in the copy.",
  },
  {
    id: "aspirational",
    label: "Aspirational",
    icon: "star",
    group: "angle",
    prompt: "Make the tone more aspirational and inspiring.",
    instruction:
      "Rewrite this section's copy to be aspirational: paint the better routine, space or identity this product enables. Sell the outcome, not the object.",
  },
  {
    id: "fomo",
    label: "FOMO",
    icon: "flame",
    group: "angle",
    prompt: "Create a sense of missing out for shoppers who wait.",
    instruction:
      "Rewrite this section's copy to emphasise what the shopper misses out on by not acting — the experience others are already enjoying. Keep it truthful and non-manipulative in specifics.",
  },
];

export function presetById(id: string): RewritePreset | undefined {
  return REWRITE_PRESETS.find((p) => p.id === id);
}
