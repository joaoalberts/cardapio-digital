-- Logo enviada pelo restaurante (não depende da fonte) e horário de funcionamento,
-- que vira "Aberto · até 23h" na capa do cardápio.

-- Horário: 7 dias (0 = domingo), cada um com faixas {"open":"18:00","close":"23:00"}.
-- Fechar antes de abrir (ex.: 18:00 às 02:00) quer dizer que passa da meia-noite.
alter table public.restaurants
  add column timezone text not null default 'America/Sao_Paulo',
  add column opening_hours jsonb
    check (opening_hours is null
      or (jsonb_typeof(opening_hours) = 'array' and jsonb_array_length(opening_hours) = 7));

grant update (timezone, opening_hours) on public.restaurants to authenticated;

-- Arquivos do cardápio (logo, fotos) ficam no bucket público "media", numa pasta
-- por restaurante: <restaurant_id>/arquivo. Só membros escrevem na pasta do seu.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create function public.path_restaurant_id(path text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when split_part(path, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(path, '/', 1)::uuid
  end
$$;

create policy "membros enviam arquivos do restaurante" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and public.is_member(public.path_restaurant_id(name)));
create policy "membros trocam arquivos do restaurante" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and public.is_member(public.path_restaurant_id(name)))
  with check (bucket_id = 'media' and public.is_member(public.path_restaurant_id(name)));
create policy "membros apagam arquivos do restaurante" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and public.is_member(public.path_restaurant_id(name)));
create policy "membros listam arquivos do restaurante" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and public.is_member(public.path_restaurant_id(name)));

create or replace function public.get_public_menu(p_slug text, p_lang text default 'pt-BR') returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', r.id, 'name', r.name, 'slug', r.slug, 'logo_path', r.logo_path,
      'brand_color', r.brand_color, 'languages', r.languages, 'menu_version', r.menu_version,
      'cover_video_path', r.cover_video_path, 'cover_image_path', r.cover_image_path,
      'font_theme', r.font_theme, 'timezone', r.timezone, 'opening_hours', r.opening_hours,
      'language', case when p_lang = any (r.languages) then p_lang else 'pt-BR' end
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', coalesce(ct.name, c.name),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id,
            'name', coalesce(it.name, i.name),
            'description', coalesce(nullif(it.description, ''), i.description),
            'price_cents', i.price_cents,
            'media', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', m.id, 'kind', m.kind, 'storage_path', m.storage_path,
                'mux_playback_id', m.mux_playback_id, 'poster_path', m.poster_path
              ) order by m.position)
              from public.media m
              where m.item_id = i.id and m.status = 'ready'
            ), '[]'::jsonb)
          ) order by i.position, i.created_at)
          from public.items i
          left join public.translations it
            on it.item_id = i.id and it.language = p_lang and p_lang = any (r.languages)
          where i.category_id = c.id and i.active
        ), '[]'::jsonb)
      ) order by c.position, c.created_at)
      from public.categories c
      left join public.translations ct
        on ct.category_id = c.id and ct.language = p_lang and p_lang = any (r.languages)
      where c.restaurant_id = r.id and c.active
    ), '[]'::jsonb)
  )
  from public.restaurants r
  where r.slug = lower(p_slug)
$$;
