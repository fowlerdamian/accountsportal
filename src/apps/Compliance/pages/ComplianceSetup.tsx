import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useISO } from '../context/ISOContext';
import { useAuth } from '@guide/contexts/AuthContext';
import { auditSupabase } from '../client';
import { CompanyProfile, EMPTY_COMPANY_PROFILE } from '../lib/company-profile';
import { motion } from 'framer-motion';
import { Shield, Upload, Building2, Globe, User, MapPin, Factory, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

const AUSTRALIAN_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

export default function ComplianceSetup() {
  const navigate = useNavigate();
  const { setCompanyProfile } = useISO();
  const { user } = useAuth();
  const [form, setForm] = useState<CompanyProfile>(EMPTY_COMPANY_PROFILE);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Check if company already exists for this domain
  useEffect(() => {
    const checkExisting = async () => {
      if (!user?.email) return;
      const domain = user.email.split('@')[1]?.toLowerCase();
      if (!domain) return;

      const { data: company } = await auditSupabase
        .from('company_settings')
        .select('id')
        .eq('allowed_domain', domain)
        .maybeSingle();

      if (company) {
        await auditSupabase.from('profiles').update({ company_id: company.id } as any).eq('user_id', user.id);
        navigate('..', { replace: true });
      }
    };
    checkExisting();
  }, [user?.email]);

  const update = (field: keyof CompanyProfile, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Logo must be under 5MB'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setLogoPreview(dataUrl);
      setForm((prev) => ({ ...prev, logoUrl: dataUrl }));
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setLogoPreview(null);
    setForm((prev) => ({ ...prev, logoUrl: null }));
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.companyName.trim()) { toast.error('Company name is required'); return; }
    if (!form.address.trim()) { toast.error('Address is required'); return; }
    if (!form.email.trim()) { toast.error('Email is required'); return; }

    try {
      if (!user) return;

      const domain = user.email?.split('@')[1]?.toLowerCase();
      let companySettingsId: string | null = null;

      if (domain) {
        const { data: existing } = await auditSupabase.from('company_settings').select('id').eq('allowed_domain', domain).maybeSingle();
        if (existing) {
          companySettingsId = existing.id;
        } else {
          const { data: newCompany } = await auditSupabase.from('company_settings').insert({ allowed_domain: domain, created_by: user.id }).select('id').single();
          companySettingsId = newCompany?.id || null;
        }
      }

      const { data: existingRole } = await auditSupabase.from('user_roles').select('id').eq('user_id', user.id).maybeSingle();
      if (!existingRole) {
        await auditSupabase.from('user_roles').insert({ user_id: user.id, role: 'admin', company_id: companySettingsId } as any);
      }

      const profileUpdate: any = {};
      if (companySettingsId) profileUpdate.company_id = companySettingsId;
      if (form.contactName.trim()) profileUpdate.full_name = form.contactName.trim();
      if (Object.keys(profileUpdate).length > 0) {
        await auditSupabase.from('profiles').update(profileUpdate).eq('user_id', user.id);
      }

      setCompanyProfile(form);
      toast.success('Company profile saved!');
      navigate('..', { replace: true });
    } catch (err) {
      console.error('Setup error:', err);
      toast.error('Failed to save company profile');
    }
  };

  return (
    <div className="min-h-full overflow-y-auto">
      <header className="border-b border-border px-6 py-5">
        <div className="mx-auto max-w-3xl flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
            <Shield className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">ISO 9001 Compliance</h1>
            <p className="text-sm text-muted-foreground">Company Profile Setup</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-2">Welcome — Let's Set Up Your Company</h2>
            <p className="text-muted-foreground">Enter your company details. This information will be used in document headers and as context for the AI.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Logo */}
            <section className="rounded-xl border border-border card-gradient p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                <Upload className="h-4 w-4" /> Company Logo
              </h3>
              <div className="flex items-center gap-6">
                <input type="file" ref={logoInputRef} onChange={handleLogoUpload} accept="image/*" className="hidden" />
                {logoPreview ? (
                  <div className="relative">
                    <img src={logoPreview} alt="Logo" className="h-24 w-24 rounded-xl border border-border object-contain bg-secondary p-2" />
                    <button type="button" onClick={removeLogo} className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => logoInputRef.current?.click()} className="flex h-24 w-24 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                    <Upload className="h-6 w-6 mb-1" />
                    <span className="text-xs">Upload</span>
                  </button>
                )}
                <p className="text-sm text-muted-foreground">PNG, JPG or SVG. Max 5MB. Will appear on document headers.</p>
              </div>
            </section>

            {/* Company Details */}
            <section className="rounded-xl border border-border card-gradient p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                <Building2 className="h-4 w-4" /> Company Details
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="companyName">Company Name *</Label>
                  <Input id="companyName" value={form.companyName} onChange={(e) => update('companyName', e.target.value)} placeholder="Acme Automotive Pty Ltd" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="abn">ABN</Label>
                  <Input id="abn" value={form.abn} onChange={(e) => update('abn', e.target.value)} placeholder="12 345 678 901" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="industry">Industry Sector</Label>
                  <Select value={form.industry} onValueChange={(v) => update('industry', v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select industry" /></SelectTrigger>
                    <SelectContent>
                      {['Manufacturing', 'Construction', 'Transport, Postal & Warehousing', 'Professional, Scientific & Technical Services', 'Health Care & Social Assistance', 'Retail Trade', 'Wholesale Trade', 'Mining', 'Agriculture, Forestry & Fishing', 'Other Services'].map((s) => (
                        <SelectItem key={s} value={s.toLowerCase().replace(/[^a-z0-9]+/g, '-')}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            {/* Address */}
            <section className="rounded-xl border border-border card-gradient p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Address
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="address">Street Address *</Label>
                  <Input id="address" value={form.address} onChange={(e) => update('address', e.target.value)} placeholder="123 Industrial Drive" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="suburb">Suburb</Label>
                  <Input id="suburb" value={form.suburb} onChange={(e) => update('suburb', e.target.value)} placeholder="Dandenong South" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="state">State</Label>
                  <Select value={form.state} onValueChange={(v) => update('state', v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select state" /></SelectTrigger>
                    <SelectContent>
                      {AUSTRALIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="postcode">Postcode</Label>
                  <Input id="postcode" value={form.postcode} onChange={(e) => update('postcode', e.target.value)} placeholder="3175" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="country">Country</Label>
                  <Input id="country" value={form.country} onChange={(e) => update('country', e.target.value)} className="mt-1" />
                </div>
              </div>
            </section>

            {/* Contact */}
            <section className="rounded-xl border border-border card-gradient p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                <User className="h-4 w-4" /> Primary Contact
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="contactName">Contact Name</Label>
                  <Input id="contactName" value={form.contactName} onChange={(e) => update('contactName', e.target.value)} placeholder="John Smith" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="contactTitle">Title / Position</Label>
                  <Input id="contactTitle" value={form.contactTitle} onChange={(e) => update('contactTitle', e.target.value)} placeholder="Quality Manager" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="+61 3 9000 0000" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="quality@company.com.au" className="mt-1" />
                </div>
              </div>
            </section>

            {/* Business Info */}
            <section className="rounded-xl border border-border card-gradient p-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
                <Factory className="h-4 w-4" /> Business Information
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="website">Website</Label>
                  <div className="relative mt-1">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="website" value={form.website} onChange={(e) => update('website', e.target.value)} placeholder="www.company.com.au" className="pl-10" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="employeeCount">Number of Employees</Label>
                  <Select value={form.employeeCount} onValueChange={(v) => update('employeeCount', v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select range" /></SelectTrigger>
                    <SelectContent>
                      {['1-10', '11-50', '51-100', '101-250', '251-500', '500+'].map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="mainProducts">Main Products / Services</Label>
                  <Textarea id="mainProducts" value={form.mainProducts} onChange={(e) => update('mainProducts', e.target.value)} placeholder="Describe your main products or services..." rows={3} className="mt-1" />
                </div>
              </div>
            </section>

            <Button type="submit" className="w-full py-6 text-lg font-bold glow-gold" size="lg">
              Continue to Dashboard
            </Button>
          </form>
        </motion.div>
      </main>
    </div>
  );
}
