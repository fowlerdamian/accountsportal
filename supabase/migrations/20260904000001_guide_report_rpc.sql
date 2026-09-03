-- Guide Reports: server-side aggregation for the rebuilt Reports tab.
--
-- Replaces the client paging every step_views row for a year. Two RPCs:
--   guide_report(p_days)             → totals (with previous-period comparisons),
--                                      per-brand, daily series, per-guide table,
--                                      rating distribution, delivery series, recent flags
--   guide_report_steps(guide, days)  → per-step reach (drop-off) for one guide
--
-- Brand attribution: before the viewer fix on 2026-09-04 every step_views row was
-- stamped with the first brand alphabetically (AGA). Rows from before that date are
-- re-attributed to the guide's sole published brand when it has exactly one.
--
-- Session model (matches GuideViewer): a session is (guide, session_id); it is
-- "started" once any step is marked done, and "completed" when the highest
-- completed step number reaches the guide's real (non-divider, main) step count.

create or replace function public.guide_report(p_days int default 30)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with params as (
  select greatest(1, least(coalesce(p_days, 30), 730)) as days,
         now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 730))) as since,
         now() - make_interval(days => 2 * greatest(1, least(coalesce(p_days, 30), 730))) as prev_since
),
pubs as (
  select instruction_set_id, array_agg(brand_id) as brand_ids
  from guide_publications where status = 'published' group by 1
),
step_counts as (
  select instruction_set_id,
         count(*) filter (where variant_id is null and not coalesce(is_divider, false)) as steps
  from instruction_steps group by 1
),
sv as (
  select v.instruction_set_id, v.session_id, v.step_number, v.completed, v.viewed_at,
         case when v.viewed_at < timestamptz '2026-09-04 00:00+10' and cardinality(p.brand_ids) = 1
              then p.brand_ids[1] else v.brand_id end as brand_id
  from step_views v
  left join pubs p on p.instruction_set_id = v.instruction_set_id
  where v.viewed_at >= (select prev_since from params)
),
sessions as (
  select s.instruction_set_id, s.session_id,
         min(s.brand_id::text)::uuid as brand_id,
         min(s.viewed_at) as started_at,
         max(s.step_number) filter (where s.completed) as max_step,
         (min(s.viewed_at) >= (select since from params)) as in_window,
         coalesce(sc.steps, 0) as guide_steps
  from sv s
  left join step_counts sc on sc.instruction_set_id = s.instruction_set_id
  group by s.instruction_set_id, s.session_id, sc.steps
),
sess as (
  select *,
         (guide_steps > 0 and coalesce(max_step, 0) >= guide_steps) as completed,
         (coalesce(max_step, 0) > 0) as started
  from sessions
),
cur  as (select * from sess where in_window),
prev as (select * from sess where not in_window),
fb      as (select * from feedback where created_at >= (select since from params)),
fb_prev as (select * from feedback where created_at >= (select prev_since from params) and created_at < (select since from params)),
sq      as (select * from support_questions where created_at >= (select since from params)),
dl      as (select * from guide_deliveries where created_at >= (select since from params))
select jsonb_build_object(
  'days', (select days from params),
  'since', (select since from params),
  'totals', jsonb_build_object(
    'sessions',        (select count(*) from cur),
    'sessions_prev',   (select count(*) from prev),
    'started',         (select count(*) from cur where started),
    'completed',       (select count(*) from cur where completed),
    'completed_prev',  (select count(*) from prev where completed),
    'step_views',      (select count(*) from sv s join cur c on c.instruction_set_id = s.instruction_set_id and c.session_id = s.session_id where s.completed),
    'avg_rating',      (select round(avg(rating)::numeric, 2) from fb where rating is not null),
    'avg_rating_prev', (select round(avg(rating)::numeric, 2) from fb_prev where rating is not null),
    'ratings',         (select count(*) from fb where rating is not null),
    'flags',           (select count(*) from fb where type = 'flag'),
    'flags_open',      (select count(*) from fb where type = 'flag' and not resolved),
    'comments',        (select count(*) from fb where type = 'comment'),
    'support',         (select count(*) from sq),
    'support_open',    (select count(*) from sq where not resolved),
    'emails_sent',     (select count(*) from dl where status = 'sent'),
    'emails_skipped',  (select count(*) from dl where status = 'skipped'),
    'emails_failed',   (select count(*) from dl where status = 'failed'),
    'unmatched_open',  (select count(distinct upper(s)) from dl, unnest(coalesce(dl.unmatched_skus, '{}')) as s
                        where not exists (select 1 from guide_product_links l where upper(l.sku) = upper(s)))
  ),
  'by_brand', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', b.key, 'name', b.name, 'colour', b.primary_colour,
      'sessions',      (select count(*) from cur c where c.brand_id = b.id),
      'completed',     (select count(*) from cur c where c.brand_id = b.id and c.completed),
      'sessions_prev', (select count(*) from prev c where c.brand_id = b.id),
      'guides',        (select count(*) from guide_publications p where p.brand_id = b.id and p.status = 'published'),
      'avg_rating',    (select round(avg(rating)::numeric, 2) from fb f where f.brand_id = b.id and rating is not null),
      'ratings',       (select count(*) from fb f where f.brand_id = b.id and rating is not null),
      'emails_sent',   (select count(*) from dl d join guide_delivery_settings gs on gs.id = 1 where d.status = 'sent' and gs.brand_id = b.id)
    ) order by b.key), '[]'::jsonb)
    from brands b
  ),
  'daily', (
    select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'brand', d.key, 'sessions', d.sessions, 'completed', d.completed) order by d.day, d.key), '[]'::jsonb)
    from (
      select (c.started_at at time zone 'Australia/Brisbane')::date as day, b.key,
             count(*) as sessions, count(*) filter (where c.completed) as completed
      from cur c join brands b on b.id = c.brand_id
      group by 1, 2
    ) d
  ),
  'guides', (
    select coalesce(jsonb_agg(to_jsonb(g) order by g.sessions desc, g.title), '[]'::jsonb) from (
      select i.id, i.title, i.product_code, i.slug,
             (select array_agg(b.key order by b.key) from guide_publications p join brands b on b.id = p.brand_id
               where p.instruction_set_id = i.id and p.status = 'published') as brands,
             (select count(*) from cur c where c.instruction_set_id = i.id) as sessions,
             (select count(*) from cur c where c.instruction_set_id = i.id and c.completed) as completed,
             (select count(*) from prev c where c.instruction_set_id = i.id) as sessions_prev,
             (select round(avg(rating)::numeric, 1) from fb f where f.instruction_set_id = i.id and rating is not null) as avg_rating,
             (select count(*) from fb f where f.instruction_set_id = i.id and rating is not null) as ratings,
             (select count(*) from fb f where f.instruction_set_id = i.id and f.type = 'flag') as flags,
             (select count(*) from sq q where q.instruction_set_id = i.id) as support,
             coalesce(sc.steps, 0) as steps
      from instruction_sets i
      left join step_counts sc on sc.instruction_set_id = i.id
      where exists (select 1 from cur c where c.instruction_set_id = i.id)
         or exists (select 1 from fb f where f.instruction_set_id = i.id)
    ) g
  ),
  'ratings', (
    select coalesce(jsonb_agg(jsonb_build_object('rating', r, 'n', (select count(*) from fb where rating = r)) order by r), '[]'::jsonb)
    from generate_series(1, 5) as r
  ),
  'deliveries_daily', (
    select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'sent', d.sent, 'skipped', d.skipped, 'failed', d.failed) order by d.day), '[]'::jsonb)
    from (
      select (created_at at time zone 'Australia/Brisbane')::date as day,
             count(*) filter (where status = 'sent') as sent,
             count(*) filter (where status = 'skipped') as skipped,
             count(*) filter (where status = 'failed') as failed
      from dl group by 1
    ) d
  ),
  'flags', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'guide', i.title, 'guide_id', i.id, 'step', f.flagged_step,
      'comment', left(f.comment, 160), 'resolved', f.resolved, 'created_at', f.created_at
    ) order by f.created_at desc), '[]'::jsonb)
    from (select * from fb where type = 'flag' order by created_at desc limit 10) f
    join instruction_sets i on i.id = f.instruction_set_id
  )
)
$$;

grant execute on function public.guide_report(int) to authenticated;

create or replace function public.guide_report_steps(p_guide_id uuid, p_days int default 30)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with params as (
  select now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 730))) as since
),
st as (
  -- Real step index (dividers excluded), matching the number the viewer records.
  select row_number() over (order by order_index, step_number) as step, subtitle
  from instruction_steps
  where instruction_set_id = p_guide_id and variant_id is null and not coalesce(is_divider, false)
),
sess as (
  select session_id, max(step_number) filter (where completed) as max_step
  from step_views
  where instruction_set_id = p_guide_id and viewed_at >= (select since from params)
  group by session_id
)
select jsonb_build_object(
  'sessions', (select count(*) from sess),
  'steps', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'step', s.step, 'title', s.subtitle,
      'reached', (select count(*) from sess x where coalesce(x.max_step, 0) >= s.step)
    ) order by s.step), '[]'::jsonb)
    from st s
  )
)
$$;

grant execute on function public.guide_report_steps(uuid, int) to authenticated;
