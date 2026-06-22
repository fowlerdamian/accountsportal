import { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useISO } from '../contexts/ISOContext';
import { CompanyOverrides } from '../lib/company-profile';
import { motion } from 'framer-motion';
import { ArrowLeft, Save, Upload, Building2, MapPin, User, Factory, Globe, Lock, PenLine, RotateCcw, Check, Trash2, Image as ImageIcon, X } from 'lucide-react';
import { UploadIcon } from '@portal/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import SignatureCanvas from 'react-signature-canvas';

const AUSTRALIAN_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
const INDUSTRIES = [
  'Manufacturing', 'Construction', 'Transport, Postal & Warehousing',
  'Professional, Scientific & Technical Services', 'Health Care & Social Assistance',
  'Retail Trade', 'Wholesale Trade', 'Mining', 'Agriculture, Forestry & Fishing', 'Other Services',
];
const EMPLOYEE_BUCKETS = ['1-10', '11-50', '51-100', '101-250', '251-500', '500+'];

type FormState = Record<keyof CompanyOverrides, string>;

const FIELD_KEYS: Array<keyof CompanyOverrides> = [
  'companyName', 'abn', 'industry', 'address', 'suburb', 'state', 'postcode', 'country',
  'phone', 'email', 'website', 'contactName', 'contactTitle', 'employeeCount', 'mainProducts',
];

