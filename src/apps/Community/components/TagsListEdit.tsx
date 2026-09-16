import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { listAllTags } from '../lib/api';

/** Editable tag chips. Suggestions come from tags already used across contacts. */
export function TagsListEdit({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const { data: all = [] } = useQuery({ queryKey: ['community', 'tags'], queryFn: listAllTags, staleTime: 60_000, enabled: open });
  const suggestions = useMemo(() => all.filter((t) => !tags.includes(t) && t.toLowerCase().includes(draft.trim().toLowerCase())).slice(0, 8), [all, tags, draft]);

  const add = async (t: string) => {
    const v = t.trim();
    if (!v || tags.includes(v)) return;
    await onChange([...tags, v]);
    setDraft('');
    setOpen(false);
  };
  const remove = (t: string) => onChange(tags.filter((x) => x !== t));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <Badge key={t} variant="secondary" className="gap-1 rounded-full pr-1 font-normal">
          {t}
          <button type="button" onClick={() => remove(t)} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground" aria-label={`Remove ${t}`}>
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 rounded-full px-2 text-muted-foreground">
            <Plus className="mr-1 h-3.5 w-3.5" /> Add tag
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(draft); } }}
            placeholder="Tag name"
            autoFocus
            className="h-8"
          />
          {suggestions.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {suggestions.map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => add(s)} className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted">{s}</button>
                </li>
              ))}
            </ul>
          )}
          {draft.trim() && !all.includes(draft.trim()) && (
            <button type="button" onClick={() => add(draft)} className="mt-2 w-full rounded px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted">
              Create “{draft.trim()}”
            </button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
