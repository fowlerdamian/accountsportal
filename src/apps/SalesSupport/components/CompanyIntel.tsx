import { Building2, Users, Calendar, DollarSign, Mail, Hash } from "lucide-react";
import type { SalesLead } from "../hooks/useSalesQueries";

interface Props {
  lead: Pick<
    SalesLead,
    | "industry" | "employee_count" | "founded_year" | "annual_revenue_estimate"
    | "tech_stack" | "abn" | "scraped_emails" | "scraped_phones"
    | "hunter_email_pattern" | "hunter_contacts" | "email"
  >;
}

export default function CompanyIntel({ lead }: Props) {
  const hasCompanyData =
    lead.industry || lead.employee_count || lead.founded_year ||
    lead.annual_revenue_estimate || lead.abn;

  const hasTech    = (lead.tech_stack?.length ?? 0) > 0;
  const hasEmails  = (lead.scraped_emails?.length ?? 0) > 0 || (lead.hunter_contacts?.length ?? 0) > 0 || lead.hunter_email_pattern;

  if (!hasCompanyData && !hasTech && !hasEmails) return null;

  const allEmails = [
    ...(lead.hunter_contacts?.map(c => ({ ...c, source: "hunter" })) ?? []),
    ...(lead.scraped_emails?.filter(e =>
      !lead.hunter_contacts?.some(h => h.email.toLowerCase() === e.toLowerCase())
    ).map(e => ({ name: null as string | null, email: e, position: null as string | null, confidence: 0, source: "website" })) ?? []),
  ].slice(0, 8);

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Building2 className="w-3.5 h-3.5" />
        Company Intel
      </div>

      {/* Firmographics */}
      {hasCompanyData && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {lead.industry && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-500/10 text-violet-400 border border-violet-500/20 rounded-full font-medium">
              {lead.industry}
            </span>
          )}
          {lead.employee_count && (
            <span className="inline-flex items-center gap-1">
              <Users className="w-3 h-3" />
              {lead.employee_count.toLocaleString()} employees
            </span>
          )}
          {lead.founded_year && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Est. {lead.founded_year}
            </span>
          )}
          {lead.annual_revenue_estimate && (
            <span className="inline-flex items-center gap-1">
              <DollarSign className="w-3 h-3" />
              {lead.annual_revenue_estimate}
            </span>
          )}
          {lead.abn && (
            <span className="inline-flex items-center gap-1 font-mono">
              <Hash className="w-3 h-3" />
              ABN {lead.abn.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4")}
            </span>
          )}
        </div>
      )}

      {/* Tech stack */}
      {hasTech && (
        <div>
          <div className="text-xs text-muted-foreground/70 mb-1.5">Tech stack</div>
          <div className="flex flex-wrap gap-1">
            {lead.tech_stack!.slice(0, 18).map(tech => (
              <span key={tech} className="text-xs px-1.5 py-0.5 bg-muted/40 rounded border border-border/60 text-muted-foreground/80">
                {tech}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Email pattern + contacts discovered */}
      {hasEmails && (
        <div className="space-y-1.5">
          {lead.hunter_email_pattern && (
            <div className="text-xs text-muted-foreground/70">
              Email pattern:{" "}
              <span className="font-mono text-foreground/70">{lead.hunter_email_pattern}</span>
            </div>
          )}
          {allEmails.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground/70 mb-1">Contacts found</div>
              <div className="space-y-1">
                {allEmails.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <Mail className="w-3 h-3 flex-shrink-0 text-muted-foreground/50" />
                    <a
                      href={`mailto:${c.email}`}
                      className="font-mono text-primary hover:text-primary/80 transition-colors"
                    >
                      {c.email}
                    </a>
                    {c.name && <span className="text-muted-foreground/60">· {c.name}</span>}
                    {c.position && <span className="text-muted-foreground/50">{c.position}</span>}
                    <span className={`ml-auto text-xs px-1 rounded ${
                      c.source === "hunter" ? "text-emerald-400/70" : "text-muted-foreground/40"
                    }`}>
                      {c.source}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
