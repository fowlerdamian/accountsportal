import { useBrands } from "@guide/hooks/use-supabase-query";
import { supabase } from "@guide/integrations/supabase/client";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Label } from "@guide/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";

import { Pencil, ExternalLink, Loader2, Upload, X } from "lucide-react";
import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@guide/components/ui/dialog";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Tables } from "@guide/integrations/supabase/types";

export default function Brands() {
  const { data: brands = [], isLoading } = useBrands();
  const [editBrand, setEditBrand] = useState<Tables<"brands"> | null>(null);
  const queryClient = useQueryClient();
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formColour, setFormColour] = useState("");
  const [formDymo, setFormDymo] = useState("");
  const [formLogoUrl, setFormLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const openEdit = (b: Tables<"brands">) => {
    setEditBrand(b);
    setFormName(b.name);
    setFormPhone(b.support_phone ?? "");
    setFormEmail(b.support_email ?? "");
    setFormColour(b.primary_colour);
    setFormDymo(b.dymo_label_size);
    setFormLogoUrl(b.logo_url);
  };

  const uploadLogo = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error("Only images"); return; }
    setUploading(true);
    const ext = file.name.split('.').pop() || 'png';
    const path = `logos/${editBrand?.key}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('guide-images').upload(path, file, { upsert: true });
    if (error) { toast.error(error.message); setUploading(false); return; }
    const { data } = supabase.storage.from('guide-images').getPublicUrl(path);
    setFormLogoUrl(data.publicUrl);
    setUploading(false);
  };

  const saveChanges = async () => {
    if (!editBrand) return;
    const { error } = await (supabase.from("brands").update as any)({
      name: formName,
      support_phone: formPhone || null,
      support_email: formEmail || null,
      primary_colour: formColour,
      dymo_label_size: formDymo,
      logo_url: formLogoUrl,
    }).eq("id", editBrand.id);
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["brands"] });
    setEditBrand(null);
    toast.success("Brand updated");
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Brands</h1>
        <p className="text-muted-foreground text-sm">Manage brand settings for customer-facing guides</p>
      </div>

      <div className="grid gap-4">
        {brands.map(b => (
          <div key={b.id} className="bg-card rounded-lg border p-5">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  {b.logo_url ? (
                    <img src={b.logo_url} alt={b.name} className="h-10 w-10 object-contain rounded-lg" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold" style={{ backgroundColor: b.primary_colour + '20', color: b.primary_colour }}>
                      {b.key === 'trailbait' ? 'TB' : 'AGA'}
                    </div>
                  )}
                  <div>
                    <h3 className="font-semibold">{b.name}</h3>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> {b.domain}
                    </p>
                  </div>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground mt-3">
                  <span>Phone: {b.support_phone ?? '—'}</span>
                  <span>Email: {b.support_email ?? '—'}</span>
                  <span>Dymo: {b.dymo_label_size}</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-muted-foreground">Primary colour:</span>
                  <div className="w-5 h-5 rounded border" style={{ backgroundColor: b.primary_colour }} />
                  <code className="text-xs">{b.primary_colour}</code>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => openEdit(b)}>
                <Pencil className="w-4 h-4 mr-2" /> Edit
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!editBrand} onOpenChange={() => setEditBrand(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit {editBrand?.name}</DialogTitle></DialogHeader>
          {editBrand && (
            <div className="space-y-4">
              <div>
                <Label>Brand Logo</Label>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) uploadLogo(e.target.files[0]); }} />
                <div className="mt-1.5">
                  {formLogoUrl ? (
                    <div className="relative inline-block">
                      <img src={formLogoUrl} alt="" className="h-16 object-contain rounded border p-1" />
                      <button className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5" onClick={() => setFormLogoUrl(null)}><X className="w-3 h-3" /></button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => logoInputRef.current?.click()} disabled={uploading}>
                      {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                      Upload Logo
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <Label>Brand Name</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label>Domain (read-only)</Label>
                <Input value={editBrand.domain} disabled className="mt-1.5" />
              </div>
              <div>
                <Label>Support Phone</Label>
                <Input value={formPhone} onChange={e => setFormPhone(e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label>Support Email</Label>
                <Input value={formEmail} onChange={e => setFormEmail(e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label>Primary Colour</Label>
                <div className="flex gap-2 mt-1.5">
                  <Input value={formColour} onChange={e => setFormColour(e.target.value)} />
                  <input type="color" value={formColour} onChange={e => setFormColour(e.target.value)} className="w-10 h-10 rounded border cursor-pointer" />
                </div>
              </div>
              <div>
                <Label>Dymo Label Size</Label>
                <Select value={formDymo} onValueChange={setFormDymo}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="99012">99012 — Large Address (36×89mm) ★ Default</SelectItem>
                    <SelectItem value="30332">30332 — Square (25×25mm)</SelectItem>
                    <SelectItem value="30334">30334 — Multi-Purpose (57×32mm)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" onClick={saveChanges}>Save Changes</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
