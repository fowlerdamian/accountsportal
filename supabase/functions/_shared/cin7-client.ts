/**
 * Generic authenticated client for the Cin7 Core (DEAR) External API v2.
 * Used by the cin7-mcp edge function and any other cin7-* function that
 * needs a typed-ish call surface with rate-limit handling.
 *
 * Auth comes from the same env vars the existing cin7-* functions use:
 *   CIN7_ACCOUNT_ID  -> api-auth-accountid
 *   CIN7_API_KEY     -> api-auth-applicationkey
 */

export const CIN7_BASE = "https://inventory.dearsystems.com/ExternalApi/v2";

export interface Cin7Result {
  ok: boolean;
  status: number;
  data: unknown;
  /** Human-readable error message when ok === false. */
  error?: string;
}

export interface Cin7RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Query string params; null/undefined/"" entries are skipped. */
  query?: Record<string, unknown> | undefined;
  /** JSON body for POST/PUT. */
  body?: unknown;
}

function authHeaders(): Record<string, string> {
  const accountId = Deno.env.get("CIN7_ACCOUNT_ID");
  const apiKey = Deno.env.get("CIN7_API_KEY");
  if (!accountId || !apiKey) {
    throw new Error(
      "Cin7 credentials not configured: set CIN7_ACCOUNT_ID and CIN7_API_KEY",
    );
  }
  return {
    "api-auth-accountid": accountId,
    "api-auth-applicationkey": apiKey,
    "Content-Type": "application/json",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pull a useful error message out of a DEAR error body. */
function describeError(data: unknown, statusText: string): string {
  if (typeof data === "string" && data) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.Errors)) return o.Errors.map(String).join("; ");
    if (typeof o.Exception === "string") return o.Exception;
    if (typeof o.ErrorCode === "string" || typeof o.ErrorCode === "number") {
      return `ErrorCode ${o.ErrorCode}`;
    }
  }
  return statusText || "Request failed";
}

/**
 * Call any Cin7 Core v2 endpoint. Retries on 429 (rate limit) and 503
 * (overloaded) with exponential backoff, honouring Retry-After when present.
 * DEAR's documented limit is 60 calls/min, 3 concurrent.
 */
export async function cin7Fetch(
  path: string,
  opts: Cin7RequestOptions = {},
): Promise<Cin7Result> {
  const { method = "GET", query, body } = opts;

  const url = new URL(CIN7_BASE + (path.startsWith("/") ? path : "/" + path));
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== null && v !== undefined && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const headers = authHeaders();
  const maxRetries = 4;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        headers,
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (attempt < maxRetries) {
        await sleep((2 ** attempt) * 1000);
        continue;
      }
      return { ok: false, status: 0, data: null, error: `Network error: ${err}` };
    }

    if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      const waitSec = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter, 30)
        : Math.min(2 ** attempt, 30);
      await sleep(waitSec * 1000);
      continue;
    }

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data,
        error: describeError(data, res.statusText),
      };
    }
    return { ok: true, status: res.status, data };
  }

  return { ok: false, status: 429, data: null, error: "Rate-limit retries exhausted" };
}
