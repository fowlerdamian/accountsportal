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

export default function Categories() {
  const { data: cats = [], isLoading } = useCategories();
  const { data: guides = [] } = useInstructionSets();
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const queryClient = useQueryClient();

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
    const count = guideCount(id);
    if (count > 0) {
      toast.error(`Cannot delete — ${count} guide(s) assigned`);
      return;
    }
    setDeleteConfirmId(id);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    const { error } = await supabase.from("categories").delete().eq("id", deleteConfirmId);
    setDeleteConfirmId(null);
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    toast.success("Category deleted");
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Categories</h1>
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

      <div className="bg-card rounded-lg border">
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
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => renameCategory(cat.id)}><Check className="w-4 h-4 text-success" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                    </div>
                  ) : (
                    <span className="font-medium text-sm">{cat.name}</span>
                  )}
                </td>
                <td className="p-3"><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{cat.slug}</code></td>
                <td className="p-3 text-center text-sm text-muted-foreground">{guideCount(cat.id)}</td>
                <td className="p-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingId(cat.id); setEditName(cat.name); }}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteCategory(cat.id)}>
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

    <AlertDialog open={!!deleteConfirmId} onOpenChange={(v) => { if (!v) setDeleteConfirmId(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete category?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the category. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
