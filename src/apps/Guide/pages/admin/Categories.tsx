import { useState } from "react";
import { useCategories, useInstructionSets } from "@guide/hooks/use-supabase-query";
import { supabase } from "@guide/integrations/supabase/client";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Plus, Pencil, Trash2, Loader2, Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@guide/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@guide/components/ui/alert-dialog";
import { Label } from "@guide/components/ui/label";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export default function Categories({ embedded = false }: { embedded?: boolean }) {
  const { data: cats = [], isLoading } = useCategories();
  // The "guides assigned" guard must not run against an empty placeholder
  // while guides are still loading — deletes stay disabled until isSuccess.
  const { data: guides = [], isSuccess: guidesReady } = useInstructionSets();
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const queryClient = useQueryClient();

  const Heading = embedded ? "h2" : "h1";

  const guideCount = (catId: string) => guides.filter((g: any) => g.category_id === catId).length;

  const addCategory = async () => {
    if (!newName.trim()) return;
    const slug = newName.trim().toLowerCase().replace(/\s+/g, '-');
    const { error } = await supabase.from("categories").insert({ name: newName.trim(), slug });
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    setNewName("");
    setOpen(false);
    toast.success("Category created");
  };

  const renameCategory = async (id: string) => {
    if (!editName.trim()) return;
    const slug = editName.trim().toLowerCase().replace(/\s+/g, '-');
    const { error } = await supabase.from("categories").update({ name: editName.trim(), slug }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    setEditingId(null);
    toast.success("Category renamed");
  };

  const deleteCategory = async (id: string) => {
    if (!guidesReady) return;
    const count = guideCount(id);
    if (count > 0) {
      const message = `Cannot delete — ${count} guide(s) assigned`;
      setRowError({ id, message });
      toast.error(message);
      return;
    }
    setRowError(null);
    setDeleteError(null);
    setDeleteConfirmId(id);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    setDeleting(true);
    const { error } = await supabase.from("categories").delete().eq("id", deleteConfirmId);
    setDeleting(false);
    if (error) {
      // Keep the dialog open and show the failure inline (also on the row once closed).
      setDeleteError(error.message);
      setRowError({ id: deleteConfirmId, message: error.message });
      toast.error(error.message);
      return;
    }
    setDeleteConfirmId(null);
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    toast.success("Category deleted");
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <>
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Heading className="text-2xl font-bold">Categories</Heading>
          <p className="text-muted-foreground text-sm">Organise guides by product category</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> Add Category</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Category</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Category Name</Label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Canopies" className="mt-1.5" onKeyDown={e => e.key === 'Enter' && addCategory()} />
              </div>
              <Button onClick={addCategory} className="w-full">Create Category</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card rounded-lg border overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Name</th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Slug</th>
              <th className="text-center p-3 text-xs font-semibold text-muted-foreground uppercase">Guides</th>
              <th className="text-right p-3 text-xs font-semibold text-muted-foreground uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cats.map(cat => (
              <tr key={cat.id} className="border-b hover:bg-muted/30">
                <td className="p-3">
                  {editingId === cat.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="h-8 text-sm"
                        onKeyDown={e => e.key === 'Enter' && renameCategory(cat.id)}
                        autoFocus
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Save name" onClick={() => renameCategory(cat.id)}><Check className="w-4 h-4 text-success" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Cancel rename" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                    </div>
                  ) : (
                    <span className="font-medium text-sm">{cat.name}</span>
                  )}
                  {rowError?.id === cat.id && (
                    <p className="text-xs text-destructive mt-1" role="alert">{rowError.message}</p>
                  )}
                </td>
                <td className="p-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{cat.slug}</code></td>
                <td className="p-3 text-center text-sm text-muted-foreground">{guidesReady ? guideCount(cat.id) : <Loader2 className="w-3 h-3 animate-spin inline" />}</td>
                <td className="p-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Rename ${cat.name}`} onClick={() => { setEditingId(cat.id); setEditName(cat.name); }}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`Delete ${cat.name}`}
                      title={guidesReady ? "Delete category" : "Checking guide assignments…"}
                      disabled={!guidesReady}
                      onClick={() => deleteCategory(cat.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {cats.length === 0 && (
              <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No categories yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>

    <AlertDialog open={!!deleteConfirmId} onOpenChange={(v) => { if (!v) { setDeleteConfirmId(null); setDeleteError(null); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete category?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the category. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteError && (
          <p className="text-sm text-destructive" role="alert">{deleteError}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          {/* preventDefault keeps the dialog open so a failure can be shown inline */}
          <AlertDialogAction disabled={deleting} onClick={(e) => { e.preventDefault(); confirmDelete(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
