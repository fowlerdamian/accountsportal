import { useState } from 'react';
import { format, isPast, isToday } from 'date-fns';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { TASK_TYPES, type Task } from '../types';

export function TasksIterator({ tasks, onToggle, onDelete }: { tasks: Task[]; onToggle: (t: Task) => void; onDelete: (t: Task) => void }) {
  if (!tasks.length) return null;
  return (
    <ul className="space-y-2">
      {tasks.map((t) => {
        const done = Boolean(t.done_date);
        const due = t.due_date ? new Date(`${t.due_date}T00:00:00`) : null;
        const overdue = due && !done && isPast(due) && !isToday(due);
        return (
          <li key={t.id} className="group flex items-start gap-2 text-sm">
            <Checkbox checked={done} onCheckedChange={() => onToggle(t)} className="mt-0.5" aria-label={done ? 'Mark as not done' : 'Mark as done'} />
            <div className="min-w-0 flex-1">
              <div className={cn('leading-snug', done && 'text-muted-foreground line-through')}>{t.text}</div>
              <div className="text-xs text-muted-foreground">
                {t.type !== 'None' && <span>{t.type} · </span>}
                {due ? <span className={cn(overdue && 'text-destructive')}>{overdue ? 'overdue · ' : 'due '}{format(due, 'd MMM')}</span> : <span>no due date</span>}
              </div>
            </div>
            <button type="button" className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100" onClick={() => onDelete(t)} aria-label="Delete task">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function AddTask({ onCreate }: { onCreate: (input: { text: string; type: string; due_date: string | null }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [type, setType] = useState('None');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await onCreate({ text: text.trim(), type, due_date: due || null });
      setText(''); setType('None'); setDue(''); setOpen(false);
    } finally { setBusy(false); }
  };
  return (
    <>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add task
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add a task</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-text">Description</Label>
              <Textarea id="task-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TASK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-due">Due date</Label>
                <Input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!text.trim() || busy}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
