-- ON CONFLICT (kind, source_ref) via PostgREST needs a plain unique index; the
-- partial one can't be inferred. NULL source_refs (manual notes) never collide.
drop index if exists public.idx_community_notes_source;
create unique index if not exists idx_community_notes_source on public.community_notes (kind, source_ref);
