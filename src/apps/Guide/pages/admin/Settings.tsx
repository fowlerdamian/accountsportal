import { Tabs, TabsContent, TabsList, TabsTrigger } from "@guide/components/ui/tabs";
import { Tag, Printer, FolderOpen, Send, Loader2, Save } from "lucide-react";
import { DeliverySettingsPanel } from "@guide/pages/admin/Deliveries";
import BrandsTab from "@guide/pages/admin/Brands";
import CategoriesTab from "@guide/pages/admin/Categories";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@guide/integrations/supabase/client";
import { Button } from "@guide/components/ui/button";
import { Label } from "@guide/components/ui/label";
import { Switch } from "@guide/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { useBrands } from "@guide/hooks/use-supabase-query";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircleIcon } from "@portal/components/icons";
import { useState } from "react";
import { toast } from "sonner";
import LabelPreview from "@guide/LabelPreview";
import { DEFAULT_LABEL_LOGO, DYMO_LABEL_SIZES, resolveDymoLabelSize } from "@guide/lib/dymoLabel";

const TABS = new Set(["brands", "labels", "categories", "delivery"]);

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab") || "";
  const activeTab = TABS.has(requested) ? requested : "brands";

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm">Brands, label templates, categories and auto-delivery</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full flex overflow-x-auto">
          <TabsTrigger value="brands" className="flex-1 gap-1.5">
            <Tag className="w-4 h-4 hidden sm:block" /> Brands
          </TabsTrigger>
          <TabsTrigger value="labels" className="flex-1 gap-1.5">
            <Printer className="w-4 h-4 hidden sm:block" /> Labels
          </TabsTrigger>
          <TabsTrigger value="categories" className="flex-1 gap-1.5">
            <FolderOpen className="w-4 h-4 hidden sm:block" /> Categories
          </TabsTrigger>
          <TabsTrigger value="delivery" className="flex-1 gap-1.5">
            <Send className="w-4 h-4 hidden sm:block" /> Auto-delivery
          </TabsTrigger>
        </TabsList>

        <TabsContent value="brands" className="mt-6 space-y-8">
          <BrandsTab embedded />
          <ChatSupportSetting />
        </TabsContent>

        <TabsContent value="labels" className="mt-6">
          <LabelsSettings />
        </TabsContent>

        <TabsContent value="categories" className="mt-6">
          <CategoriesTab embedded />
        </TabsContent>

        <TabsContent value="delivery" className="mt-6">
          <DeliverySettingsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Customer chat toggle (applies to every brand) ---

function ChatSupportSetting() {
  const { data: brands = [], isLoading } = useBrands();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const chatEnabled = brands.length > 0 && brands.every(b => (b as any).chat_enabled !== false);
  const [localChat, setLocalChat] = useState<boolean | null>(null);
  const currentChat = localChat ?? chatEnabled;

  const toggleChat = async (enabled: boolean) => {
    setLocalChat(enabled);
    setSaving(true);
    const { error } = await (supabase.from("brands").update as any)({ chat_enabled: enabled }).neq("id", "");
    setSaving(false);
    if (error) {
      // Revert the optimistic switch to the server value.
      setLocalChat(null);
      toast.error(error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["brands"] });
    toast.success(enabled ? "Chat support enabled" : "Chat support disabled");
  };

  if (isLoading) return null;

  return (
    <div className="bg-card rounded-lg border p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <MessageCircleIcon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <Label className="text-sm font-semibold">Customer Chat / Support</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Show the help button on all published guides, across every brand. When disabled, customers won't see the support chat.</p>
          </div>
        </div>
        <Switch checked={currentChat} onCheckedChange={toggleChat} disabled={saving} />
      </div>
    </div>
  );
}

// --- Label templates ---

interface LabelDraft { size: string }

function LabelsSettings() {
  const { data: brands = [], isLoading } = useBrands();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Partial<LabelDraft>>>({});

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const current = (brand: any): LabelDraft => ({
    size: drafts[brand.id]?.size ?? resolveDymoLabelSize(brand.dymo_label_size),
  });
  const isDirty = (brand: any) => current(brand).size !== resolveDymoLabelSize(brand.dymo_label_size);
  const setDraft = (brandId: string, patch: Partial<LabelDraft>) =>
    setDrafts(prev => ({ ...prev, [brandId]: { ...prev[brandId], ...patch } }));

  const save = async (brand: any) => {
    const c = current(brand);
    setSaving(brand.id);
    const { error } = await (supabase.from("brands").update as any)({ dymo_label_size: c.size }).eq("id", brand.id);
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    setDrafts(prev => { const next = { ...prev }; delete next[brand.id]; return next; });
    queryClient.invalidateQueries({ queryKey: ["brands"] });
    toast.success(`${brand.name} label template saved`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Label Templates</h2>
        <p className="text-muted-foreground text-sm">
          The DYMO QR label printed from a guide's Share page. Pick the paper size loaded in the LabelWriter for each brand. The logo on the label is chosen per guide, in the guide editor.
        </p>
      </div>

      <div className="space-y-4">
        {brands.map(brand => {
          const c = current(brand);
          return (
            <div key={brand.id} className="bg-card rounded-lg border p-5">
              <div className="flex items-center gap-3 mb-4">
                {brand.logo_url ? (
                  <img src={brand.logo_url} alt={brand.name} className="h-8 w-8 object-contain rounded bg-white p-0.5" />
                ) : (
                  <div className="w-8 h-8 rounded flex items-center justify-center text-xs font-bold bg-muted text-muted-foreground">
                    {brand.key.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <h3 className="font-medium">{brand.name}</h3>
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] items-start">
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm">DYMO label size</Label>
                    <Select value={c.size} onValueChange={v => setDraft(brand.id, { size: v })}>
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DYMO_LABEL_SIZES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {c.size === "30332" && <p className="text-xs text-muted-foreground">The square label only has room for the QR code and product code.</p>}
                  <Button size="sm" disabled={!isDirty(brand) || saving === brand.id} onClick={() => save(brand)}>
                    {saving === brand.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                    Save
                  </Button>
                </div>

                <div className="p-4 bg-muted rounded-lg w-fit max-w-full overflow-x-auto">
                  <p className="text-xs text-muted-foreground mb-3">Preview — actual size</p>
                  <LabelPreview
                    size={c.size}
                    logo={DEFAULT_LABEL_LOGO}
                    url={`https://${brand.domain}/example-guide`}
                    productCode="BGLBTP1"
                    title="Behind Grille Light Bar — Toyota Prado 150"
                    ppi={96}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
