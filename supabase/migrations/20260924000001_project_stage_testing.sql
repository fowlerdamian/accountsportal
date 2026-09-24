-- New product stage "Testing" between Prototype and Complete.
-- Existing new_product projects get the stage inserted (inactive) and later
-- stages shifted one position; idempotent.
do $$
declare r record;
begin
  for r in
    select ps.project_id, ps.position as proto_pos
    from public.project_stages ps
    where ps.name = 'Prototype'
      and not exists (select 1 from public.project_stages t where t.project_id = ps.project_id and t.name = 'Testing')
  loop
    update public.project_stages set position = position + 1
      where project_id = r.project_id and position > r.proto_pos;
    insert into public.project_stages (project_id, name, position, is_active)
      values (r.project_id, 'Testing', r.proto_pos + 1, false);
  end loop;
end$$;
