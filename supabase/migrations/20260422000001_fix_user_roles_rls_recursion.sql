-- Drop the recursive policy (subqueries user_roles inside a policy on user_roles)
drop policy if exists "admins can manage roles" on public.user_roles;

-- Drop the anonymous full-access policy (security hole)
drop policy if exists "anon_full_user_roles" on public.user_roles;

-- INSERT: admins only, via security-definer function (no recursion)
create policy "Admins can insert user_roles"
  on public.user_roles for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

-- UPDATE: admins only
create policy "Admins can update user_roles"
  on public.user_roles for update to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- DELETE: admins only
create policy "Admins can delete user_roles"
  on public.user_roles for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));
