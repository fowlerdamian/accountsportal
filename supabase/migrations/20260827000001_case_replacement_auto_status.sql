-- Support Hub: automatic case status transitions driven by the replacement order.
--   replacement order created (pick slip saved)            open      -> actioned
--   replacement shipped (tracking recorded / pick marked done)  open|actioned -> in_hand
-- Never moves a case backwards and never touches a closed case.

create or replace function public.case_auto_status(_case_id uuid, _to text, _note text) returns void
language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  select status into cur from public.cases where id = _case_id;
  if cur is null or cur = 'closed' or cur = _to then return; end if;
  if _to = 'actioned' and cur <> 'open' then return; end if;          -- only open -> actioned
  if _to = 'in_hand' and cur not in ('open', 'actioned') then return; end if;
  update public.cases set status = _to, updated_at = now() where id = _case_id;
  insert into public.case_updates (case_id, author_type, author_name, message)
  values (_case_id, 'system', 'System', _note);
end $$;

-- 1) Replacement order created → Actioned
create or replace function public.trg_replacement_pick_created() returns trigger
language plpgsql as $$
begin
  if new.case_id is not null then
    perform public.case_auto_status(new.case_id, 'actioned', 'Status set to Actioned — replacement order created');
  end if;
  return new;
end $$;
drop trigger if exists replacement_pick_created on public.manual_pick_requests;
create trigger replacement_pick_created after insert on public.manual_pick_requests
  for each row execute function public.trg_replacement_pick_created();

-- 2a) Replacement shipped (tracking number recorded on the case) → In hand
create or replace function public.trg_replacement_tracking_set() returns trigger
language plpgsql as $$
begin
  if coalesce(new.replacement_tracking_number, '') <> '' and coalesce(old.replacement_tracking_number, '') = '' then
    perform public.case_auto_status(new.id, 'in_hand',
      'Status set to In hand — replacement shipped (' || coalesce(new.replacement_carrier, 'carrier n/a') || ' ' || new.replacement_tracking_number || ')');
  end if;
  return new;
end $$;
drop trigger if exists replacement_tracking_set on public.cases;
create trigger replacement_tracking_set after update of replacement_tracking_number on public.cases
  for each row execute function public.trg_replacement_tracking_set();

-- 2b) Warehouse marks the replacement pick task done → In hand
create or replace function public.trg_replacement_pick_done() returns trigger
language plpgsql as $$
begin
  if new.is_replacement_pick and new.status = 'done' and coalesce(old.status, '') <> 'done' and new.case_id is not null then
    perform public.case_auto_status(new.case_id, 'in_hand', 'Status set to In hand — warehouse dispatched the replacement order');
  end if;
  return new;
end $$;
drop trigger if exists replacement_pick_done on public.action_items;
create trigger replacement_pick_done after update of status on public.action_items
  for each row execute function public.trg_replacement_pick_done();
