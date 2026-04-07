import { Tabs, TabsContent, TabsList, TabsTrigger } from "@guide/components/ui/tabs";
import { Users, Tag, Printer, FolderOpen, Settings2, User } from "lucide-react";
import UsersTab from "@guide/pages/admin/Users";
import BrandsTab from "@guide/pages/admin/Brands";
import CategoriesTab from "@guide/pages/admin/Categories";
import { useAuth } from "@guide/contexts/AuthContext";
import { useSearchParams } from "react-router-dom";

export default function Settings() {
  const { userRole } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "profile";

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm">Manage your profile, brands, users, labels, and platform settings</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full flex overflow-x-auto">
          <TabsTrigger value="profile" className="flex-1 gap-1.5">
            <User className="w-4 h-4 hidden sm:block" /> Profile
          </TabsTrigger>
          <TabsTrigger value="general" className="flex-1 gap-1.5">
            <Settings2 className="w-4 h-4 hidden sm:block" /> General
          </TabsTrigger>
          <TabsTrigger value="brands" className="flex-1 gap-1.5">
            <Tag className="w-4 h-4 hidden sm:block" /> Brands
          </TabsTrigger>
          {userRole === "admin" && (
            <TabsTrigger value="users" className="flex-1 gap-1.5">
              <Users className="w-4 h-4 hidden sm:block" /> Users
            </TabsTrigger>
          )}
          <TabsTrigger value="labels" className="flex-1 gap-1.5">
            <Printer className="w-4 h-4 hidden sm:block" /> Labels
          </TabsTrigger>
          <TabsTrigger value="categories" className="flex-1 gap-1.5">
            <FolderOpen className="w-4 h-4 hidden sm:block" /> Categories
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <ProfileSettings />
        </TabsContent>

        <TabsContent value="general" className="mt-6">
          <GeneralSettings />
        </TabsContent>

        <TabsContent value="brands" className="mt-6">
          <BrandsTab />
        </TabsContent>

        {userRole === "admin" && (
          <TabsContent value="users" className="mt-6">
            <UsersTab />
          </TabsContent>
        )}

        <TabsContent value="labels" className="mt-6">
          <LabelsSettings />
        </TabsContent>

        <TabsContent value="categories" className="mt-6">
          <CategoriesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Profile Settings Tab ---
import { supabase } from "@guide/integrations/supabase/client";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Label } from "@guide/components/ui/label";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

