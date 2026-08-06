-- Security lockdown: remove blanket anon access; keep only what the public
-- guide viewer (/:slug) needs. Authenticated portal flows are unaffected
-- (anon-role policies never applied to authenticated requests).
-- Applied to production 2026-08-06 via MCP (version 20260806113654);
-- committed here so the repo mirrors the remote migration history.

-- 1. Drop all blanket anon policies
drop policy if exists "anon full access" on public.action_items;
drop policy if exists "anon full access" on public.activity_log;
drop policy if exists "anon full access" on public.ai_chat_messages;
drop policy if exists "anon_full_brands" on public.brands;
drop policy if exists "anon_full_carriers" on public.carriers;
drop policy if exists "anon full access" on public.case_attachments;
drop policy if exists "anon full access" on public.case_updates;
drop policy if exists "anon full access" on public.cases;
drop policy if exists "anon_full_categories" on public.categories;
drop policy if exists "anon full access" on public.contractors;
drop policy if exists "anon_full_feedback" on public.feedback;
drop policy if exists "anon full access" on public.files;
drop policy if exists "anon_full_guide_publications" on public.guide_publications;
drop policy if exists "anon_full_guide_variants" on public.guide_variants;
drop policy if exists "anon_full_guide_vehicles" on public.guide_vehicles;
drop policy if exists "anon_full_guide_views" on public.guide_views;
drop policy if exists "anon_full_instruction_sets" on public.instruction_sets;
drop policy if exists "anon_full_instruction_steps" on public.instruction_steps;
drop policy if exists "anon full access" on public.manual_pick_requests;
drop policy if exists "anon_full_profiles" on public.profiles;
drop policy if exists "anon full access" on public.projects;
drop policy if exists "anon_full_purchase_orders" on public.purchase_orders;
drop policy if exists "anon_full_step_views" on public.step_views;
drop policy if exists "anon_full_support_questions" on public.support_questions;
drop policy if exists "anon full access" on public.tasks;
drop policy if exists "anon full access" on public.team_members;
drop policy if exists "anon full access" on public.time_entries;
drop policy if exists "anon full access" on public.upwork_sync_log;
drop policy if exists "anon_full_user_tile_settings" on public.user_tile_settings;

-- 2. Combined portal policies that included anon -> authenticated only
drop policy if exists "Allow portal access to call list" on public.call_list;
create policy "authenticated portal access" on public.call_list
  for all to authenticated using (true) with check (true);
drop policy if exists "Allow portal access to research jobs" on public.research_jobs;
create policy "authenticated portal access" on public.research_jobs
  for all to authenticated using (true) with check (true);
drop policy if exists "Allow portal access to leads" on public.sales_leads;
create policy "authenticated portal access" on public.sales_leads
  for all to authenticated using (true) with check (true);
drop policy if exists "Allow portal access to order history" on public.trailbait_order_history;
create policy "authenticated portal access" on public.trailbait_order_history
  for all to authenticated using (true) with check (true);

-- 3. Tighten profiles: staff read all, edit own; writes otherwise via service role
drop policy if exists "auth_full_profiles" on public.profiles;
create policy "authenticated read profiles" on public.profiles
  for select to authenticated using (true);
create policy "users update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- 4. Public guide viewer: read-only content + analytics/feedback inserts
create policy "public read guide publications" on public.guide_publications
  for select to anon using (true);
create policy "public read guide vehicles" on public.guide_vehicles
  for select to anon using (true);
create policy "public read guide variants" on public.guide_variants
  for select to anon using (true);
create policy "public read instruction sets" on public.instruction_sets
  for select to anon using (true);
create policy "public read instruction steps" on public.instruction_steps
  for select to anon using (true);
create policy "public read brands" on public.brands
  for select to anon using (true);
create policy "public read categories" on public.categories
  for select to anon using (true);
create policy "public insert guide views" on public.guide_views
  for insert to anon with check (true);
create policy "public insert step views" on public.step_views
  for insert to anon with check (true);
create policy "public insert feedback" on public.feedback
  for insert to anon with check (true);
create policy "public insert support questions" on public.support_questions
  for insert to anon with check (true);
-- authenticated equivalents so the guide viewer works for logged-in staff too
create policy "authenticated full guide_publications" on public.guide_publications
  for all to authenticated using (true) with check (true);
create policy "authenticated full guide_vehicles" on public.guide_vehicles
  for all to authenticated using (true) with check (true);
create policy "authenticated full guide_variants" on public.guide_variants
  for all to authenticated using (true) with check (true);
create policy "authenticated full instruction_sets" on public.instruction_sets
  for all to authenticated using (true) with check (true);
create policy "authenticated full instruction_steps" on public.instruction_steps
  for all to authenticated using (true) with check (true);
create policy "authenticated full brands" on public.brands
  for all to authenticated using (true) with check (true);
create policy "authenticated full categories" on public.categories
  for all to authenticated using (true) with check (true);
create policy "authenticated full guide_views" on public.guide_views
  for all to authenticated using (true) with check (true);
create policy "authenticated full step_views" on public.step_views
  for all to authenticated using (true) with check (true);
create policy "authenticated full feedback" on public.feedback
  for all to authenticated using (true) with check (true);
create policy "authenticated full support_questions" on public.support_questions
  for all to authenticated using (true) with check (true);
create policy "authenticated full ai_chat_messages" on public.ai_chat_messages
  for all to authenticated using (true) with check (true);
create policy "authenticated full manual_pick_requests" on public.manual_pick_requests
  for all to authenticated using (true) with check (true);
create policy "authenticated full upwork_sync_log" on public.upwork_sync_log
  for all to authenticated using (true) with check (true);

-- 5. SECURITY DEFINER views -> run as querying user (RLS applies)
alter view public.time_entries_with_cost set (security_invoker = on);
alter view public.project_budget_summary set (security_invoker = on);

-- 6. Definer functions: not callable anonymously
revoke execute on function public._caller_email_domain() from public, anon;
revoke execute on function public.get_my_contractor_id() from public, anon;
revoke execute on function public.get_role_by_email(text) from public, anon;
revoke execute on function public.has_role(text, uuid) from public, anon;
revoke execute on function public.has_role(uuid, text) from public, anon;
revoke execute on function public.is_staff(uuid) from public, anon;
revoke execute on function public.list_portal_users() from public, anon;
revoke execute on function public.record_chat_function_run(text, text, jsonb) from public, anon;
revoke execute on function public.request_xero_invoice_sync() from public, anon;
grant execute on function public._caller_email_domain() to authenticated;
grant execute on function public.get_my_contractor_id() to authenticated;
grant execute on function public.get_role_by_email(text) to authenticated;
grant execute on function public.has_role(text, uuid) to authenticated;
grant execute on function public.has_role(uuid, text) to authenticated;
grant execute on function public.is_staff(uuid) to authenticated;
grant execute on function public.list_portal_users() to authenticated;
grant execute on function public.record_chat_function_run(text, text, jsonb) to authenticated;
grant execute on function public.request_xero_invoice_sync() to authenticated;

-- 7. Pin mutable search_path flagged by advisor
alter function public.handle_opportunity_updated_at() set search_path = public;
