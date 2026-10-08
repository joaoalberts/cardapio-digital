# Cardápio Digital

Cardápio em stories 9:16 para restaurantes, com painel de edição, QR Code por mesa e
atualização em tempo real. Vários restaurantes usam o mesmo sistema, cada um vendo só
os próprios dados.

Arquitetura: Next.js na Vercel, Supabase (Postgres, login, Realtime, Storage) e Mux para
vídeo. Documento completo:
https://claude.ai/code/artifact/1aeaa1c6-07e6-46d1-94bd-3fa7d1ff32c6

## Rodar localmente

Com Docker instalado, o jeito mais rápido é o Supabase local:

1. `npx supabase start` (aplica as migrações e o restaurante de exemplo, e mostra a URL
   e a chave publishable).
2. Copie `.env.example` para `.env.local` com esses dois valores.
3. `npm install` e `npm run dev`, depois abra http://localhost:3000.
4. O cardápio de exemplo fica em http://localhost:3000/forno-aurora (abra no celular ou
   no modo celular do navegador). `npx supabase db reset` volta o exemplo ao início.

Com um projeto na nuvem:

1. Crie um projeto no [Supabase](https://supabase.com) e aplique a migração em
   `supabase/migrations/` (pelo SQL Editor ou com `supabase db push`).
2. Em Authentication > URL Configuration, adicione `http://localhost:3000/auth/callback`
   às Redirect URLs.
3. Copie `.env.example` para `.env.local` e preencha a URL e a chave publishable.
4. `npm install` e `npm run dev`, depois abra http://localhost:3000.

## Publicar (Vercel)

1. Importe o repositório em vercel.com/new e defina `NEXT_PUBLIC_SUPABASE_URL` e
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (as mesmas do `.env.local`, com os dados do
   projeto no Supabase). `ANTHROPIC_API_KEY` é opcional e liga a sugestão de traduções.
   `MUX_TOKEN_ID` e `MUX_TOKEN_SECRET` (token do Mux com permissão de Mux Video) ligam o
   vídeo dos pratos em qualidade máxima; sem eles, o vídeo vai para o Storage (até 50 MB).
   Marque cada variável em Production e Preview e faça um novo deploy depois de mudar
   qualquer uma, porque elas só valem a partir do próximo deploy.
   `SUPPORT_WHATSAPP` (opcional, só dígitos com DDI, ex.: 5511999999999) mostra o botão de
   WhatsApp na página Suporte do painel. As mensagens do formulário ficam na tabela
   `support_requests`.
2. No Supabase, em Authentication > URL Configuration, use o endereço de produção como
   Site URL e adicione `https://*-<seu-time>.vercel.app/**` às Redirect URLs, para os
   links de pré-visualização de cada PR também conseguirem fazer login.

## Verificações

- `npm run lint` e `npm run typecheck`
- `npm run build`
- `npm run test:db`: sobe um Postgres temporário, aplica as migrações e confere que um
  restaurante não vê nem altera dados de outro. Precisa do Postgres instalado
  (`initdb`, `pg_ctl`, `psql`) e não roda como root.

## Estrutura

- `supabase/migrations/`: tabelas, regras de acesso por restaurante e funções
  (`create_restaurant`, `get_public_menu`).
- `src/proxy.ts`: renova a sessão e protege `/painel`.
- `src/app/(auth)/`: cadastro e login.
- `src/app/painel/cardapio/`: categorias e pratos (foto, preço, promoção, selos, ordem,
  esconder) e traduções. Com `ANTHROPIC_API_KEY` no `.env.local`, o painel sugere as
  traduções sozinho e o dono revisa; sem ela, traduz à mão.
- `src/app/painel/`: painel do restaurante; `aparencia/` escolhe a fonte do cardápio com
  prévia ao vivo.
- `src/app/painel/perfil/`: logo (enviada ao Storage, bucket `media`, pasta por restaurante)
  e horário de funcionamento, que vira o selo "Aberto | até 23h" abaixo da logo.
- `src/app/[slug]/`: cardápio público em stories (`/<endereço-do-restaurante>`), com
  idiomas por bandeira e lista.
- `src/lib/menu/`: leitura do cardápio, idiomas, fontes e mídia.
- `supabase/seed.sql` e `public/demo/`: restaurante de exemplo Forno Aurora.
