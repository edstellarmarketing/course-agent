/**
 * Curated OpenRouter model catalog.
 *
 * Phase 2 admins pick which slug fills each role; the engine reads the
 * active assignment at the start of every run. Slugs follow OpenRouter's
 * `<provider>/<model>` convention — see https://openrouter.ai/models for
 * the live list. If a slug 404s in production, OpenRouter usually has
 * a 1:1 successor under the same provider prefix.
 */

export type ModelRoleKey = "research" | "judge" | "regenerator";

export interface ModelRole {
  key: ModelRoleKey;
  label: string;
  description: string;
  /** Where in the architectural plan this role is invoked from. */
  usedBy: string;
}

export const MODEL_ROLES: ModelRole[] = [
  {
    key: "research",
    label: "Research model",
    description:
      "The heavy reasoning step. For each targeted category, this model reads the inventory + feedback context and proposes raw candidates.",
    usedBy: "§3.5 Research Agent",
  },
  {
    key: "judge",
    label: "Rule 10 judge",
    description:
      "Cheap, fast model that answers ‘does this course title reference a specific certification or governing body?’ Drops candidates that fail.",
    usedBy: "§3.6 Rule 10c",
  },
  {
    key: "regenerator",
    label: "Prompt regenerator",
    description:
      "Higher-tier model that reads a week of rejection patterns and proposes an improved system prompt. Runs weekly; outputs land in prompt_versions as candidates.",
    usedBy: "§3.8d Versioned prompt evolution",
  },
];

export type ModelTier = "value" | "balanced" | "frontier";

export interface LlmModel {
  slug: string;
  name: string;
  provider:
    | "DeepSeek"
    | "Anthropic"
    | "OpenAI"
    | "Google"
    | "Meta"
    | "Mistral"
    | "xAI";
  tier: ModelTier;
  roles: ModelRoleKey[];
  contextWindowK: number;
  description: string;
}

/**
 * Recommended defaults — DeepSeek for research and judge gives strong
 * reasoning at the lowest per-token cost. Opus 4.7 sits at the top for
 * the weekly prompt regeneration, where quality dominates cost.
 */
export const DEFAULT_MODEL_ASSIGNMENTS: Record<ModelRoleKey, string> = {
  research: "deepseek/deepseek-v3.2-exp",
  judge: "deepseek/deepseek-chat-v3.1",
  regenerator: "anthropic/claude-opus-4-7",
};

export const mockLlmModels: LlmModel[] = [
  // ─── DeepSeek (recommended defaults) ──────────────────────────────────
  {
    slug: "deepseek/deepseek-v3.2-exp",
    name: "DeepSeek V3.2 (experimental)",
    provider: "DeepSeek",
    tier: "balanced",
    roles: ["research", "regenerator"],
    contextWindowK: 128,
    description:
      "Latest DeepSeek MoE checkpoint. Strong long-form reasoning at value-tier pricing; routes through DeepSeek-direct or Together AI.",
  },
  {
    slug: "deepseek/deepseek-chat-v3.1",
    name: "DeepSeek Chat V3.1",
    provider: "DeepSeek",
    tier: "value",
    roles: ["judge", "research"],
    contextWindowK: 128,
    description:
      "Production-stable DeepSeek model. Cheapest competent option for the Rule 10 judge and per-category filters.",
  },
  {
    slug: "deepseek/deepseek-r1",
    name: "DeepSeek R1",
    provider: "DeepSeek",
    tier: "balanced",
    roles: ["research", "regenerator"],
    contextWindowK: 128,
    description:
      "Reasoning-tuned variant. Higher quality on multi-step research at the cost of more output tokens.",
  },

  // ─── Anthropic ────────────────────────────────────────────────────────
  {
    slug: "anthropic/claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "Anthropic",
    tier: "frontier",
    roles: ["research", "regenerator"],
    contextWindowK: 200,
    description:
      "Frontier-tier reasoning with strong instruction-following. Good fallback when DeepSeek output drifts off-format.",
  },
  {
    slug: "anthropic/claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    tier: "balanced",
    roles: ["judge"],
    contextWindowK: 200,
    description:
      "Anthropic's fast/cheap tier. Negligible latency for the certification-name judge; good when DeepSeek is rate-limited.",
  },
  {
    slug: "anthropic/claude-opus-4-7",
    name: "Claude Opus 4.7",
    provider: "Anthropic",
    tier: "frontier",
    roles: ["regenerator"],
    contextWindowK: 200,
    description:
      "Anthropic's flagship. Reserve for the weekly prompt regeneration where quality dominates per-call cost.",
  },

  // ─── OpenAI ───────────────────────────────────────────────────────────
  {
    slug: "openai/gpt-5",
    name: "GPT-5",
    provider: "OpenAI",
    tier: "frontier",
    roles: ["research", "regenerator"],
    contextWindowK: 200,
    description:
      "OpenAI's frontier model. Strong general reasoning; useful as the third pole in an A/B/C prompt test.",
  },
  {
    slug: "openai/gpt-5-mini",
    name: "GPT-5 mini",
    provider: "OpenAI",
    tier: "balanced",
    roles: ["judge", "research"],
    contextWindowK: 128,
    description:
      "Compact GPT-5 variant. Cheaper than Sonnet, slower than Haiku, broadly capable.",
  },

  // ─── Google ───────────────────────────────────────────────────────────
  {
    slug: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    tier: "frontier",
    roles: ["research", "regenerator"],
    contextWindowK: 1000,
    description:
      "Huge context window — useful when the per-category prompt includes the full rejection log without summarising.",
  },
  {
    slug: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    tier: "value",
    roles: ["judge"],
    contextWindowK: 1000,
    description:
      "Fast/cheap Gemini. Comparable judge quality to Haiku, with the huge context window if the rule check ever needs more evidence.",
  },

  // ─── Meta (open weights) ──────────────────────────────────────────────
  {
    slug: "meta-llama/llama-4-maverick",
    name: "Llama 4 Maverick",
    provider: "Meta",
    tier: "balanced",
    roles: ["research"],
    contextWindowK: 128,
    description:
      "Open-weights alternative. Worth running on a privacy-sensitive category where we want to keep proprietary data off vendor APIs.",
  },
];

/** Convenience accessor — returns null if no matching slug in the catalog. */
export function findModelBySlug(slug: string): LlmModel | null {
  return mockLlmModels.find((m) => m.slug === slug) ?? null;
}
