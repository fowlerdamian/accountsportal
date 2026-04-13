const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { type, title, content, url, fileName, companyDomain } = await req.json();

    if (!companyDomain) {
      return new Response(JSON.stringify({ error: 'companyDomain is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    let finalContent = content;
    let finalTitle = title;

    if (type === 'website' && url) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeBot/1.0)' },
          signal: AbortSignal.timeout(15_000),
        });
        const html = await res.text();

        // Extract title from HTML
        if (!finalTitle) {
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          finalTitle = titleMatch?.[1]?.trim() || url;
        }

        // Strip scripts, styles, tags → plain text
        finalContent = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 60_000);
      } catch (e: any) {
        return new Response(JSON.stringify({ error: `Failed to fetch URL: ${e.message}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (!finalContent?.trim()) {
      return new Response(JSON.stringify({ error: 'No content to store' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const row = {
      company_domain: companyDomain,
      type,
      title: finalTitle || 'Untitled',
      content: finalContent.trim(),
      url: url || null,
      file_name: fileName || null,
    };

    const res = await fetch(`${supabaseUrl}/rest/v1/compliance_kb_items`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
    });

    const data = await res.json();
    const item = Array.isArray(data) ? data[0] : data;

    return new Response(JSON.stringify(item), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
