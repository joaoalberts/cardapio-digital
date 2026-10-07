-- Testes de permissão: cada restaurante só vê e edita o que é seu.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@exemplo.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bia@exemplo.com');

create function pg_temp.login(uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, false)
$$;

-- Ana cria a Pizzaria, Bia cria o Sushi.
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select id as pizzaria from public.create_restaurant('Pizzaria da Ana', 'Pizzaria-Ana') \gset
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select id as sushi from public.create_restaurant('Sushi da Bia', 'sushi-bia') \gset
select set_config('test.pizzaria', :'pizzaria', false);

-- Ana monta o cardápio dela.
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into public.categories (restaurant_id, name) values (:'pizzaria', 'Pizzas') returning id as pizzas \gset
insert into public.items (restaurant_id, category_id, name, price_cents)
  values (:'pizzaria', :'pizzas', 'Margherita', 4990);
insert into public.items (restaurant_id, category_id, name, price_cents, active)
  values (:'pizzaria', :'pizzas', 'Fora do cardápio', 1000, false);
insert into public.dining_tables (restaurant_id, label) values (:'pizzaria', 'Mesa 7') returning code \gset

do $$
declare n int;
begin
  -- Ana vê só o próprio restaurante.
  select count(*) into n from public.restaurants;
  assert n = 1, 'Ana deveria ver 1 restaurante, viu ' || n;
  select count(*) into n from public.restaurants where slug = 'pizzaria-ana';
  assert n = 1, 'slug deveria ser salvo em minúsculas';
  -- A versão do cardápio subiu com as mudanças (1 + categoria + 2 itens).
  select menu_version into n from public.restaurants;
  assert n = 4, 'menu_version deveria ser 4, é ' || n;
end $$;

-- Ana não pode mexer na assinatura.
do $$
begin
  begin
    update public.restaurants set subscription_status = 'active';
    raise exception 'Ana conseguiu mudar a assinatura';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Bia não vê nem altera nada da Ana.
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
do $$
declare n int;
begin
  select count(*) into n from public.categories;
  assert n = 0, 'Bia viu categorias da Ana';
  select count(*) into n from public.items;
  assert n = 0, 'Bia viu itens da Ana';
  select count(*) into n from public.dining_tables;
  assert n = 0, 'Bia viu mesas da Ana';
  update public.items set price_cents = 1;
  get diagnostics n = row_count;
  assert n = 0, 'Bia alterou itens da Ana';
end $$;

do $$
begin
  begin
    -- Inserir com o id de outro restaurante precisa falhar.
    execute format('insert into public.categories (restaurant_id, name) values (%L, %L)',
      current_setting('test.pizzaria'), 'Invasão');
    raise exception 'Bia criou categoria na Pizzaria';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Slug repetido é recusado.
do $$
begin
  begin
    perform public.create_restaurant('Outra', 'sushi-bia');
    raise exception 'slug repetido foi aceito';
  exception when unique_violation then null;
  end;
end $$;

-- Visitante (anon): não lê tabelas, só o cardápio público, sem itens inativos.
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$
declare menu jsonb; n int;
begin
  begin
    perform 1 from public.items;
    raise exception 'anon leu a tabela de itens';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_restaurant('X', 'xxx');
    raise exception 'anon criou restaurante';
  exception when insufficient_privilege then null;
  end;
  menu := public.get_public_menu('PIZZARIA-ANA');
  assert menu->'restaurant'->>'name' = 'Pizzaria da Ana', 'cardápio público sem nome';
  n := jsonb_array_length(menu->'categories'->0->'items');
  assert n = 1, 'cardápio público deveria ter 1 item ativo, tem ' || n;
  assert menu ? 'restaurant' and not (menu->'restaurant' ? 'subscription_status'),
    'cardápio público expõe a assinatura';
end $$;

\echo 'rls.test.sql: tudo certo'
