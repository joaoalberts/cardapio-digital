-- Base do cardápio digital: restaurantes (vários clientes), membros, cardápio,
-- mídia, traduções e mesas. Cada restaurante só enxerga os próprios dados (RLS).

create type public.member_role as enum ('owner', 'editor');
create type public.media_kind as enum ('photo', 'video');
create type public.media_status as enum ('processing', 'ready', 'failed');
create type public.subscription_status as enum ('trial', 'active', 'past_due', 'canceled');

-- Restaurantes -----------------------------------------------------------------

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique
    check (char_length(slug) between 3 and 40 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  logo_path text,
  brand_color text check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  languages text[] not null default '{pt-BR}',
  -- Aumenta a cada mudança no cardápio; o celular do cliente compara para saber se recarrega.
  menu_version bigint not null default 1,
  -- Assinatura: a cobrança (Pix) entra na última etapa; até lá todos ficam em teste.
  plan text not null default 'trial',
  subscription_status public.subscription_status not null default 'trial',
  trial_ends_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);

create table public.members (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);

create index members_user_id_idx on public.members (user_id);

-- Cardápio ---------------------------------------------------------------------
-- Cada tabela filha repete restaurant_id para as regras de acesso serem simples;
-- as chaves estrangeiras compostas garantem que ele bate com o do pai.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, restaurant_id)
);

create index categories_restaurant_idx on public.categories (restaurant_id, position);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  category_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  price_cents integer not null check (price_cents >= 0),
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (category_id, restaurant_id)
    references public.categories (id, restaurant_id) on delete cascade
);

create index items_category_idx on public.items (category_id, position);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  item_id uuid not null,
  kind public.media_kind not null,
  -- Foto: caminho no Supabase Storage. Vídeo: ids do Mux.
  storage_path text,
  mux_asset_id text,
  mux_playback_id text,
  poster_path text,
  position integer not null default 0,
  status public.media_status not null default 'processing',
  created_at timestamptz not null default now(),
  foreign key (item_id, restaurant_id)
    references public.items (id, restaurant_id) on delete cascade,
  check (
    (kind = 'photo' and storage_path is not null)
    or (kind = 'video')
  )
);

create index media_item_idx on public.media (item_id, position);

create table public.translations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  category_id uuid,
  item_id uuid,
  language text not null,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  foreign key (category_id, restaurant_id)
    references public.categories (id, restaurant_id) on delete cascade,
  foreign key (item_id, restaurant_id)
    references public.items (id, restaurant_id) on delete cascade,
  check ((category_id is null) <> (item_id is null))
);

create unique index translations_category_lang_idx
  on public.translations (category_id, language) where category_id is not null;
create unique index translations_item_lang_idx
  on public.translations (item_id, language) where item_id is not null;

-- Mesas e QR Code ----------------------------------------------------------------

-- Código curto e fixo de cada mesa, sem letras que se confundem (0/O, 1/I/L).
create function public.generate_table_code() returns text
language sql volatile as $$
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 6)
$$;

create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 40),
  code text not null unique default public.generate_table_code(),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index dining_tables_restaurant_idx on public.dining_tables (restaurant_id);

-- Funções de acesso ------------------------------------------------------------------

-- security definer para consultar members sem cair nas regras da própria tabela.
create function public.is_member(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.restaurant_id = rid and m.user_id = auth.uid()
  )
$$;

create function public.is_owner(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.restaurant_id = rid and m.user_id = auth.uid() and m.role = 'owner'
  )
$$;

-- Cadastro: cria o restaurante e torna quem chamou o dono dele.
create function public.create_restaurant(p_name text, p_slug text)
returns public.restaurants
language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.restaurants;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  insert into public.restaurants (name, slug)
  values (trim(p_name), lower(trim(p_slug)))
  returning * into r;

  insert into public.members (restaurant_id, user_id, role)
  values (r.id, auth.uid(), 'owner');

  return r;
end
$$;

-- Toda mudança no cardápio sobe a versão do restaurante.
create function public.bump_menu_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.restaurants
  set menu_version = menu_version + 1
  where id = coalesce(new.restaurant_id, old.restaurant_id);
  return null;
end
$$;

create trigger categories_bump after insert or update or delete on public.categories
  for each row execute function public.bump_menu_version();
create trigger items_bump after insert or update or delete on public.items
  for each row execute function public.bump_menu_version();
create trigger media_bump after insert or update or delete on public.media
  for each row execute function public.bump_menu_version();
create trigger translations_bump after insert or update or delete on public.translations
  for each row execute function public.bump_menu_version();

-- Cardápio público: só o que está ativo e pronto, numa chamada só.
create function public.get_public_menu(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', r.id, 'name', r.name, 'slug', r.slug, 'logo_path', r.logo_path,
      'brand_color', r.brand_color, 'languages', r.languages, 'menu_version', r.menu_version
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id, 'name', i.name, 'description', i.description,
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
          where i.category_id = c.id and i.active
        ), '[]'::jsonb)
      ) order by c.position, c.created_at)
      from public.categories c
      where c.restaurant_id = r.id and c.active
    ), '[]'::jsonb)
  )
  from public.restaurants r
  where r.slug = lower(p_slug)
$$;

-- Permissões ------------------------------------------------------------------------

alter table public.restaurants enable row level security;
alter table public.members enable row level security;
alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.media enable row level security;
alter table public.translations enable row level security;
alter table public.dining_tables enable row level security;

-- Visitantes leem o cardápio só por get_public_menu, nunca as tabelas.
revoke all on all tables in schema public from anon;

-- Restaurante: membros leem; só o dono edita, e só os campos de aparência.
-- Plano e assinatura só mudam pelo servidor (cobrança), nunca pelo painel.
revoke insert, update, delete on public.restaurants from authenticated;
grant select on public.restaurants to authenticated;
grant update (name, logo_path, brand_color, languages) on public.restaurants to authenticated;

create policy "membros leem o restaurante" on public.restaurants
  for select to authenticated using (public.is_member(id));
create policy "dono edita o restaurante" on public.restaurants
  for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));

revoke insert, update, delete on public.members from authenticated;
grant select on public.members to authenticated;
create policy "membros veem a equipe" on public.members
  for select to authenticated using (public.is_member(restaurant_id));

grant select, insert, update, delete on
  public.categories, public.items, public.media, public.translations, public.dining_tables
  to authenticated;

create policy "membros gerenciam categorias" on public.categories
  for all to authenticated
  using (public.is_member(restaurant_id)) with check (public.is_member(restaurant_id));
create policy "membros gerenciam itens" on public.items
  for all to authenticated
  using (public.is_member(restaurant_id)) with check (public.is_member(restaurant_id));
create policy "membros gerenciam mídia" on public.media
  for all to authenticated
  using (public.is_member(restaurant_id)) with check (public.is_member(restaurant_id));
create policy "membros gerenciam traduções" on public.translations
  for all to authenticated
  using (public.is_member(restaurant_id)) with check (public.is_member(restaurant_id));
create policy "membros gerenciam mesas" on public.dining_tables
  for all to authenticated
  using (public.is_member(restaurant_id)) with check (public.is_member(restaurant_id));

revoke execute on function public.create_restaurant(text, text) from public, anon;
grant execute on function public.create_restaurant(text, text) to authenticated;
grant execute on function public.get_public_menu(text) to anon, authenticated;
revoke execute on function public.bump_menu_version() from public, anon, authenticated;
