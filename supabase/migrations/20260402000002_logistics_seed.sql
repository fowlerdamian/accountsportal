-- 1. Insert Carriers
INSERT INTO public.carriers (name, email) VALUES
  ('Toll Group',    'accounts@toll.com.au'),
  ('StarTrack',     'billing@startrack.com.au'),
  ('TNT Australia', 'invoices@tnt.com.au'),
  ('Linfox',        'ap@linfox.com')
ON CONFLICT DO NOTHING;

-- 2. Insert Rate Cards
INSERT INTO public.rate_cards (carrier_id, service, lane, rate)
SELECT id, 'Road Express',    'SYD → MEL', '$0.85/kg' FROM public.carriers WHERE name='Toll Group' UNION ALL
SELECT id, 'Road Express',    'SYD → BNE', '$1.10/kg' FROM public.carriers WHERE name='Toll Group' UNION ALL
SELECT id, 'Overnight',       'SYD → MEL', '$1.45/kg' FROM public.carriers WHERE name='Toll Group' UNION ALL
SELECT id, 'Fuel Levy',       'All lanes', '18.5%'    FROM public.carriers WHERE name='Toll Group' UNION ALL
SELECT id, 'Express',         'SYD → MEL', '$0.92/kg' FROM public.carriers WHERE name='StarTrack'  UNION ALL
SELECT id, 'Express',         'SYD → PER', '$2.20/kg' FROM public.carriers WHERE name='StarTrack'  UNION ALL
SELECT id, 'Fuel Levy',       'All lanes', '17.0%'    FROM public.carriers WHERE name='StarTrack'  UNION ALL
SELECT id, 'Economy Express', 'SYD → ADL', '$1.05/kg' FROM public.carriers WHERE name='TNT Australia' UNION ALL
SELECT id, 'Fuel Levy',       'All lanes', '19.0%'    FROM public.carriers WHERE name='TNT Australia';

-- 3. Insert Invoices (Using invoice_ref and ::date casting)
WITH c AS (SELECT id, name FROM public.carriers)
INSERT INTO public.freight_invoices (invoice_ref, carrier_id, invoice_date, due_date, status, notes)
SELECT 'INV-2025-0891', id, '2025-03-15'::date, '2025-04-14'::date, 'flagged',  ''    FROM c WHERE name='Toll Group'    UNION ALL
SELECT 'INV-2025-0876', id, '2025-03-12'::date, '2025-04-11'::date, 'approved', ''    FROM c WHERE name='StarTrack'     UNION ALL
SELECT 'INV-2025-0854', id, '2025-03-08'::date, '2025-04-07'::date, 'disputed', 
  'Fuel levy rate above contracted 19%. Remote area surcharge not in agreement.' 
  FROM c WHERE name='TNT Australia' UNION ALL
SELECT 'INV-2025-0838', id, '2025-03-01'::date, '2025-03-31'::date, 'resolved', 
  'Credit note $42.00 received 22 Mar 2025.' 
  FROM c WHERE name='Toll Group' UNION ALL
SELECT 'INV-2025-0812', id, '2025-02-28'::date, '2025-03-29'::date, 'pending',  ''    FROM c WHERE name='Linfox';

-- 4. Insert Invoice Lines
INSERT INTO public.freight_invoice_lines 
  (invoice_id, description, detail, charged_total, contracted_total, sort_order)
SELECT id, 'Road Express SYD → MEL', '1,240 kg @ $0.97/kg (contracted: $0.85)', 1202.80, 1054.00, 1 FROM public.freight_invoices WHERE invoice_ref='INV-2025-0891' UNION ALL
SELECT id, 'Road Express SYD → BNE', '680 kg @ $1.10/kg',                        748.00,  748.00,  2 FROM public.freight_invoices WHERE invoice_ref='INV-2025-0891' UNION ALL
SELECT id, 'Overnight SYD → MEL',    '95 kg @ $1.72/kg (contracted: $1.45)',      163.40,  137.75,  3 FROM public.freight_invoices WHERE invoice_ref='INV-2025-0891' UNION ALL
SELECT id, 'Fuel Levy',              '22.5% of freight (contracted: 18.5%)',       473.49,  388.85,  4 FROM public.freight_invoices WHERE invoice_ref='INV-2025-0891' UNION ALL
SELECT id, 'Express SYD → MEL',      '820 kg @ $0.92/kg',                         754.40,  754.40,  1 FROM public.freight_invoices WHERE invoice_ref='INV-2025-0876' UNION ALL
SELECT id, 'Express SYD → PER',      '340 kg @ $2.20/kg',                         748.00,  748.00,  2 FROM public.freight_invoices WHERE invoice_ref='INV-2025-0876' UNION ALL
SELECT id, 'Fuel Levy',              '17.0% of freight',                           254.68,  254.68,  3 FROM public.freight_invoices WHERE invoice_ref='INV-2025-0876' UNION ALL
SELECT id, 'Economy Express SYD → ADL', '560 kg @ $1.05/kg',                      588.00,  588.00,  1 FROM public.freight_invoices WHERE invoice_ref='INV-2025-0854' UNION ALL
SELECT id, 'Fuel Levy',              '23.5% of freight (contracted: 19.0%)',       138.18,  111.72,  2 FROM public.freight_invoices WHERE invoice_ref='INV-2025-0854' UNION ALL
SELECT id, 'Remote Area Surcharge',  'Flat charge — not in contracted rate card',  145.00,    0.00,  3 FROM public.freight_invoices WHERE invoice_ref='INV-2025-0854' UNION ALL
SELECT id, 'Road Express SYD → MEL', '2,100 kg @ $0.87/kg (contracted: $0.85)',  1827.00, 1785.00,  1 FROM public.freight_invoices WHERE invoice_ref='INV-2025-0838' UNION ALL
SELECT id, 'Fuel Levy',              '18.5% of freight',                           338.00,  338.00,  2 FROM public.freight_invoices WHERE invoice_ref='INV-2025-0838' UNION ALL
SELECT id, 'Bulk Freight SYD → MEL', '4,200 kg @ $1.20/kg',                      5040.00,    NULL,  1 FROM public.freight_invoices WHERE invoice_ref='INV-2025-0812' UNION ALL
SELECT id, 'Fuel Levy',              '21.0% — no rate card on file',               1058.40,    NULL,  2 FROM public.freight_invoices WHERE invoice_ref='INV-2025-0812';