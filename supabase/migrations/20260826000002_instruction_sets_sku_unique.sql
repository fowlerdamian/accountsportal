-- product_code holds one or more SKUs ("BGLBHX21, BGLBHX21-R"). Each SKU must be unique across guides.
-- Legacy duplicates were suffixed -OLD / -2 before this was applied.
create or replace function public.parse_skus(_code text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct t order by t), '{}'::text[])
  from unnest(regexp_split_to_array(upper(coalesce(_code, '')), '[,;\s]+')) t
  where t <> '';
$$;

create or replace function public.instruction_sets_sku_guard() returns trigger
language plpgsql as $$
declare
  toks text[];
  clash record;
begin
  toks := public.parse_skus(new.product_code);
  if coalesce(array_length(toks, 1), 0) = 0 then
    raise exception 'SKU is required' using errcode = '23514';
  end if;
  new.product_code := array_to_string(toks, ', ');
  select s.title, t.sku into clash
  from public.instruction_sets s, unnest(public.parse_skus(s.product_code)) as t(sku)
  where s.id <> new.id and t.sku = any(toks)
  limit 1;
  if found then
    raise exception 'SKU % is already used by guide "%"', clash.sku, clash.title using errcode = '23505';
  end if;
  return new;
end $$;

drop trigger if exists instruction_sets_sku_guard on public.instruction_sets;
create trigger instruction_sets_sku_guard before insert or update of product_code on public.instruction_sets
  for each row execute function public.instruction_sets_sku_guard();

update public.instruction_sets set product_code = array_to_string(public.parse_skus(product_code), ', ')
where product_code is distinct from array_to_string(public.parse_skus(product_code), ', ');
