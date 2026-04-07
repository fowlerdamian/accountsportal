import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Folder, CheckSquare, X } from "lucide-react";
import { cn } from "@guide/lib/utils";
import { useHubSearch } from "@guide/hooks/use-hub-queries";

interface CommandPaletteProps {
  open:    boolean;
  onClose: () => void;
}

type ResultItem =
  | { kind: "contractor"; id: string; label: string; sub: string }
  | { kind: "project";    id: string; label: string; sub: string }
  | { kind: "task";       id: string; label: string; sub: string; projectId: string };

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery]           = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef                    = useRef<HTMLInputElement>(null);
  const navigate                    = useNavigate();

  const { data: results } = useHubSearch(query);

  // Build flat list for keyboard navigation
  const items: ResultItem[] = [];
  for (const c of results?.contractors ?? []) {
    items.push({ kind: "contractor", id: c.id, label: c.name, sub: (c as any).role ?? "" });
  }
  for (const p of results?.projects ?? []) {
    items.push({ kind: "project", id: p.id, label: p.name, sub: p.type });
  }
  for (const t of results?.tasks ?? []) {
    items.push({
      kind:      "task",
      id:        t.id,
      label:     (t as any).title,
      sub:       (t as any).projects?.name ?? "",
      projectId: t.project_id,
    });
  }

  // Reset state on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, items.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && items[activeIndex]) {
        e.preventDefault();
        selectItem(items[activeIndex]);
        return;
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, items, activeIndex]);

  function selectItem(item: ResultItem) {
    switch (item.kind) {
      case "contractor": navigate(`/hub/contractors/${item.id}`); break;
      case "project":    navigate(`/hub/projects/${item.id}`);    break;
      case "task":       navigate(`/hub/projects/${item.projectId}`); break;
    }
    onClose();
  }

  if (!open) return null;

  const hasResults = items.length > 0;
  const groups = [
    {
      label: "Contractors",
      icon:  Users,
      items: items.filter((i) => i.kind === "contractor"),
    },
    {
      label: "Projects",
      icon:  Folder,
      items: items.filter((i) => i.kind === "project"),
    },
    {
      label: "Tasks",
      icon:  CheckSquare,
      items: items.filter((i) => i.kind === "task"),
    },
  ].filter((g) => g.items.length > 0);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg rounded-xl border bg-background shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <svg className="w-4 h-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contractors, projects, tasks..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex h-5 items-center rounded border px-1.5 text-[10px] text-muted-foreground font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {query.length < 2 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search
            </div>
          )}

          {query.length >= 2 && !hasResults && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results for "{query}"
            </div>
          )}

          {hasResults && groups.map((group) => {
            const GroupIcon = group.icon;
            return (
              <div key={group.label} className="py-1">
                <div className="flex items-center gap-2 px-4 py-1.5">
                  <GroupIcon className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </span>
                </div>
                {group.items.map((item) => {
                  const globalIdx = items.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      onClick={() => selectItem(item)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                        globalIdx === activeIndex
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/50",
                      )}
                      onMouseEnter={() => setActiveIndex(globalIdx)}
                    >
                      <GroupIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.label}</p>
                        {item.sub && (
                          <p className="text-xs text-muted-foreground truncate">{item.sub}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="border-t px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
