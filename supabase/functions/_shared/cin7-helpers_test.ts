/**
 * Pure-Deno tests with no remote imports (the dev environment may not
 * have outbound TLS to deno.land). Run from the repo root with:
 *   deno test supabase/functions/_shared/
 */

import {
  numOr,
  hasDistributorTag,
  fingerprint,
  cin7OrderLink,
  formatCurrency,
} from "./cin7-helpers.ts";

function eq<T>(actual: T, expected: T, msg = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg}\nexpected ${JSON.stringify(expected)}\ngot      ${JSON.stringify(actual)}`);
  }
}

Deno.test("numOr falls back on NaN, empty, zero, negative", () => {
  eq(numOr("",            7), 7);
  eq(numOr("not-a-number",7), 7);
  eq(numOr(undefined,     7), 7);
  eq(numOr(null,          7), 7);
  eq(numOr(0,             7), 7);
  eq(numOr(-3,            7), 7);
  eq(numOr(NaN,           7), 7);
});

Deno.test("numOr accepts positive finite numbers and string numbers", () => {
  eq(numOr(5,    7), 5);
  eq(numOr("12", 7), 12);
  eq(numOr(0.5,  7), 0.5);
});

Deno.test("hasDistributorTag matches whole-token D, not substrings", () => {
  // Whole-token → true
  eq(hasDistributorTag({ Tags: "D" }),       true);
  eq(hasDistributorTag({ Tags: "D, VIP" }),  true);
  eq(hasDistributorTag({ Tags: "VIP, D" }),  true);
  eq(hasDistributorTag({ Tags: "vip;d" }),   true);
  eq(hasDistributorTag({ Tags: ["VIP", "D", "WHOLESALE"] as unknown as string }), true);
  eq(hasDistributorTag({ Tag:  "D" }),       true);

  // Substring traps → false
  eq(hasDistributorTag({ Tags: "DRAFT" }),       false);
  eq(hasDistributorTag({ Tags: "DEALER" }),      false);
  eq(hasDistributorTag({ Tags: "DISTRIBUTOR" }), false);
  eq(hasDistributorTag({ Tags: "Wholesale" }),   false);

  // Empty / missing → false
  eq(hasDistributorTag({}),         false);
  eq(hasDistributorTag({ Tags: ""}),false);
  eq(hasDistributorTag(null),       false);
  eq(hasDistributorTag(undefined),  false);
});

Deno.test("fingerprint is deterministic and per-input unique", async () => {
  const a = await fingerprint("hello");
  const b = await fingerprint("hello");
  const c = await fingerprint("hello!");
  eq(a, b);
  eq(a.length, 64);
  if (a === c) throw new Error("fingerprint collided across distinct inputs");
});

Deno.test("cin7OrderLink builds Google Chat hyperlink syntax", () => {
  eq(
    cin7OrderLink("abc-123", "SO-555"),
    "<https://inventory.dearsystems.com/Sale?ID=abc-123|SO-555>",
  );
});

Deno.test("formatCurrency adds thousand separators", () => {
  eq(formatCurrency(1234.5),     "1,234.50");
  eq(formatCurrency(0),          "0.00");
  eq(formatCurrency(1234567.89), "1,234,567.89");
});
