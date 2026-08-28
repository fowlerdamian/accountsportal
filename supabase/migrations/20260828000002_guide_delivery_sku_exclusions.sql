-- Guide auto-delivery: SKU exclusion patterns (checked before the include list)
alter table public.guide_delivery_settings add column if not exists sku_exclude_patterns text[] not null default '{}';
