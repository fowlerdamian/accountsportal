-- Marketing → 3D Model Builder.
-- One row per reconstruction: the reference image (client-downscaled JPEG data URL),
-- the img2threejs analysis + sculpt spec, the current procedural Three.js factory code,
-- and the review history of every vision self-correction pass.
create table if not exists public.marketing_3d_models (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  notes        text,
  reference    text not null,               -- data:image/jpeg;base64,…
  analysis     jsonb,                        -- stage 1–2: suitability, hierarchy, materials, quality contract
  spec         jsonb,                        -- sculpt spec (components, materials, lighting)
  code         text,                         -- body of build(THREE) → THREE.Group
  thumbnail    text,                         -- latest render, data URL
  reviews      jsonb not null default '[]',  -- [{pass, fidelity, summary, issues[], at}]
  fidelity     numeric,
  status       text not null default 'draft',-- draft | analyzed | built | refined | failed
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists marketing_3d_models_created_at_idx on public.marketing_3d_models (created_at desc);

alter table public.marketing_3d_models enable row level security;

create policy "staff read 3d models"   on public.marketing_3d_models for select to authenticated using (public.is_staff(auth.uid()));
create policy "staff insert 3d models" on public.marketing_3d_models for insert to authenticated with check (public.is_staff(auth.uid()));
create policy "staff update 3d models" on public.marketing_3d_models for update to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "staff delete 3d models" on public.marketing_3d_models for delete to authenticated using (public.is_staff(auth.uid()));

create or replace function public.marketing_3d_models_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists marketing_3d_models_touch on public.marketing_3d_models;
create trigger marketing_3d_models_touch before update on public.marketing_3d_models
  for each row execute function public.marketing_3d_models_touch();
