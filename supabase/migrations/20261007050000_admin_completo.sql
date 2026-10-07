-- Painel completo (referência DGuests): foto/vídeo e observação nas categorias,
-- horário da categoria, pratos em destaque, ocultar preço, alergênicos, "serve X
-- pessoas", banner da capa como mídia e os dados do perfil do restaurante.

-- Mídia agora pode ser do prato, da categoria (card da capa) ou do restaurante
-- (banner da capa: sem prato e sem categoria).
alter table public.media
  alter column item_id drop not null,
  add column category_id uuid,
  add constraint media_category_fk foreign key (category_id, restaurant_id)
    references public.categories (id, restaurant_id) on delete cascade,
  add constraint media_one_owner check (item_id is null or category_id is null);

create index media_category_idx on public.media (category_id) where category_id is not null;

alter table public.categories
  add column description text not null default '' check (char_length(description) <= 300),
  -- Categoria só aparece nesse intervalo (hora do restaurante); vazio = sempre.
  add column available_from time,
  add column available_to time,
  add constraint categories_window check ((available_from is null) = (available_to is null));

alter table public.items
  add column featured boolean not null default false,
  add column hide_price boolean not null default false,
  add column serves smallint check (serves between 1 and 20),
  add column country text check (char_length(country) <= 40),
  -- Múltiplos preços (ex.: P, M, G): [{"label": "Média", "price_cents": 5800}, ...].
  add column price_options jsonb check (price_options is null or (jsonb_typeof(price_options) = 'array'
    and jsonb_array_length(price_options) between 2 and 8)),
  drop constraint items_tags_check,
  add constraint items_tags_check check (tags <@ array[
    'vegetariano', 'vegano', 'sem_lactose', 'com_lactose', 'sem_acucar', 'com_leite',
    'sem_gluten', 'com_gluten', 'com_ovo', 'com_soja', 'com_crustaceos', 'com_peixe',
    'com_amendoas', 'com_castanhas', 'com_corantes',
    'apimentado', 'contem_nozes', 'contem_frutos_do_mar']::text[]);

alter table public.restaurants
  add column description text not null default '' check (char_length(description) <= 300),
  add column phone text check (char_length(phone) <= 30),
  add column address text check (char_length(address) <= 200),
  add column instagram text check (instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  add column facebook text check (char_length(facebook) <= 80),
  add column wifi_name text check (char_length(wifi_name) <= 60),
  add column wifi_password text check (char_length(wifi_password) <= 60),
  add column payment_methods text[] not null default '{}'
    check (payment_methods <@ array['pix', 'credito', 'debito', 'dinheiro', 'vale_refeicao']::text[]),
  add column show_hours boolean not null default true,
  add column show_payments boolean not null default false;

grant update (name, brand_color, description, phone, address, instagram, facebook,
  wifi_name, wifi_password, payment_methods, show_hours, show_payments)
  on public.restaurants to authenticated;

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
          'mux_playback_id', m.mux_playback_id, 'poster_path', m.poster_path)
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
            'mux_playback_id', m.mux_playback_id, 'poster_path', m.poster_path)
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

-- Suporte: o restaurante abre um chamado pelo painel; a equipe lê no banco.
create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 120),
  whatsapp text check (char_length(whatsapp) <= 30),
  message text not null check (char_length(message) between 1 and 3000),
  created_at timestamptz not null default now()
);

alter table public.support_requests enable row level security;
grant select, insert on public.support_requests to authenticated;
create policy "membros abrem chamados" on public.support_requests
  for insert to authenticated with check (public.is_member(restaurant_id) and user_id = auth.uid());
create policy "cada um vê os próprios chamados" on public.support_requests
  for select to authenticated using (user_id = auth.uid());
