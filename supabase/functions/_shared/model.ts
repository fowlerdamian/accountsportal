// Shared Anthropic model resolver.
//
// Why this exists: Anthropic model IDs are version-pinned (e.g. claude-sonnet-4-6
// never auto-advances to 4-7) and retired models return 404. Rather than hardcode
// a literal in every function, resolve it here:
//   • Normal changes  → set the ANTHROPIC_MODEL secret (one command, all functions).
//   • Surprise retiral → if the pinned model 404s out of the catalogue, auto-heal to
//                        the newest Sonnet-family model and log loudly.
//
// Result is cached per isolate for 1h, so this adds at most one /v1/models call
// per cold start.

const PINNED = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6";

let cache: string | null = null;
let cachedAt = 0;

export async function resolveModel(apiKey: string): Promise<string> {
  if (cache && Date.now() - cachedAt < 3_600_000) return cache; // 1h

  try {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (r.ok) {
      const { data } = await r.json();

      // Pinned model still in the catalogue → use it.
      if (Array.isArray(data) && data.some((m: { id: string }) => m.id === PINNED)) {
        cache = PINNED;
        cachedAt = Date.now();
        return PINNED;
      }

      // Pinned model retired → newest Sonnet alias (no YYYYMMDD date suffix).
      const best = (data ?? [])
        .filter((m: { id: string }) => m.id.startsWith("claude-sonnet") && !/\d{8}$/.test(m.id))
        .sort((a: { created_at: string }, b: { created_at: string }) =>
          b.created_at.localeCompare(a.created_at))[0];
      if (best) {
        console.warn(`[model] pinned "${PINNED}" not in catalogue — falling back to "${best.id}"`);
        cache = best.id;
        cachedAt = Date.now();
        return best.id;
      }
    }
  } catch (e) {
    console.error("[model] resolve failed, using pinned:", (e as Error).message);
  }

  cache = PINNED;
  cachedAt = Date.now();
  return PINNED;
}
