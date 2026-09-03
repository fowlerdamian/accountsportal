-- Bill of materials captured from Cin7 /product (BillOfMaterial flag +
-- BillOfMaterialsProducts list) so assembly sales can be attributed to components.
-- Applied 2026-09-03 via MCP as stock_turn_bom_columns.
alter table cin7_products
  add column if not exists bom boolean not null default false,
  add column if not exists bom_components jsonb;
