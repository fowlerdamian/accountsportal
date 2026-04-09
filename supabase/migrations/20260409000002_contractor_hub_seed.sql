-- ─────────────────────────────────────────────────────────────────────────────
-- Contractor Hub Seed Data
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Contractors ─────────────────────────────────────────────────────────────

insert into public.contractors
  (id, name, email, phone, role, hourly_rate, status, source, upwork_contract_id, can_login)
values
  ('a1000000-0000-0000-0000-000000000001', 'Juan Pablo Gomez', 'juanpablo@example.com', null,             'Industrial Designer', 45.00, 'active', 'direct', null,         false),
  ('a1000000-0000-0000-0000-000000000002', 'Mike Kowalski',    'mike@example.com',       null,             'Web Developer',       null,   'active', 'upwork', 'upwork-001', false),
  ('a1000000-0000-0000-0000-000000000003', 'Sam Reeves',       'sam@example.com',        '+61400000001',   'CAD Technician',      55.00, 'active', 'direct', null,         false),
  ('a1000000-0000-0000-0000-000000000004', 'Alex Huang',       'alex@example.com',       null,             'Electrical Engineer', 40.00, 'paused', 'upwork', 'upwork-002', false)
on conflict (id) do nothing;

-- ─── Projects ────────────────────────────────────────────────────────────────

insert into public.projects
  (id, name, description, type, status, budget_allocated, start_date, due_date)
values
  ('b1000000-0000-0000-0000-000000000001',
   'BYD Shark 6 Bull Bar', 'Custom bull bar fabrication for BYD Shark 6',
   'product', 'active', 15000.00, '2026-02-10', '2026-05-15'),
  ('b1000000-0000-0000-0000-000000000002',
   'FleetCraft Website', 'Full website redesign for FleetCraft',
   'website', 'active', 8000.00, '2026-03-01', '2026-06-30'),
  ('b1000000-0000-0000-0000-000000000003',
   'Power Distribution Module', 'Custom PDM design and prototype',
   'product', 'planning', null, null, null)
on conflict (id) do nothing;

-- ─── Tasks (BYD Shark 6 Bull Bar) ────────────────────────────────────────────

insert into public.tasks
  (id, project_id, parent_task_id, title, status, priority, assigned_to, due_date, position)
values
  -- parent tasks
  ('c1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001', null,
   'Vehicle scan alignment', 'in_progress', 'urgent',
   'a1000000-0000-0000-0000-000000000003', '2026-04-05', 10),

  ('c1000000-0000-0000-0000-000000000002',
   'b1000000-0000-0000-0000-000000000001', null,
   'Mounting bracket CAD', 'done', 'medium',
   'a1000000-0000-0000-0000-000000000001', '2026-04-02', 20),

  ('c1000000-0000-0000-0000-000000000003',
   'b1000000-0000-0000-0000-000000000001', null,
   'FEA stress analysis', 'in_progress', 'high',
   'a1000000-0000-0000-0000-000000000001', '2026-04-12', 30),

  ('c1000000-0000-0000-0000-000000000004',
   'b1000000-0000-0000-0000-000000000001', null,
   'Prototype quoting', 'backlog', 'low',
   null, '2026-04-20', 40),

  -- subtasks of Vehicle scan alignment
  ('c1000000-0000-0000-0000-000000000011',
   'b1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001',
   'Import .STL to SolidWorks', 'done', 'medium',
   'a1000000-0000-0000-0000-000000000003', '2026-03-28', 1),

  ('c1000000-0000-0000-0000-000000000012',
   'b1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000001',
   'Verify mounting points', 'in_progress', 'high',
   'a1000000-0000-0000-0000-000000000003', '2026-04-05', 2)

on conflict (id) do nothing;

-- ─── Tasks (FleetCraft Website) ───────────────────────────────────────────────

insert into public.tasks
  (id, project_id, parent_task_id, title, status, priority, assigned_to, due_date, position)
values
  ('c1000000-0000-0000-0000-000000000021',
   'b1000000-0000-0000-0000-000000000002', null,
   'Homepage wireframes', 'review', 'medium',
   'a1000000-0000-0000-0000-000000000002', '2026-04-08', 10),

  ('c1000000-0000-0000-0000-000000000022',
   'b1000000-0000-0000-0000-000000000002', null,
   'Services page content', 'in_progress', 'medium',
   'a1000000-0000-0000-0000-000000000002', '2026-04-15', 20),

  ('c1000000-0000-0000-0000-000000000023',
   'b1000000-0000-0000-0000-000000000002', null,
   'Contact form + CTA', 'backlog', 'low',
   null, '2026-04-25', 30)

