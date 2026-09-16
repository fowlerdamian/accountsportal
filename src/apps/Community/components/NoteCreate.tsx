import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function NoteCreate({ onCreate, busy }: { onCreate: (text: string) => Promise<void>; busy?: boolean }) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    await onCreate(t);
    setText('');
    setFocused(false);
  };
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
      onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit(); }}
    >
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        placeholder="Add a note…"
        rows={focused || text ? 4 : 2}
        className="resize-none bg-transparent"
      />
      {(focused || text) && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter to save</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setText(''); setFocused(false); }}>Cancel</Button>
            <Button type="submit" size="sm" disabled={!text.trim() || busy}>Add this note</Button>
          </div>
        </div>
      )}
    </form>
  );
}
