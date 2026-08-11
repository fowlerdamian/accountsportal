-- Remove the 10-minute cooldown on manual Xero invoice sync (finance module).
create or replace function public.request_xero_invoice_sync()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  sync_key text;
begin
  select get_xero_sync_key() into sync_key;
  if sync_key is null then
    return jsonb_build_object('ok', false, 'error', 'sync key missing');
  end if;

  insert into xero_manual_sync_log (requested_by) values (coalesce(auth.jwt() ->> 'email', 'unknown'));

  perform net.http_post(
    url     := 'https://nvlezbqolzwixquusbfo.supabase.co/functions/v1/xero-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-sync-key', sync_key),
    body    := jsonb_build_object(
      'entities', jsonb_build_array('invoices'),
      'date_from', to_char(now() - interval '35 days', 'YYYY-MM-DD'),
      'date_to',   to_char(now(), 'YYYY-MM-DD'),
      'sync_type', 'delta'),
    timeout_milliseconds := 300000
  );
  return jsonb_build_object('ok', true);
end;
$function$;