on conflict (id) do nothing;

-- ─── Time Entries ─────────────────────────────────────────────────────────────

insert into public.time_entries
  (contractor_id, project_id, task_id, hours, date, description, source)
values
  -- Sam on vehicle scan
  ('a1000000-0000-0000-0000-000000000003',
   'b1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000011',
   4.0, '2026-03-25', 'Imported scan files, cleaned mesh', 'manual'),

  ('a1000000-0000-0000-0000-000000000003',
   'b1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000012',
   6.0, '2026-04-01', 'Mounting point verification — found 3 discrepancies', 'manual'),

  ('a1000000-0000-0000-0000-000000000003',
   'b1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000012',
   8.0, '2026-04-06', 'Scan alignment corrections', 'manual'),

  -- Juan Pablo on CAD and FEA
  ('a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000002',
   12.0, '2026-03-28', 'Bracket CAD modelling — complete', 'manual'),

  ('a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000003',
   6.5, '2026-04-07', 'FEA mesh generation', 'manual'),

  ('a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000003',
   4.0, '2026-04-08', 'Load case definition', 'manual'),

  -- Mike on website
  ('a1000000-0000-0000-0000-000000000002',
   'b1000000-0000-0000-0000-000000000002',
   'c1000000-0000-0000-0000-000000000021',
   8.0, '2026-04-03', 'Homepage wireframe designs — v1 and v2', 'upwork'),

  ('a1000000-0000-0000-0000-000000000002',
   'b1000000-0000-0000-0000-000000000002',
   'c1000000-0000-0000-0000-000000000022',
   3.5, '2026-04-07', 'Services page structure and copy draft', 'upwork');

-- ─── Activity Log ─────────────────────────────────────────────────────────────
-- author_id uses a placeholder UUID — replace with a real staff user ID after deploy

do $$
declare
  staff_id uuid := 'f1760106-2c25-4408-b09c-e3f178d3ba70'; -- placeholder; update after deploy
begin

  insert into public.activity_log
    (project_id, contractor_id, task_id, type, content, author_id, author_name, metadata, created_at)
  values
    ('b1000000-0000-0000-0000-000000000001',
     'a1000000-0000-0000-0000-000000000003',
     'c1000000-0000-0000-0000-000000000001',
     'note', 'Found 3 mounting point discrepancies versus OEM spec. Will revise scan and re-check.',
     staff_id, 'Sam Reeves', null, now() - interval '2 days'),

    ('b1000000-0000-0000-0000-000000000001',
     'a1000000-0000-0000-0000-000000000001',
     'c1000000-0000-0000-0000-000000000002',
     'status_change', 'Mounting bracket CAD moved to done.',
     staff_id, 'Admin', '{"from":"in_progress","to":"done"}'::jsonb, now() - interval '7 days'),

    ('b1000000-0000-0000-0000-000000000001',
     'a1000000-0000-0000-0000-000000000001',
     'c1000000-0000-0000-0000-000000000003',
     'note', 'Starting FEA — mesh generation underway. Load cases ready by end of week.',
     staff_id, 'Juan Pablo Gomez', null, now() - interval '1 day'),

    ('b1000000-0000-0000-0000-000000000002',
     'a1000000-0000-0000-0000-000000000002',
     'c1000000-0000-0000-0000-000000000021',
     'status_change', 'Homepage wireframes moved to review.',
     staff_id, 'Admin', '{"from":"in_progress","to":"review"}'::jsonb, now() - interval '3 days'),

    ('b1000000-0000-0000-0000-000000000002',
     'a1000000-0000-0000-0000-000000000002',
     null,
     'upwork_message', 'Hi — just checking if the homepage wireframes are approved? Happy to incorporate feedback before moving to the services page.',
     staff_id, 'Mike Kowalski', '{"send_to_upwork":false}'::jsonb, now() - interval '1 day'),

    ('b1000000-0000-0000-0000-000000000001',
     'a1000000-0000-0000-0000-000000000003',
     'c1000000-0000-0000-0000-000000000012',
     'time_log', 'Logged 8 hrs on vehicle scan alignment — Apr 6.',
     staff_id, 'Admin', '{"hours":8,"cost":440}'::jsonb, now() - interval '3 days'),

    ('b1000000-0000-0000-0000-000000000001',
     null, null,
     'update', 'Project kicked off. Sam assigned to vehicle scanning, Juan Pablo to CAD and FEA.',
     staff_id, 'Admin', null, now() - interval '14 days');

end $$;
