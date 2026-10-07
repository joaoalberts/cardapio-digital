-- Página pública do cardápio: capa, fonte do restaurante e endereços reservados.

-- Capa da tela inicial do cardápio (vídeo curto em loop, com imagem enquanto carrega).
alter table public.restaurants
  add column cover_video_path text,
  add column cover_image_path text;

-- Fonte do cardápio, escolhida pelo restaurante no painel (uma das combinações prontas).
alter table public.restaurants
  add column font_theme text not null default 'moderno'
    check (font_theme in ('moderno', 'letreiro', 'boutique', 'neon', 'laboratorio', 'taverna'));

grant update (cover_video_path, cover_image_path, font_theme) on public.restaurants to authenticated;

-- O cardápio fica em /<slug>; estes endereços são páginas do próprio sistema.
alter table public.restaurants
  add constraint restaurants_slug_not_reserved check (
    slug not in ('painel', 'entrar', 'cadastro', 'auth', 'api', 'demo', 'admin', 'm', 'www')
  );

create or replace function public.get_public_menu(p_slug text, p_lang text default 'pt-BR') returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', r.id, 'name', r.name, 'slug', r.slug, 'logo_path', r.logo_path,
      'brand_color', r.brand_color, 'languages', r.languages, 'menu_version', r.menu_version,
      'cover_video_path', r.cover_video_path, 'cover_image_path', r.cover_image_path,
      'font_theme', r.font_theme,
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
