-- Stock Turn: snapshots are now limited to the main warehouse (stock-turn-snapshot
-- STOCK_LOCATIONS = ["1. Main Warehouse"]; Amazon Australia / Consignment excluded).
-- `locations` keeps every location's on-hand for reference. Applied 2026-09-03 via MCP.
alter table cin7_stock_snapshots add column if not exists locations jsonb;
