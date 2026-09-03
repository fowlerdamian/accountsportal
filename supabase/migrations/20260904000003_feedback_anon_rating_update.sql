-- The viewer lets a customer change their star rating after the first tap by
-- updating the row it created (client-generated id). Anonymous customers only
-- have INSERT on feedback, and an UPDATE needs the row to be SELECT-visible, so
-- the change goes through a narrow security-definer RPC rather than a policy
-- (a SELECT policy would expose other customers' comments).
drop policy if exists "public update recent rating" on public.feedback;

create or replace function public.update_guide_rating(p_id uuid, p_rating int, p_comment text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be 1-5' using errcode = '22023';
  end if;
  update public.feedback
     set rating = p_rating,
         comment = nullif(left(coalesce(p_comment, ''), 2000), '')
   where id = p_id
     and type = 'rating'
     and resolved = false
     and created_at > now() - interval '2 hours';
  return found;
end $$;

revoke all on function public.update_guide_rating(uuid, int, text) from public;
grant execute on function public.update_guide_rating(uuid, int, text) to anon, authenticated;
