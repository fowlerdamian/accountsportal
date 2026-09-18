// Contact page — ported from Atomic CRM's ContactShow + ContactAside.
// Desktop: main column (header + notes timeline + quick-add) and a sticky aside.
// Mobile: header + tabs (Notes / Tasks / Details).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@portal/context/AuthContext';
import { ContactAside } from '../components/ContactAside';
import { ContactEditForm } from '../components/ContactEditForm';
import { NoteCreate } from '../components/NoteCreate';
import { NotesIterator } from '../components/NotesIterator';
import { AddTask, TasksIterator } from '../components/Tasks';
import { createNote, createTask, deleteContact, deleteNote, deleteTask, getContact, listNotes, listSales, listTasks, updateContact, updateTask } from '../lib/api';
import { contactInitials, contactName, type Contact, type ContactNote, type Task } from '../types';

const PAGE = 60;

export default function ContactShow({ mode = 'show' }: { mode?: 'show' | 'edit' }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth() as { user: { id: string } | null };
  const userId = user?.id ?? null;

  const { data: contact, isLoading } = useQuery({ queryKey: ['community', 'contact', id], queryFn: () => getContact(id), enabled: Boolean(id) });
  const { data: sales = [] } = useQuery({ queryKey: ['community', 'sales'], queryFn: listSales, staleTime: 300_000 });
  const { data: tasks = [] } = useQuery({ queryKey: ['community', 'tasks', id], queryFn: () => listTasks(id), enabled: Boolean(id) });
  const { data: firstPage = [], isLoading: notesLoading } = useQuery({ queryKey: ['community', 'notes', id], queryFn: () => listNotes(id, PAGE), enabled: Boolean(id) });

  const [older, setOlder] = useState<ContactNote[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => { setOlder([]); }, [id, firstPage]);
  const notes = useMemo(() => [...firstPage, ...older], [firstPage, older]);
  const hasMore = (older.length ? older : firstPage).length >= PAGE;
  const loadMore = async () => {
    const last = notes[notes.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try { const more = await listNotes(id, PAGE, last.date); setOlder((o) => [...o, ...more]); } finally { setLoadingMore(false); }
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ['community'] });

  const save = useMutation({
    mutationFn: (patch: Partial<Contact>) => updateContact(id, {
      ...patch,
      // Picking a status by hand pins it; the automation skips 'manual' rows.
      ...(patch.status && patch.status !== contact?.status
        ? { status_source: 'manual', status_set_at: new Date().toISOString(), status_reason: null }
        : {}),
    }),
    onSuccess: () => { invalidate(); navigate(`/community/contacts/${id}`); },
    onError: (e) => toast({ title: 'Could not save', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }),
  });
  const addNote = useMutation({
    mutationFn: (text: string) => createNote({ contact_id: id, text, sales_id: userId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['community', 'notes', id] }),
  });
  const removeNote = useMutation({ mutationFn: deleteNote, onSuccess: () => qc.invalidateQueries({ queryKey: ['community', 'notes', id] }) });
  const addTask = useMutation({
    mutationFn: (input: { text: string; type: string; due_date: string | null }) => createTask({ contact_id: id, sales_id: userId, ...input }),
    onSuccess: invalidate,
  });
  const toggleTask = useMutation({
    mutationFn: (t: Task) => updateTask(t.id, id, { done_date: t.done_date ? null : new Date().toISOString() }),
    onSuccess: invalidate,
  });
  const removeTask = useMutation({ mutationFn: (t: Task) => deleteTask(t.id, id), onSuccess: invalidate });
  const setTags = useMutation({ mutationFn: (tags: string[]) => updateContact(id, { tags }), onSuccess: invalidate });
  const remove = useMutation({
    mutationFn: () => deleteContact(id),
    onSuccess: () => { invalidate(); navigate('/community'); toast({ title: 'Contact deleted' }); },
  });

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!contact) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Contact not found. <Link to="/community" className="underline">Back to Customer Service</Link>
      </div>
    );
  }

  const asideProps = {
    contact, mode, sales, tasks,
    onTagsChange: async (tags: string[]) => { await setTags.mutateAsync(tags); },
    onDelete: async () => { await remove.mutateAsync(); },
    onTaskCreate: async (input: { text: string; type: string; due_date: string | null }) => { await addTask.mutateAsync(input); },
    onTaskToggle: (t: Task) => toggleTask.mutate(t),
    onTaskDelete: (t: Task) => removeTask.mutate(t),
  };

  const header = (
    <header className="flex items-start gap-5">
      <Avatar className="h-16 w-16 text-lg">
        {contact.avatar_url && <AvatarImage src={contact.avatar_url} alt="" />}
        <AvatarFallback className="bg-muted text-muted-foreground">{contactInitials(contact)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 pt-1">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{contactName(contact)}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {contact.title && <span>{contact.title}</span>}
          {contact.title && contact.company_name && <span> at </span>}
          {contact.company_name && (
            <Link to={`/community?q=${encodeURIComponent(contact.company_name)}`} className="inline-flex items-center gap-1 text-foreground/80 underline-offset-4 hover:underline">
              <Building2 className="h-3.5 w-3.5" /> {contact.company_name}
            </Link>
          )}
        </p>
        {(contact.nb_orders > 0 || contact.nb_calls > 0 || contact.nb_emails > 0) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {[
              contact.nb_orders > 0 && `${contact.nb_orders} order${contact.nb_orders === 1 ? '' : 's'} · $${Number(contact.total_spent).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`,
              contact.nb_calls > 0 && `${contact.nb_calls} call${contact.nb_calls === 1 ? '' : 's'}${contact.avg_csat ? ` · CSAT ${Number(contact.avg_csat).toFixed(1)}` : ''}`,
              contact.nb_emails > 0 && `${contact.nb_emails} email${contact.nb_emails === 1 ? '' : 's'}`,
            ].filter(Boolean).join('  ·  ')}
          </p>
        )}
      </div>
    </header>
  );

  const main = mode === 'edit' ? (
    <ContactEditForm contact={contact} sales={sales} saving={save.isPending} onSave={async (p) => { await save.mutateAsync(p); }} onCancel={() => navigate(`/community/contacts/${id}`)} />
  ) : (
    <>
      <NoteCreate onCreate={async (t) => { await addNote.mutateAsync(t); }} busy={addNote.isPending} />
      <NotesIterator notes={notes} sales={sales} currentUserId={userId} onDelete={(nid) => removeNote.mutate(nid)} hasMore={hasMore} onLoadMore={loadMore} loading={notesLoading || loadingMore} />
    </>
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link to="/community" className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Customer Service
      </Link>

      {/* Desktop */}
      <div className="hidden gap-12 lg:flex">
        <div className="min-w-0 flex-1 space-y-8">
          {header}
          {main}
        </div>
        <ContactAside {...asideProps} className="sticky top-6 w-80 shrink-0 self-start" />
      </div>

      {/* Mobile / tablet */}
      <div className="space-y-6 lg:hidden">
        {header}
        {mode === 'edit' ? main : (
          <Tabs defaultValue="notes">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="notes">Notes</TabsTrigger>
              <TabsTrigger value="tasks">Tasks{tasks.filter((t) => !t.done_date).length ? ` (${tasks.filter((t) => !t.done_date).length})` : ''}</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>
            <TabsContent value="notes" className="mt-4 space-y-6">{main}</TabsContent>
            <TabsContent value="tasks" className="mt-4 space-y-3">
              <TasksIterator tasks={tasks} onToggle={asideProps.onTaskToggle} onDelete={asideProps.onTaskDelete} />
              <AddTask onCreate={asideProps.onTaskCreate} />
            </TabsContent>
            <TabsContent value="details" className="mt-4">
              <Separator className="mb-6" />
              <ContactAside {...asideProps} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
