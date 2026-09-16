import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Pencil, Eye, Trash2, Download, Mail, Phone, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { downloadVCard } from '../lib/vcard';
import { ContactMergeButton } from './ContactMergeButton';
import { TagsListEdit } from './TagsListEdit';
import { AddTask, TasksIterator } from './Tasks';
import { contactName, type Contact, type Sale, type Task } from '../types';

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2', className)}>
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex gap-3 text-sm"><span className="w-24 shrink-0 text-muted-foreground">{label}</span><span className="min-w-0 flex-1 break-words">{children}</span></div>
);

const TypeTag = ({ type }: { type: string }) => <span className="ml-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{type}</span>;

const GENDER_LABEL: Record<string, string> = { male: 'Male', female: 'Female', nonbinary: 'Non-binary' };

export function ContactAside({ contact, mode, sales, tasks, onTagsChange, onDelete, onTaskCreate, onTaskToggle, onTaskDelete, className }: {
  contact: Contact;
  mode: 'show' | 'edit';
  sales: Sale[];
  tasks: Task[];
  onTagsChange: (tags: string[]) => Promise<void>;
  onDelete: () => Promise<void>;
  onTaskCreate: (input: { text: string; type: string; due_date: string | null }) => Promise<void>;
  onTaskToggle: (t: Task) => void;
  onTaskDelete: (t: Task) => void;
  className?: string;
}) {
  const emails = contact.email_jsonb ?? [];
  const phones = contact.phone_jsonb ?? [];
  const hasPersonal = emails.length > 0 || phones.length > 0 || Boolean(contact.linkedin_url) || Boolean(contact.gender) || contact.has_newsletter;
  const rep = sales.find((s) => s.id === contact.sales_id);
  const hasBackground = Boolean(contact.background) || Boolean(contact.ai_summary) || Boolean(contact.first_seen) || Boolean(rep);
  const openTasks = tasks.filter((t) => !t.done_date);
  const doneTasks = tasks.filter((t) => t.done_date).slice(0, 3);

  return (
    <aside className={cn('space-y-8', className)}>
      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1">
        {mode === 'show' ? (
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link to={`/community/contacts/${contact.id}/edit`}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit</Link>
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link to={`/community/contacts/${contact.id}`}><Eye className="mr-1.5 h-3.5 w-3.5" /> Show</Link>
          </Button>
        )}
        {mode === 'show' && (
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-destructive"><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {contactName(contact)}?</AlertDialogTitle>
                  <AlertDialogDescription>All notes, tasks and linked identifiers are removed. Synced calls, emails and orders will re-attach to a fresh profile on the next sync.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void onDelete()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <ContactMergeButton contact={contact} />
            <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => downloadVCard(contact)}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> vCard
            </Button>
          </>
        )}
      </div>

      {hasPersonal && (
        <Section title="Personal info">
          <div className="space-y-1.5">
            {emails.map((e) => (
              <div key={`${e.email}-${e.type}`} className="flex items-center text-sm">
                <Mail className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <a href={`mailto:${e.email}`} className="truncate hover:underline">{e.email}</a>
                <TypeTag type={e.type} />
              </div>
            ))}
            {phones.map((p) => (
              <div key={`${p.number}-${p.type}`} className="flex items-center text-sm">
                <Phone className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <a href={`tel:${p.number.replace(/\s/g, '')}`} className="hover:underline">{p.number}</a>
                <TypeTag type={p.type} />
              </div>
            ))}
            {contact.linkedin_url && (
              <div className="flex items-center text-sm">
                <Link2 className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <a href={contact.linkedin_url} target="_blank" rel="noreferrer" className="truncate hover:underline">{contact.linkedin_url.replace(/^https?:\/\/(www\.)?/, '')}</a>
              </div>
            )}
            {contact.gender && <Row label="Gender">{GENDER_LABEL[contact.gender] ?? contact.gender}</Row>}
            {contact.has_newsletter && <Row label="Newsletter">Subscribed</Row>}
          </div>
        </Section>
      )}

      {hasBackground && (
        <Section title="Background">
          {contact.background && <p className="whitespace-pre-wrap text-sm leading-relaxed">{contact.background}</p>}
          {contact.ai_summary && (
            <p className="text-sm leading-relaxed text-muted-foreground" title={contact.ai_summary_at ? `Written ${format(new Date(contact.ai_summary_at), 'd MMM HH:mm')}` : undefined}>
              {contact.ai_summary}
            </p>
          )}
          <div className="space-y-1 pt-1">
            <Row label="First seen">{format(new Date(contact.first_seen), 'd MMM yyyy')}</Row>
            <Row label="Last activity">{format(new Date(contact.last_seen), 'd MMM yyyy')}</Row>
            {rep && <Row label="Account manager">{rep.full_name ?? rep.email}</Row>}
          </div>
        </Section>
      )}

      <Section title="Tags">
        <TagsListEdit tags={contact.tags ?? []} onChange={onTagsChange} />
      </Section>

      <Section title="Tasks">
        <TasksIterator tasks={openTasks} onToggle={onTaskToggle} onDelete={onTaskDelete} />
        {doneTasks.length > 0 && <TasksIterator tasks={doneTasks} onToggle={onTaskToggle} onDelete={onTaskDelete} />}
        <AddTask onCreate={onTaskCreate} />
      </Section>
    </aside>
  );
}
