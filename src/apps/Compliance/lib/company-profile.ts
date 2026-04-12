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

export const EMPTY_COMPANY_PROFILE: CompanyProfile = {
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
