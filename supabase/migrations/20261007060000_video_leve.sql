-- Versão leve de cada vídeo do Mux: um MP4 em 720p (static rendition), usado nos
-- vídeos em loop da capa (banner e cards). Começa na hora e fica no cache do celular.
-- mux_mp4: null = ainda não sabemos/preparando; '' = não há; '720p.mp4' = pronto.
alter table public.media add column mux_mp4 text check (char_length(mux_mp4) <= 40);

create or replace function public.get_public_menu(p_slug text, p_lang text default 'pt-BR') returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', r.id, 'name', r.name, 'slug', r.slug, 'logo_path', r.logo_path,
      'brand_color', r.brand_color, 'languages', r.languages, 'menu_version', r.menu_version,
      'cover_video_path', r.cover_video_path, 'cover_image_path', r.cover_image_path,
      'cover', (
        select jsonb_build_object(
          'id', m.id, 'kind', m.kind, 'storage_path', m.storage_path,
          'mux_playback_id', m.mux_playback_id, 'mux_mp4', m.mux_mp4, 'poster_path', m.poster_path)
        from public.media m
        where m.restaurant_id = r.id and m.item_id is null and m.category_id is null and m.status = 'ready'
        order by m.created_at desc limit 1
      ),
      'font_theme', r.font_theme, 'timezone', r.timezone,
      'opening_hours', case when r.show_hours then r.opening_hours end,
      'description', r.description, 'phone', r.phone, 'address', r.address,
      'instagram', r.instagram, 'facebook', r.facebook,
      'wifi_name', r.wifi_name, 'wifi_password', r.wifi_password,
      'payment_methods', case when r.show_payments then r.payment_methods else '{}'::text[] end,
      'language', case when p_lang = any (r.languages) then p_lang else 'pt-BR' end
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', coalesce(ct.name, c.name),
        'description', coalesce(nullif(ct.description, ''), c.description),
        'available_from', c.available_from, 'available_to', c.available_to,
        'cover', (
          select jsonb_build_object(
            'id', m.id, 'kind', m.kind, 'storage_path', m.storage_path,
            'mux_playback_id', m.mux_playback_id, 'mux_mp4', m.mux_mp4, 'poster_path', m.poster_path)
          from public.media m
          where m.category_id = c.id and m.status = 'ready'
          order by m.created_at desc limit 1
        ),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id,
            'name', coalesce(it.name, i.name),
            'description', coalesce(nullif(it.description, ''), i.description),
            'price_cents', i.price_cents,
            'promo_price_cents', i.promo_price_cents,
            'hide_price', i.hide_price,
            'featured', i.featured,
            'serves', i.serves,
            'country', i.country,
            'price_options', i.price_options,
            'tags', i.tags,
            'media', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', m.id, 'kind', m.kind, 'storage_path', m.storage_path,
                'mux_playback_id', m.mux_playback_id, 'mux_mp4', m.mux_mp4, 'poster_path', m.poster_path
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
