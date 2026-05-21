import { Input } from "@guide/components/ui/input";
import { Label } from "@guide/components/ui/label";
import { Textarea } from "@guide/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { useStaffProfiles, type StaffProfile } from "../hooks/use-task-queries";

export interface DependencyDraft {
  title:        string;
  description:  string;
  assigned_to:  string;
  due_date:     string;
  urgency:      number | null;
  importance:   number | null;
}

interface DependencyPickerProps {
  value:        DependencyDraft;
  onChange:     (next: DependencyDraft) => void;
  /** Used to compute the default due_date (one day before the parent's). */
  parentDue?:   string | null;
  /** Hide assignees matching this id from the dropdown. */
  excludeUser?: string;
}

function defaultDepDue(parentDue: string | null | undefined): string {
  if (!parentDue) return "";
  const d = new Date(parentDue + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

export function DependencyPicker({ value, onChange, parentDue, excludeUser }: DependencyPickerProps) {
  const { data: profiles = [] } = useStaffProfiles();
  const eligible = profiles.filter((p: StaffProfile) => p.id !== excludeUser);

  const set = (patch: Partial<DependencyDraft>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3 rounded-md border border-dashed bg-amber-950/10 p-3">
      <p className="text-[11px] uppercase tracking-wide text-amber-400/80 font-medium">
        Waiting on someone — auto-creates their task & blocks this one
      </p>

      <div className="space-y-1.5">
        <Label className="text-xs">What's needed *</Label>
        <Input
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="e.g. final spec sign-off"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Assign to *</Label>
          <Select value={value.assigned_to} onValueChange={(v) => set({ assigned_to: v })}>
            <SelectTrigger><SelectValue placeholder="Pick a person…" /></SelectTrigger>
            <SelectContent>
              {eligible.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.full_name ?? p.email ?? p.id.slice(0, 8)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">They need it by</Label>
          <Input
            type="date"
            value={value.due_date || defaultDepDue(parentDue)}
            onChange={(e) => set({ due_date: e.target.value })}
            max={parentDue ?? undefined}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Notes for them</Label>
        <Textarea
          value={value.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={2}
          placeholder="Context, links, anything they need to know"
        />
      </div>
    </div>
  );
}

export function emptyDependency(): DependencyDraft {
  return { title: "", description: "", assigned_to: "", due_date: "", urgency: null, importance: null };
}
