-- After sending a question the viewer asks "how should we reply?". Anonymous
-- customers cannot UPDATE support_questions (no SELECT policy), so contact
-- details are attached through a narrow security-definer RPC: only rows
-- created in the last 2 hours that have no contact details yet.
create or replace function public.set_support_contact(p_id uuid, p_email text default null, p_phone text default null, p_name text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(left(trim(coalesce(p_email, '')), 200), '');
  v_phone text := nullif(left(trim(coalesce(p_phone, '')), 40), '');
  v_name  text := nullif(left(trim(coalesce(p_name, '')), 120), '');
begin
  if v_email is null and v_phone is null then
    raise exception 'email or phone required' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  update public.support_questions
     set customer_email = coalesce(v_email, customer_email),
         customer_phone = coalesce(v_phone, customer_phone),
         customer_name  = coalesce(v_name, customer_name)
   where id = p_id
     and created_at > now() - interval '2 hours'
     and customer_email is null and customer_phone is null;
  return found;
end $$;

revoke all on function public.set_support_contact(uuid, text, text, text) from public;
grant execute on function public.set_support_contact(uuid, text, text, text) to anon, authenticated;