function ProfileSettings() {
  const { user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setEmail(user.email || "");

    // Fetch profile
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setFullName(data?.full_name || "");
        setLoading(false);
      });
  }, [user]);

  const saveName = async () => {
    if (!user) return;
    setSavingName(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", user.id);
    setSavingName(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Name updated");
    }
  };

  const saveEmail = async () => {
    if (!user || email === user.email) return;
    setSavingEmail(true);
    const { error } = await supabase.auth.updateUser({
      email,
    });
    setSavingEmail(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Confirmation email sent to your new address. Please check your inbox to confirm the change.");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Your Profile</h2>
        <p className="text-muted-foreground text-sm">Update your personal information</p>
      </div>

      <div className="bg-card rounded-lg border p-5 space-y-5">
        {/* Full Name */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Full Name</Label>
          <div className="flex gap-3">
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              className="flex-1"
            />
            <Button size="sm" onClick={saveName} disabled={savingName}>
              {savingName ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Save
            </Button>
          </div>
        </div>

        {/* Email */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Email Address</Label>
          <div className="flex gap-3">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={saveEmail}
              disabled={savingEmail || email === user?.email}
            >
              {savingEmail ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Update
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Changing your email will send a confirmation to the new address.
          </p>
        </div>

        {/* Role (read-only) */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Role</Label>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary capitalize">
              {useAuth().userRole || "—"}
            </span>
            <span className="text-xs text-muted-foreground">Contact an admin to change your role</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- General Settings Tab ---
import { useBrands } from "@guide/hooks/use-supabase-query";
import { Switch } from "@guide/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@guide/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";

function GeneralSettings() {
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
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["brands"] });
    toast.success(enabled ? "Chat support enabled" : "Chat support disabled");
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">General</h2>
        <p className="text-muted-foreground text-sm">Platform-wide settings</p>
      </div>

      <div className="bg-card rounded-lg border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <MessageCircle className="w-5 h-5 text-primary" />
            </div>
            <div>
              <Label className="text-sm font-semibold">Customer Chat / Support</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Show the help button on all published guides. When disabled, customers won't see the support chat.</p>
            </div>
          </div>
          <Switch checked={currentChat} onCheckedChange={toggleChat} disabled={saving} />
        </div>
      </div>
    </div>
  );
}

// --- Labels Settings Tab ---

const DYMO_SIZES = [
  { value: "99012", label: "99012 — Large Address (36×89mm) ★ Default", w: 89, h: 36 },
  { value: "30332", label: "30332 — Square (25×25mm)", w: 25, h: 25 },
  { value: "30334", label: "30334 — Multi-Purpose (57×32mm)", w: 57, h: 32 },
];

function LabelsSettings() {
  const { data: brands = [], isLoading } = useBrands();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const [localSizes, setLocalSizes] = useState<Record<string, string>>({});

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const getSize = (brandId: string, fallback: string) => localSizes[brandId] ?? fallback;

  const saveSize = async (brandId: string) => {
    const size = localSizes[brandId];
    if (!size) return;
    setSaving(brandId);
    const { error } = await (supabase.from("brands").update as any)({ dymo_label_size: size }).eq("id", brandId);
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["brands"] });
    toast.success("Label size updated");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Label Templates</h2>
        <p className="text-muted-foreground text-sm">Configure Dymo label sizes for each brand.</p>
      </div>

      <div className="space-y-4">
        {brands.map(brand => (
          <div key={brand.id} className="bg-card rounded-lg border p-5">
            <div className="flex items-center gap-3 mb-4">
              {brand.logo_url ? (
                <img src={brand.logo_url} alt={brand.name} className="h-8 w-8 object-contain rounded" />
              ) : (
                <div className="w-8 h-8 rounded flex items-center justify-center text-xs font-bold bg-muted text-muted-foreground">
                  {brand.key.slice(0, 2).toUpperCase()}
                </div>
              )}
              <h3 className="font-medium">{brand.name}</h3>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
              <div className="flex-1 w-full">
                <Label className="text-sm">Dymo Label Size</Label>
                <Select
                  value={getSize(brand.id, brand.dymo_label_size)}
                  onValueChange={v => setLocalSizes(prev => ({ ...prev, [brand.id]: v }))}
                >
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DYMO_SIZES.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                disabled={!localSizes[brand.id] || localSizes[brand.id] === brand.dymo_label_size || saving === brand.id}
                onClick={() => saveSize(brand.id)}
              >
                {saving === brand.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                Save
              </Button>
            </div>

            {(() => {
              const selectedSize = DYMO_SIZES.find(s => s.value === getSize(brand.id, brand.dymo_label_size));
              const w = selectedSize?.w ?? 89;
              const h = selectedSize?.h ?? 28;
              const scale = 3.5;
              const previewW = w * scale;
              const previewH = h * scale;
              const qrSize = Math.min(previewH - 8, previewW * 0.35);
              return (
                <div className="mt-4 p-3 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground mb-2">Label preview ({selectedSize?.label})</p>
                    <div
                    className="bg-white border rounded flex items-stretch gap-2 p-2 transition-all duration-200"
                    style={{ width: previewW, height: previewH }}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 overflow-hidden flex-1 justify-between">
                      {brand.logo_url && <img src={brand.logo_url} alt="" className="h-3 object-contain self-start" />}
                      <span className="text-[8px] font-bold leading-tight truncate text-black">PRODUCT NAME</span>
                      <span className="text-[7px] text-gray-600 truncate font-mono">PRODUCT-CODE</span>
                      <span className="text-[6px] text-gray-500 italic truncate">Scan for install guide</span>
                    </div>
                    <div
                      className="border-2 border-gray-300 rounded flex items-center justify-center shrink-0"
                      style={{ width: qrSize, height: qrSize }}
                    >
                      <span className="text-[7px] text-gray-400">QR</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}
