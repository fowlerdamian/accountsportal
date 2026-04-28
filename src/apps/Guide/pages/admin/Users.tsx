import { useProfiles } from "@guide/hooks/use-supabase-query";
import { Button } from "@guide/components/ui/button";
import { Badge } from "@guide/components/ui/badge";
import { Plus, Shield, Loader2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@guide/components/ui/dialog";
import { Input } from "@guide/components/ui/input";
import { Label } from "@guide/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { useState } from "react";
import { supabase } from "@guide/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export default function Users() {
  const { data: profiles = [], isLoading } = useProfiles();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const resetForm = () => {
    setFullName("");
    setEmail("");
    setRole("editor");
  };

  const handleDelete = async (userId: string) => {
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-user", {
        body: { user_id: userId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("User deleted");
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to delete user");
    } finally {
      setDeleting(false);
    }
  };

  const handleInvite = async () => {
    if (!email.trim()) {
      toast.error("Email is required");
      return;
    }
    setInviting(true);
    try {
      const { data, error } = await supabase.functions.invoke("invite-user", {
        body: { email: email.trim(), full_name: fullName.trim(), role },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(data?.message || "User invited successfully");
      setOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to invite user");
    } finally {
      setInviting(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-muted-foreground text-sm">Manage staff access to the Guide platform</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> Invite User</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Invite New User</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Full Name</Label>
                <Input placeholder="Jane Smith" className="mt-1.5" value={fullName} onChange={e => setFullName(e.target.value)} />
              </div>
              <div>
                <Label>Email</Label>
                <Input placeholder="jane@aga.com.au" type="email" className="mt-1.5" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div>
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">The user will be created and can log in via magic link.</p>
              <Button className="w-full" onClick={handleInvite} disabled={inviting}>
                {inviting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Send Invite
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card rounded-lg border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Name</th>
              <th className="text-center p-3 text-xs font-semibold text-muted-foreground uppercase">Role</th>
              <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase">Joined</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((user: any) => (
              <tr key={user.id} className="border-b hover:bg-muted/30 group">
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                      {(user.full_name || '?').split(' ').map((n: string) => n[0]).join('').toUpperCase()}
                    </div>
                    <span className="font-medium text-sm">{user.full_name || '—'}</span>
                  </div>
                </td>
                <td className="p-3 text-center">
                  {user.role ? (
                    <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className={user.role === 'admin' ? 'bg-primary' : ''}>
                      <Shield className="w-3 h-3 mr-1" />
                      {user.role}
                    </Badge>
                  ) : (
                    <Badge variant="outline">No role</Badge>
                  )}
                </td>
                <td className="p-3 text-sm text-muted-foreground">
                  {new Date(user.created_at).toLocaleDateString()}
                </td>
                <td className="p-3 text-right">
                  {confirmDeleteId === user.id ? (
                    <div className="flex items-center justify-end gap-1.5">
                      <Button size="sm" variant="destructive" className="h-7 px-2 text-xs"
                        disabled={deleting}
                        onClick={() => handleDelete(user.id)}>
                        {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Delete"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                        onClick={() => setConfirmDeleteId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => setConfirmDeleteId(user.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr><td colSpan={3} className="p-8 text-center text-muted-foreground">No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
