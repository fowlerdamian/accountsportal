-- Return label option on cases: ticked at creation, it spawns a warehouse
-- task (action_items.is_return_label) that the warehouse ticks off once the
-- return label has been sent via ShipStation.
alter table public.cases add column if not exists return_label_required boolean not null default false;
alter table public.action_items add column if not exists is_return_label boolean not null default false;
comment on column public.cases.return_label_required is 'Customer needs a return label; a warehouse task (action_items.is_return_label) tracks it.';
comment on column public.action_items.is_return_label is 'Warehouse task: create the return label in ShipStation and send it; done = sent.';
