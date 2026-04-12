const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname);
const esc = s => s == null ? 'NULL' : "'" + String(s).replace(/'/g, "''") + "'";

const sets = JSON.parse(fs.readFileSync(path.join(dir, 'instruction_sets.json'), 'utf8'));
const setLines = sets.map(r => '(' + [
  esc(r.id), esc(r.title), esc(r.slug), esc(r.product_code),
  esc(r.short_description), esc(r.notice_text), esc(r.estimated_time),
  esc(r.product_image_url),
  r.tools_required ? 'ARRAY[' + r.tools_required.map(t => esc(t)).join(',') + ']::text[]' : 'NULL',
  esc(r.category_id), esc(r.created_by), esc(r.created_at), esc(r.updated_at)
].join(',') + ')');
fs.writeFileSync(path.join(dir, 'sql_sets.sql'), 'INSERT INTO public.instruction_sets (id,title,slug,product_code,short_description,notice_text,estimated_time,product_image_url,tools_required,category_id,created_by,created_at,updated_at) VALUES\n' + setLines.join(',\n') + '\nON CONFLICT (id) DO NOTHING;');

const steps = JSON.parse(fs.readFileSync(path.join(dir, 'instruction_steps.json'), 'utf8'));
const stepLines = steps.map(r => '(' + [
  esc(r.id), esc(r.instruction_set_id), esc(r.variant_id),
  r.step_number, r.order_index, esc(r.subtitle), esc(r.description),
  esc(r.image_url), esc(r.image_original_url), esc(r.image2_url), esc(r.image2_original_url), esc(r.video_url)
].join(',') + ')');
fs.writeFileSync(path.join(dir, 'sql_steps.sql'), 'INSERT INTO public.instruction_steps (id,instruction_set_id,variant_id,step_number,order_index,subtitle,description,image_url,image_original_url,image2_url,image2_original_url,video_url) VALUES\n' + stepLines.join(',\n') + '\nON CONFLICT (id) DO NOTHING;');

const pubs = JSON.parse(fs.readFileSync(path.join(dir, 'guide_publications.json'), 'utf8'));
const pubLines = pubs.map(r => '(' + [
  esc(r.id), esc(r.instruction_set_id), esc(r.brand_id), esc(r.status), esc(r.published_at), esc(r.dymo_label_url)
].join(',') + ')');
fs.writeFileSync(path.join(dir, 'sql_pubs.sql'), 'INSERT INTO public.guide_publications (id,instruction_set_id,brand_id,status,published_at,dymo_label_url) VALUES\n' + pubLines.join(',\n') + '\nON CONFLICT (id) DO NOTHING;');

const vehs = JSON.parse(fs.readFileSync(path.join(dir, 'guide_vehicles.json'), 'utf8'));
const vehLines = vehs.map(r => '(' + [
  esc(r.id), esc(r.instruction_set_id), esc(r.make), esc(r.model), r.year_from, r.year_to
].join(',') + ')');
fs.writeFileSync(path.join(dir, 'sql_vehs.sql'), 'INSERT INTO public.guide_vehicles (id,instruction_set_id,make,model,year_from,year_to) VALUES\n' + vehLines.join(',\n') + '\nON CONFLICT (id) DO NOTHING;');

console.log(sets.length + ' sets, ' + steps.length + ' steps, ' + pubs.length + ' pubs, ' + vehs.length + ' vehicles');
