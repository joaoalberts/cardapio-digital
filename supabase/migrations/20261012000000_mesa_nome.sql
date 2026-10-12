-- Nome da mesa para quem lê o QR dela. Visitantes não leem dining_tables; só recebem o
-- nome de uma mesa quando souberem o código dela (o que está no QR impresso).
create function public.get_table_label(p_slug text, p_code text) returns text
language sql stable security definer set search_path = '' as $$
  select t.label
  from public.dining_tables t
  join public.restaurants r on r.id = t.restaurant_id
  where r.slug = lower(p_slug) and t.code = upper(p_code) and t.active
$$;

revoke execute on function public.get_table_label(text, text) from public;
grant execute on function public.get_table_label(text, text) to anon, authenticated;
