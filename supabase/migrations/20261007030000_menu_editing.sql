-- Painel do cardápio: preço promocional, selos do prato (vegano, sem glúten…),
-- traduções sugeridas automaticamente e ordem das categorias e pratos.

alter table public.items
  add column promo_price_cents integer check (promo_price_cents >= 0),
  add column tags text[] not null default '{}'
    check (tags <@ array['vegetariano', 'vegano', 'sem_gluten', 'sem_lactose', 'sem_acucar',
                         'apimentado', 'contem_nozes', 'contem_frutos_do_mar']::text[]),
  add constraint items_promo_below_price check (promo_price_cents is null or promo_price_cents < price_cents);

-- Tradução sugerida pela máquina e ainda não revisada pelo dono.
alter table public.translations add column auto boolean not null default false;

-- Reordena categorias ou pratos de uma vez: a posição vira o índice na lista.
-- Roda com as regras do próprio usuário (security invoker), então só mexe no que é dele.
create function public.set_positions(p_table text, p_ids uuid[]) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_table = 'categories' then
    update public.categories c set position = x.i - 1
    from unnest(p_ids) with ordinality as x(id, i) where c.id = x.id;
  elsif p_table = 'items' then
    update public.items it set position = x.i - 1
    from unnest(p_ids) with ordinality as x(id, i) where it.id = x.id;
  else
    raise exception 'tabela inválida' using errcode = '22023';
  end if;
end
$$;

revoke execute on function public.set_positions(text, uuid[]) from public, anon;
grant execute on function public.set_positions(text, uuid[]) to authenticated;

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
            'promo_price_cents', i.promo_price_cents,
            'tags', i.tags,
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
