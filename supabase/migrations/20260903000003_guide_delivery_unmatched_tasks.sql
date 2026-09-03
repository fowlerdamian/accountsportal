-- Guide auto-delivery: when an order has a SKU that no guide matches, the
-- guide-delivery edge fn creates a staff_tasks row for the mapping owner
-- (default: Kyle) so the SKU gets mapped. One open task per SKU set; each
-- delivery row is stamped with the task that covers it so re-runs are idempotent.

alter table public.guide_deliveries
  add column if not exists unmatched_task_id uuid references public.staff_tasks(id) on delete set null;

alter table public.guide_delivery_settings
  add column if not exists unmatched_task_assignee uuid references auth.users(id) on delete set null;

comment on column public.guide_deliveries.unmatched_task_id is
  'staff_tasks row asking someone to map this delivery''s unmatched SKU(s); null = no task yet';
comment on column public.guide_delivery_settings.unmatched_task_assignee is
  'auth user who receives the "map this SKU" task when a delivery has unmatched SKUs; null disables';

update public.guide_delivery_settings
   set unmatched_task_assignee = (select id from public.profiles where email = 'kylef@automotivegroup.com.au' limit 1)
 where id = 1 and unmatched_task_assignee is null;
