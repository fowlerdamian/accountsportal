// Google Places proxy — keeps GOOGLE_PLACES_API_KEY server-side so the browser
// never sees it. Two actions:
//   { action: 'autocomplete', input, sessiontoken } -> { predictions: [{ description, place_id }] }
//   { action: 'details', place_id, sessiontoken }    -> { address: {...}, formatted }
// Restricted to Australian addresses (components=country:au, region=au).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

function pick(components: any[], type: string, useShort = false): string {
  const c = components.find((x) => x.types?.includes(type));
  return c ? (useShort ? c.short_name : c.long_name) : '';
}

function parseAddress(components: any[]) {
  const streetNumber = pick(components, 'street_number');
  const route        = pick(components, 'route');
  const line1        = [streetNumber, route].filter(Boolean).join(' ');
  const subpremise   = pick(components, 'subpremise');
  const suburb       = pick(components, 'locality')
                    || pick(components, 'postal_town')
                    || pick(components, 'sublocality')
                    || pick(components, 'administrative_area_level_2');
  return {
    line1,
    line2:    subpremise ? `Unit ${subpremise}` : '',
    suburb,
    state:    pick(components, 'administrative_area_level_1', true),
    postcode: pick(components, 'postal_code'),
    country:  pick(components, 'country') || 'Australia',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const key = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? '';
    if (!key) {
      return new Response(JSON.stringify({ error: 'Places API key not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action, input, place_id, sessiontoken } = await req.json();

    if (action === 'autocomplete') {
      if (!input || input.trim().length < 3) {
        return new Response(JSON.stringify({ predictions: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const url = `${PLACES_BASE}/autocomplete/json`
        + `?input=${encodeURIComponent(input)}`
        + `&components=country:au&region=au&language=en`
        + (sessiontoken ? `&sessiontoken=${encodeURIComponent(sessiontoken)}` : '')
        + `&key=${key}`;
      const data = await (await fetch(url)).json();
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        return new Response(JSON.stringify({ predictions: [], error: `${data.status}: ${data.error_message ?? ''}` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const predictions = (data.predictions ?? []).map((p: any) => ({
        description: p.description,
        place_id:    p.place_id,
      }));
      return new Response(JSON.stringify({ predictions }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'details') {
      if (!place_id) {
        return new Response(JSON.stringify({ error: 'place_id required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const url = `${PLACES_BASE}/details/json`
        + `?place_id=${encodeURIComponent(place_id)}`
        + `&fields=address_component,formatted_address,name`
        + (sessiontoken ? `&sessiontoken=${encodeURIComponent(sessiontoken)}` : '')
        + `&key=${key}`;
      const data = await (await fetch(url)).json();
      if (data.status !== 'OK') {
        return new Response(JSON.stringify({ error: `${data.status}: ${data.error_message ?? ''}` }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        address:   parseAddress(data.result.address_components ?? []),
        formatted: data.result.formatted_address ?? '',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
