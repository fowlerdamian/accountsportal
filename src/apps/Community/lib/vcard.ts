import type { Contact } from '../types';

const esc = (s: string | null | undefined) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

/** Build a vCard 3.0 string for a contact (same fields Atomic CRM exports). */
export function contactToVCard(c: Contact): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`N:${esc(c.last_name)};${esc(c.first_name)};;;`);
  lines.push(`FN:${esc([c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || 'Contact')}`);
  if (c.company_name) lines.push(`ORG:${esc(c.company_name)}`);
  if (c.title) lines.push(`TITLE:${esc(c.title)}`);
  for (const e of c.email_jsonb ?? []) lines.push(`EMAIL;TYPE=${e.type.toUpperCase()}:${esc(e.email)}`);
  for (const p of c.phone_jsonb ?? []) lines.push(`TEL;TYPE=${p.type.toUpperCase()}:${esc(p.number)}`);
  if (c.linkedin_url) lines.push(`URL:${esc(c.linkedin_url)}`);
  if (c.address?.address1) {
    const a = c.address;
    lines.push(`ADR;TYPE=WORK:;;${esc(a.address1)}${a.address2 ? ` ${esc(a.address2)}` : ''};${esc(a.city)};${esc(a.province)};${esc(a.zip)};${esc(a.country)}`);
  }
  if (c.background) lines.push(`NOTE:${esc(c.background)}`);
  lines.push(`REV:${new Date().toISOString()}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function downloadVCard(c: Contact) {
  const blob = new Blob([contactToVCard(c)], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${[c.first_name, c.last_name].filter(Boolean).join('_') || 'contact'}.vcf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
