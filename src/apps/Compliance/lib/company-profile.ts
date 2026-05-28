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

// Derive a CompanyProfile from portal-side knowledge: the brand record
// matched to the user's email domain, plus the authenticated user.
// Fields the portal doesn't track (ABN, address, etc.) stay blank — the
// dashboard and PDF export skip blank values gracefully.
export function deriveCompanyProfile(brand: BrandRow | null, user: UserInfo, director: DirectorInfo = {}): CompanyProfile {
  const userDomain = user.email?.split('@')[1]?.toLowerCase() ?? '';
  const brandDomain = brand?.domain?.replace(/^(guide|support|www)\./, '') ?? '';
  const website = brandDomain ? `www.${brandDomain}` : userDomain ? `www.${userDomain}` : '';

  return {
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
}
