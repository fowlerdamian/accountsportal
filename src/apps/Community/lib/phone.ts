// Phone-number handling for contact search.
//
// Numbers reach us in every shape: "0410 849 548", "0410849548", "+61 410 849
// 548", "(02) 6190 2894", "61261902894". The database stores digit-only tokens
// for each contact (community_phone_tokens), and these helpers collapse whatever
// the user types down to the same token so any format finds the same person.

/** Characters a person might type inside a phone number. */
const PHONE_CHARS = /^[+\d\s()\-.]+$/;

/** True when the query reads as a phone number rather than a name or email. */
export function isPhoneQuery(q: string): boolean {
  const trimmed = q.trim();
  if (!trimmed || !PHONE_CHARS.test(trimmed)) return false;
  return trimmed.replace(/\D/g, '').length >= 4;
}

/**
 * The digits to match on. Anything 9 digits or longer collapses to its last 9 —
 * the part every Australian format shares once the country code (+61 / 0061 /
 * 61) and the trunk 0 are stripped. Shorter input is kept whole so a partial
 * like "8528" still works as a substring.
 */
export function phoneSearchToken(q: string): string {
  const digits = q.replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

/** Digits only, for suffix-matching the E.164 values in community_identities. */
export function phoneDigits(q: string): string {
  return q.replace(/\D/g, '');
}

/** Display form for an E.164 number: +61410849548 → 0410 849 548. */
export function formatPhone(raw: string): string {
  const d = phoneDigits(raw);
  if (d.startsWith('614') && d.length === 11) return `0${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  if (d.startsWith('61') && d.length === 11) return `0${d[2]} ${d.slice(3, 7)} ${d.slice(7)}`;
  if (d.startsWith('04') && d.length === 10) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (d.startsWith('0') && d.length === 10) return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
  return raw;
}
