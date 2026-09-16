import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CONTACT_TYPES, GENDERS, STATUSES, type Contact, type ContactType, type Sale } from '../types';

export interface ContactFormValues {
  first_name: string; last_name: string; title: string; company_name: string;
  email_jsonb: { email: string; type: ContactType }[];
  phone_jsonb: { number: string; type: ContactType }[];
  linkedin_url: string; gender: string; has_newsletter: boolean; background: string;
  status: string; sales_id: string;
}

const NONE = '__none__';

export function toFormValues(c: Contact): ContactFormValues {
  return {
    first_name: c.first_name ?? '', last_name: c.last_name ?? '', title: c.title ?? '', company_name: c.company_name ?? '',
    email_jsonb: (c.email_jsonb ?? []).map((e) => ({ email: e.email, type: e.type })),
    phone_jsonb: (c.phone_jsonb ?? []).map((p) => ({ number: p.number, type: p.type })),
    linkedin_url: c.linkedin_url ?? '', gender: c.gender ?? NONE, has_newsletter: Boolean(c.has_newsletter), background: c.background ?? '',
    status: c.status ?? 'cold', sales_id: c.sales_id ?? NONE,
  };
}

export function fromFormValues(v: ContactFormValues): Partial<Contact> {
  const clean = (s: string) => (s.trim() ? s.trim() : null);
  return {
    first_name: clean(v.first_name), last_name: clean(v.last_name), title: clean(v.title), company_name: clean(v.company_name),
    email_jsonb: v.email_jsonb.filter((e) => e.email.trim()).map((e) => ({ email: e.email.trim().toLowerCase(), type: e.type })),
    phone_jsonb: v.phone_jsonb.filter((p) => p.number.trim()).map((p) => ({ number: p.number.trim(), type: p.type })),
    linkedin_url: clean(v.linkedin_url), gender: v.gender === NONE ? null : v.gender, has_newsletter: v.has_newsletter,
    background: clean(v.background), status: v.status, sales_id: v.sales_id === NONE ? null : v.sales_id,
  };
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label htmlFor={htmlFor} className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

export function ContactEditForm({ contact, sales, onSave, onCancel, saving }: {
  contact: Contact; sales: Sale[]; onSave: (patch: Partial<Contact>) => Promise<void>; onCancel: () => void; saving?: boolean;
}) {
  const form = useForm<ContactFormValues>({ defaultValues: toFormValues(contact) });
  const emails = useFieldArray({ control: form.control, name: 'email_jsonb' });
  const phones = useFieldArray({ control: form.control, name: 'phone_jsonb' });
  const { register, control, handleSubmit } = form;

  const TypeSelect = ({ name }: { name: `email_jsonb.${number}.type` | `phone_jsonb.${number}.type` }) => (
    <Controller control={control} name={name} render={({ field }) => (
      <Select value={field.value} onValueChange={field.onChange}>
        <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
        <SelectContent>{CONTACT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
      </Select>
    )} />
  );

  return (
    <form onSubmit={handleSubmit((v) => onSave(fromFormValues(v)))} className="max-w-2xl space-y-8">
      <section className="space-y-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Identity</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="first_name"><Input id="first_name" {...register('first_name')} /></Field>
          <Field label="Last name" htmlFor="last_name"><Input id="last_name" {...register('last_name')} /></Field>
          <Field label="Job title" htmlFor="title"><Input id="title" {...register('title')} /></Field>
          <Field label="Company" htmlFor="company_name"><Input id="company_name" {...register('company_name')} /></Field>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Personal info</h3>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Emails</Label>
          {emails.fields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <Input type="email" placeholder="name@example.com" {...register(`email_jsonb.${i}.email`)} />
              <TypeSelect name={`email_jsonb.${i}.type`} />
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => emails.remove(i)} aria-label="Remove email"><X className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={() => emails.append({ email: '', type: 'Work' })}><Plus className="mr-1 h-3.5 w-3.5" /> Add email</Button>
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Phones</Label>
          {phones.fields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <Input type="tel" placeholder="0400 000 000" {...register(`phone_jsonb.${i}.number`)} />
              <TypeSelect name={`phone_jsonb.${i}.type`} />
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => phones.remove(i)} aria-label="Remove phone"><X className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={() => phones.append({ number: '', type: 'Work' })}><Plus className="mr-1 h-3.5 w-3.5" /> Add phone</Button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="LinkedIn URL" htmlFor="linkedin_url"><Input id="linkedin_url" type="url" placeholder="https://linkedin.com/in/…" {...register('linkedin_url')} /></Field>
          <Field label="Gender">
            <Controller control={control} name="gender" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not set</SelectItem>
                  {GENDERS.map((g) => <SelectItem key={g} value={g}>{g === 'nonbinary' ? 'Non-binary' : g[0].toUpperCase() + g.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </Field>
        </div>
        <Controller control={control} name="has_newsletter" render={({ field }) => (
          <div className="flex items-center gap-3">
            <Switch id="has_newsletter" checked={field.value} onCheckedChange={field.onChange} />
            <Label htmlFor="has_newsletter" className="text-sm">Subscribed to the newsletter</Label>
          </div>
        )} />
      </section>

      <section className="space-y-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Background</h3>
        <Field label="Background / bio" htmlFor="background"><Textarea id="background" rows={4} {...register('background')} /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Status">
            <Controller control={control} name="status" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          <Field label="Account manager">
            <Controller control={control} name="sales_id" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {sales.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name ?? s.email}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </Field>
        </div>
      </section>

      <div className="flex items-center gap-2 border-t border-border/60 pt-6">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
