-- Stock Turn: exclude non-inventory items (Cin7 product Type <> 'Stock').
-- Applied 2026-09-03 via MCP as stock_turn_exclude_non_inventory; the RPC bodies
-- are identical to 20260903000004 with the `excluded` CTE widened.
alter table cin7_products add column if not exists product_type text;
-- stock_turn_report / stock_turn_trend: replace
--   dropship as (... drop_ship_mode <> 'No Drop Ship')
-- with
--   excluded as (... drop_ship_mode <> 'No Drop Ship' or (product_type is not null and product_type <> 'Stock'))
-- See the live definitions (pg_get_functiondef) for the full bodies.