export default function ComplianceCompanyDetails() {
  const navigate = useNavigate();
  const {
    companyProfile, companyOverrides, setCompanyOverrides,
    pushProfileToDocuments, documents,
    directorSignature, setDirectorSignature,
    companyLogo, setCompanyLogo,
  } = useISO();

  const initialForm = useMemo<FormState>(() => {
    const f: FormState = {} as FormState;
    for (const key of FIELD_KEYS) f[key] = (companyProfile?.[key] as string) ?? '';
    return f;
  }, [companyProfile]);

  const [form, setForm] = useState<FormState>(initialForm);
  const [isPushing, setIsPushing] = useState(false);
  const sigPadRef = useRef<SignatureCanvas>(null);
  const [sigDraft, setSigDraft] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const update = (field: keyof CompanyOverrides, value: string) => setForm((p) => ({ ...p, [field]: value }));

  const handleSigEnd = () => {
    setSigDraft(sigPadRef.current?.toDataURL('image/png') ?? null);
  };

  const handleSigClear = () => {
    sigPadRef.current?.clear();
    setSigDraft(null);
  };

  const handleSigSave = () => {
    if (!sigDraft) { toast.error('Draw your signature first'); return; }
    setDirectorSignature(sigDraft);
    setSigDraft(null);
    toast.success('Signature saved');
  };

  const handleSigRemove = () => {
    setDirectorSignature(null);
    setSigDraft(null);
    sigPadRef.current?.clear();
    toast.success('Signature removed');
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Logo must be under 5MB'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 400;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) { toast.error('Could not process image'); return; }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', 0.75);
        setCompanyLogo(compressed);
        toast.success('Logo updated');
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const handleLogoRemove = () => {
    setCompanyLogo(null);
    if (logoInputRef.current) logoInputRef.current.value = '';
    toast.success('Logo reset to brand default');
  };

  const handleSave = () => {
    const next: CompanyOverrides = {};
    for (const key of FIELD_KEYS) {
      const value = form[key]?.trim() ?? '';
      if (value) (next as any)[key] = value;
    }
    setCompanyOverrides(next);
    toast.success('Company details saved');
  };

  const handlePush = () => {
    handleSave();
    setIsPushing(true);
    try {
      const result = pushProfileToDocuments();
      if (result.replacements === 0) {
        toast.info(`No stale references found across ${result.docsScanned} document(s)`);
      } else {
        toast.success(`Updated ${result.docsUpdated} document(s) · ${result.replacements} replacement(s)`);
      }
    } finally {
      setIsPushing(false);
    }
  };

  const completedDocs = documents.filter((d) => !!d.generatedContent).length;

  return (
    <div className="min-h-full overflow-y-auto">
      <header className="border-b border-border px-6 py-4 sticky top-0 bg-background/80 backdrop-blur z-10">
        <div className="mx-auto max-w-3xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/compliance')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-base font-bold text-foreground flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" /> Company Details
              </h1>
              <p className="text-xs text-muted-foreground">Contact details and address used in document headers</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" className="gap-1.5" onClick={handleSave}>
              <Save className="h-3.5 w-3.5" /> Save
            </Button>
            <Button size="sm" className="gap-1.5 glow-gold" onClick={handlePush} disabled={isPushing || completedDocs === 0}>
              <Upload className="h-3.5 w-3.5" />
              {isPushing ? 'Pushing…' : `Push to ${completedDocs} doc${completedDocs === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="rounded-xl border border-border/60 bg-secondary/30 p-4 text-sm text-muted-foreground flex items-start gap-3">
            <Lock className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div>
              Brand name defaults to the staff portal value. Any field you change below
              overrides the portal default for ISO documents. Click <span className="font-semibold text-foreground">Push</span> to
              find and replace stale values in {completedDocs} already-generated document{completedDocs === 1 ? '' : 's'}.
            </div>
          </div>
        </motion.div>

        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border card-gradient p-6">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
            <ImageIcon className="h-4 w-4" /> Logo
          </h3>
          <div className="flex items-center gap-6">
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            {companyProfile?.logoUrl ? (
              <div className="relative">
                <img src={companyProfile.logoUrl} alt="Logo" className="h-24 w-24 rounded-xl border border-border object-contain bg-secondary p-2" />
                {companyLogo && (
                  <button type="button" onClick={handleLogoRemove} aria-label="Reset to brand default" className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ) : (
              <button type="button" onClick={() => logoInputRef.current?.click()} className="flex h-24 w-24 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                <UploadIcon className="h-6 w-6 mb-1" />
                <span className="text-xs">Upload</span>
              </button>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground">PNG, JPG or SVG. Max 5MB. Will appear on document headers.</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {companyLogo ? 'Using custom upload.' : 'Showing brand default — upload to override.'}
              </p>
              <div className="mt-3 flex gap-2">
                <Button type="button" size="sm" variant="secondary" className="gap-1.5 text-xs" onClick={() => logoInputRef.current?.click()}>
                  <Upload className="h-3 w-3" /> {companyLogo ? 'Replace' : 'Upload'}
                </Button>
                {companyLogo && (
                  <Button type="button" size="sm" variant="ghost" className="gap-1.5 text-xs text-destructive hover:text-destructive" onClick={handleLogoRemove}>
                    <Trash2 className="h-3 w-3" /> Reset to brand
                  </Button>
                )}
              </div>
            </div>
          </div>
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border card-gradient p-6">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Company
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="companyName">Company Name</Label>
              <Input id="companyName" value={form.companyName} onChange={(e) => update('companyName', e.target.value)} className="mt-1" />
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
                  {INDUSTRIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border card-gradient p-6">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Address
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="address">Street Address</Label>
              <Input id="address" value={form.address} onChange={(e) => update('address', e.target.value)} placeholder="123 Industrial Drive" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="suburb">Suburb</Label>
              <Input id="suburb" value={form.suburb} onChange={(e) => update('suburb', e.target.value)} className="mt-1" />
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
              <Input id="postcode" value={form.postcode} onChange={(e) => update('postcode', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="country">Country</Label>
              <Input id="country" value={form.country} onChange={(e) => update('country', e.target.value)} className="mt-1" />
            </div>
          </div>
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border card-gradient p-6">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
            <User className="h-4 w-4" /> Contact
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="contactName">Contact Name</Label>
              <Input id="contactName" value={form.contactName} onChange={(e) => update('contactName', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="contactTitle">Title / Position</Label>
              <Input id="contactTitle" value={form.contactTitle} onChange={(e) => update('contactTitle', e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="+61 3 9000 0000" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} className="mt-1" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="website">Website</Label>
              <div className="relative mt-1">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="website" value={form.website} onChange={(e) => update('website', e.target.value)} className="pl-10" />
              </div>
            </div>
          </div>
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border card-gradient p-6">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
            <Factory className="h-4 w-4" /> Business
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="employeeCount">Number of Employees</Label>
              <Select value={form.employeeCount} onValueChange={(v) => update('employeeCount', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select range" /></SelectTrigger>
                <SelectContent>
                  {EMPLOYEE_BUCKETS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="mainProducts">Main Products / Services</Label>
              <Textarea id="mainProducts" value={form.mainProducts} onChange={(e) => update('mainProducts', e.target.value)} rows={3} className="mt-1" />
            </div>
          </div>
        </motion.section>

        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border card-gradient p-6">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-2">
            <PenLine className="h-4 w-4" /> Director Signature
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            Signing as <span className="font-semibold text-foreground">{companyProfile?.contactName || 'Director'}</span>
            {companyProfile?.contactTitle && <> · {companyProfile.contactTitle}</>}. Appears on all generated ISO documents.
          </p>

          {directorSignature && !sigDraft && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Current</p>
              <div className="rounded-xl border border-border bg-white p-4 flex items-center justify-center">
                <img src={directorSignature} alt="Director signature" className="max-h-28" />
              </div>
              <Button variant="ghost" size="sm" className="mt-2 gap-1.5 text-destructive hover:text-destructive" onClick={handleSigRemove}>
                <Trash2 className="h-3.5 w-3.5" /> Remove signature
              </Button>
            </div>
          )}

          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            {directorSignature ? 'Replace signature' : 'Draw signature'}
          </p>
          <div className="rounded-xl border border-border bg-white overflow-hidden">
            <SignatureCanvas
              ref={sigPadRef}
              penColor="#1a1a2e"
              canvasProps={{ className: 'w-full', height: 180, style: { width: '100%', display: 'block' } }}
              onEnd={handleSigEnd}
            />
          </div>

          <div className="flex items-center justify-between mt-3">
            {sigDraft
              ? <span className="text-xs text-success flex items-center gap-1"><PenLine className="h-3 w-3" /> Ready to save</span>
              : <span className="text-xs text-muted-foreground">Sign in the box above with your mouse or touch screen</span>
            }
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={handleSigClear}>
                <RotateCcw className="h-3 w-3" /> Clear
              </Button>
              <Button type="button" size="sm" className="gap-1.5 text-xs glow-gold" disabled={!sigDraft} onClick={handleSigSave}>
                <Check className="h-3 w-3" /> Save signature
              </Button>
            </div>
          </div>
        </motion.section>

        {/* Spacer so the bottom buttons aren't hidden */}
        <div className="h-2" />
      </main>
    </div>
  );
}
