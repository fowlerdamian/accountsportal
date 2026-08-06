// Shared Anthropic model resolver.
//
// Why this exists: Anthropic model IDs are version-pinned (e.g. claude-sonnet-4-6
// never auto-advances to 4-7) and retired models return 404. Rather than hardcode
// a literal in every function, resolve it here:
//   • Normal changes  → set the ANTHROPIC_MODEL secret (one command, all functions).
//                       Haiku/Opus tiers override via ANTHROPIC_MODEL_HAIKU /
//                       ANTHROPIC_MODEL_OPUS.
//   • Surprise retiral → if the pinned model 404s out of the catalogue, auto-heal to
//                        the newest same-family model and log loudly.
//
// Result is cached per isolate per tier for 1h, so this adds at most one
// /v1/models call per cold start per tier.

export type ModelTier = "sonnet" | "haiku" | "opus";

const PINNED: Record<ModelTier, string> = {
  sonnet: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6",
  haiku: Deno.env.get("ANTHROPIC_MODEL_HAIKU") ?? "claude-haiku-4-5",
  opus: Deno.env.get("ANTHROPIC_MODEL_OPUS") ?? "claude-opus-4-8",
};

const cache: Partial<Record<ModelTier, { id: string; at: number }>> = {};

export async function resolveModel(apiKey: string, tier: ModelTier = "sonnet"): Promise<string> {
  const hit = cache[tier];
  if (hit && Date.now() - hit.at < 3_600_000) return hit.id; // 1h

  const pinned = PINNED[tier];
  try {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (r.ok) {
      const { data } = await r.json();

      // Pinned model still in the catalogue → use it.
      if (Array.isArray(data) && data.some((m: { id: string }) => m.id === pinned)) {
        cache[tier] = { id: pinned, at: Date.now() };
        return pinned;
      }

      // Pinned model retired → newest same-family alias (no YYYYMMDD date suffix).
      const best = (data ?? [])
        .filter((m: { id: string }) => m.id.startsWith(`claude-${tier}`) && !/\d{8}$/.test(m.id))
        .sort((a: { created_at: string }, b: { created_at: string }) =>
          b.created_at.localeCompare(a.created_at))[0];
      if (best) {
        console.warn(`[model] pinned "${pinned}" not in catalogue — falling back to "${best.id}"`);
        cache[tier] = { id: best.id, at: Date.now() };
        return best.id;
      }
    }
  } catch (e) {
    console.error("[model] resolve failed, using pinned:", (e as Error).message);
  }

  cache[tier] = { id: pinned, at: Date.now() };
  return pinned;
}
