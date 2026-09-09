-- Default logo shown on DYMO QR labels, per brand. Applied to production 2026-09-09.
alter table public.brands add column if not exists label_logo text not null default 'trailbait';
comment on column public.brands.label_logo is 'Default logo on DYMO QR labels: aga | fleetcraft | trailbait | ultravision | none';
