import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@guide/components/ui/dialog";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Label } from "@guide/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCreateContractor } from "@guide/hooks/use-hub-queries";
import type { ContractorSource, ContractorStatus } from "@guide/hooks/use-hub-queries";

interface NewContractorModalProps {
  open:      boolean;
  onClose:   () => void;
}

export function NewContractorModal({ open, onClose }: NewContractorModalProps) {
  const [name,        setName]        = useState("");
  const [email,       setEmail]       = useState("");
  const [phone,       setPhone]       = useState("");
  const [role,        setRole]        = useState("");
  const [hourlyRate,  setHourlyRate]  = useState("");
  const [source,      setSource]      = useState<ContractorSource>("direct");
  const [status,      setStatus]      = useState<ContractorStatus>("active");
  const [upworkId,    setUpworkId]    = useState("");
  const [saving,      setSaving]      = useState(false);

  const { mutateAsync: createContractor } = useCreateContractor();

  function resetForm() {
    setName(""); setEmail(""); setPhone(""); setRole("");
    setHourlyRate(""); setSource("direct"); setStatus("active"); setUpworkId("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !role.trim()) {
      toast.error("Name, email, and role are required");
      return;
    }
    setSaving(true);
    try {
      await createContractor({
        name:               name.trim(),
        email:              email.trim(),
        phone:              phone.trim() || null,
        role:               role.trim(),
        hourly_rate:        hourlyRate ? Number(hourlyRate) : null,
        status,
        source,
        upwork_contract_id: upworkId.trim() || null,
        upwork_profile_url: null,
        avatar_url:         null,
        notes:              null,
        can_login:          false,
        user_id:            null,
      });
      toast.success("Contractor added");
      resetForm();
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to add contractor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Contractor</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Email *</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+61 400 000 000" />
            </div>
            <div className="space-y-1.5">
              <Label>Role *</Label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. CAD Technician" />
            </div>
            <div className="space-y-1.5">
              <Label>Hourly Rate ($)</Label>
              <Input type="number" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="0" min="0" step="0.01" />
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select value={source} onValueChange={(v) => setSource(v as ContractorSource)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct">Direct</SelectItem>
                  <SelectItem value="upwork">Upwork</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ContractorStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="ended">Ended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {source === "upwork" && (
              <div className="space-y-1.5 col-span-2">
                <Label>Upwork Contract ID</Label>
                <Input value={upworkId} onChange={(e) => setUpworkId(e.target.value)} placeholder="~01234567890abcdef" />
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-2 justify-end">
            <Button type="button" variant="outline" onClick={() => { resetForm(); onClose(); }}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add Contractor
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
