-- Allow authenticated staff to update purchase orders (e.g. set due_date manually)
create policy "Staff can update purchase orders"
  on public.purchase_orders for update to authenticated
  using (true)
  with check (true);
