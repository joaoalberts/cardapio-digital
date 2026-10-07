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
insert into public.items (restaurant_id, category_id, name, description, price_cents)
  values (:'pizzaria', :'pizzas', 'Margherita', 'Molho de tomate e manjericão', 4990)
  returning id as margherita \gset
-- Ana libera inglês e espanhol e traduz só a pizza para inglês.
update public.restaurants set languages = '{pt-BR,en,es}' where id = :'pizzaria';
insert into public.translations (restaurant_id, item_id, language, name, description)
  values (:'pizzaria', :'margherita', 'en', 'Margherita', 'Tomato sauce and basil');
insert into public.translations (restaurant_id, category_id, language, name)
  values (:'pizzaria', :'pizzas', 'en', 'Pizzas (EN)');
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
  -- A versão do cardápio subiu com as mudanças (1 + categoria + 2 itens + 2 traduções).
  select menu_version into n from public.restaurants;
  assert n = 6, 'menu_version deveria ser 6, é ' || n;
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

-- Endereço reservado do sistema é recusado.
do $$
begin
  begin
    perform public.create_restaurant('Painel', 'painel');
    raise exception 'slug reservado foi aceito';
  exception when check_violation then null;
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
  assert menu->'categories'->0->'items'->0->>'description' = 'Molho de tomate e manjericão',
    'sem idioma deveria vir em português';

  -- Inglês: usa a tradução.
  menu := public.get_public_menu('pizzaria-ana', 'en');
  assert menu->'restaurant'->>'language' = 'en', 'idioma deveria ser en';
  assert menu->'categories'->0->>'name' = 'Pizzas (EN)', 'categoria deveria vir em inglês';
  assert menu->'categories'->0->'items'->0->>'description' = 'Tomato sauce and basil',
    'item deveria vir em inglês';

  -- Espanhol liberado mas sem tradução: cai no português.
  menu := public.get_public_menu('pizzaria-ana', 'es');
  assert menu->'categories'->0->'items'->0->>'description' = 'Molho de tomate e manjericão',
    'sem tradução deveria cair no português';

  -- Idioma não liberado pelo restaurante: volta ao português.
  menu := public.get_public_menu('pizzaria-ana', 'de');
  assert menu->'restaurant'->>'language' = 'pt-BR', 'idioma não liberado deveria voltar a pt-BR';
end $$;

\echo 'rls.test.sql: tudo certo'
