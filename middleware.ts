/**
 * Vercel Edge Middleware — Guide subdomain title injection
 *
 * For requests on guide.* subdomains (e.g. guide.trailbait.com.au/:slug),
 * fetch the guide title + description from Supabase and inject them into
 * the <title> and OG meta tags before the HTML is served.
 *
 * This fixes both:
 *  - Browser tab showing "Staff Portal" before React hydrates
 *  - Link-preview crawlers (WhatsApp, Slack, iMessage) reading the wrong title
 */

const BYPASS_HEADER = "x-middleware-bypass";

export const config = {
  matcher: "/:path*",
};

export default async function middleware(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);

  // Only run on guide subdomains
  if (!url.hostname.startsWith("guide.")) return undefined;

  // Skip asset requests (JS, CSS, images, fonts…)
  if (/\.\w{2,5}$/.test(url.pathname)) return undefined;

  // Avoid infinite loop when we fetch index.html from ourselves
  if (request.headers.get(BYPASS_HEADER) === "1") return undefined;

  // ── Resolve slug from path ────────────────────────────────────
  const slug = url.pathname.replace(/^\//, "").split("/")[0] ?? "";

  // ── Fetch guide metadata from Supabase ────────────────────────
  let guideTitle = "";
  let guideDesc  = "";
  let guideImage = "";

  if (slug) {
    try {
      const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "";
      const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
        ?? process.env.VITE_SUPABASE_ANON_KEY
        ?? "";

      const apiRes = await fetch(
        `${supabaseUrl}/rest/v1/instruction_sets?slug=eq.${encodeURIComponent(slug)}&select=title,short_description,product_image_url&limit=1`,
        {
          headers: {
            apikey:        supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            Accept:        "application/json",
          },
        }
      );

      if (apiRes.ok) {
        const rows = await apiRes.json();
        const g = rows?.[0];
        if (g) {
          guideTitle = g.title        ?? "";
          guideDesc  = g.short_description ?? "";
          guideImage = g.product_image_url ?? "";
        }
      }
    } catch {
      // Silently fall through — serve the unmodified HTML
    }
  }

  // ── Fetch base index.html (with bypass header to skip this middleware) ──
  const indexRes = await fetch(new URL("/index.html", request.url).href, {
    headers: { [BYPASS_HEADER]: "1" },
  });

  if (!indexRes.ok) return undefined;

  let html = await indexRes.text();

  // ── Inject title + OG tags ────────────────────────────────────
  const pageTitle = guideTitle ? guideTitle : "Product Guide";

  const ogTags = [
    `  <meta property="og:type" content="website" />`,
    `  <meta property="og:title" content="${esc(pageTitle)}" />`,
    guideDesc  ? `  <meta property="og:description" content="${esc(guideDesc)}" />` : "",
    guideDesc  ? `  <meta name="description" content="${esc(guideDesc)}" />` : "",
    guideImage ? `  <meta property="og:image" content="${esc(guideImage)}" />` : "",
  ].filter(Boolean).join("\n");

  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(pageTitle)}</title>`)
    .replace("</head>", `${ogTags}\n</head>`);

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Don't cache the HTML so title stays fresh if guide is renamed
      "cache-control": "no-store",
    },
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
