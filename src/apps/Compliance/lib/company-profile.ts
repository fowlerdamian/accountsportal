export interface CompanyProfile {
  companyName: string;
  abn: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  industry: string;
  employeeCount: string;
  mainProducts: string;
  logoUrl: string | null;
  contactName: string;
  contactTitle: string;
  signatureDataUrl: string | null;
}

export const BLANK_COMPANY_PROFILE: CompanyProfile = {
  companyName: '',
  abn: '',
  address: '',
  suburb: '',
  state: '',
  postcode: '',
  country: 'Australia',
  phone: '',
  email: '',
  website: '',
  industry: '',
  employeeCount: '',
  mainProducts: '',
  logoUrl: null,
  contactName: '',
  contactTitle: '',
  signatureDataUrl: null,
};

interface BrandRow {
  name?: string | null;
  domain?: string | null;
  logo_url?: string | null;
  support_phone?: string | null;
  support_email?: string | null;
}

interface UserInfo {
  email?: string | null;
  fullName?: string | null;
}

interface DirectorInfo {
  signatureDataUrl?: string | null;
}

// Damian Fowler is the director of record for the portal tenant.
// Used as the default when profiles.full_name is missing.
export const DEFAULT_DIRECTOR_NAME = 'Damian Fowler';
export const DEFAULT_DIRECTOR_TITLE = 'Director';

// Editable subset of the company profile — fields the user can override on top
// of brand-derived defaults via the Company Details page.
export type CompanyOverrides = Partial<Omit<CompanyProfile, 'logoUrl' | 'signatureDataUrl'>>;

// Fields used by the "push" flow to find/replace stale references in older docs.
// Short / generic values (state, country, employeeCount) are excluded to avoid
// accidental matches on common substrings.
export const PUSHABLE_FIELDS: Array<keyof CompanyProfile> = [
  'companyName', 'abn', 'address', 'suburb', 'postcode',
  'phone', 'email', 'website', 'industry', 'mainProducts',
  'contactName', 'contactTitle',
];

export function profileSnapshot(profile: CompanyProfile): Record<string, string> {
  const snap: Record<string, string> = {};
  for (const key of PUSHABLE_FIELDS) {
    const value = profile[key];
    if (typeof value === 'string' && value.trim().length >= 3) snap[key] = value;
  }
  return snap;
}

// Derive a CompanyProfile from portal-side knowledge: the brand record
// matched to the user's email domain, plus the authenticated user, plus any
// user-supplied overrides. Overrides win where present and non-empty.
export function deriveCompanyProfile(
  brand: BrandRow | null,
  user: UserInfo,
  director: DirectorInfo = {},
  overrides: CompanyOverrides = {},
): CompanyProfile {
  const userDomain = user.email?.split('@')[1]?.toLowerCase() ?? '';
  const brandDomain = brand?.domain?.replace(/^(guide|support|www)\./, '') ?? '';
  const website = brandDomain ? `www.${brandDomain}` : userDomain ? `www.${userDomain}` : '';

  const base: CompanyProfile = {
    ...BLANK_COMPANY_PROFILE,
    companyName: brand?.name ?? '',
    logoUrl: brand?.logo_url || null,
    phone: brand?.support_phone ?? '',
    email: brand?.support_email ?? user.email ?? '',
    website,
    contactName: user.fullName?.trim() || DEFAULT_DIRECTOR_NAME,
    contactTitle: DEFAULT_DIRECTOR_TITLE,
    signatureDataUrl: director.signatureDataUrl ?? null,
  };

  // Merge overrides: non-empty string overrides win.
  for (const key of Object.keys(overrides) as Array<keyof CompanyOverrides>) {
    const value = overrides[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      (base as any)[key] = value;
    }
  }

  return base;
}
