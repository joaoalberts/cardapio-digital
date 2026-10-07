# Cardápio Digital

Cardápio em stories 9:16 para restaurantes, com painel de edição, QR Code por mesa e
atualização em tempo real. Vários restaurantes usam o mesmo sistema, cada um vendo só
os próprios dados.

Arquitetura: Next.js na Vercel, Supabase (Postgres, login, Realtime, Storage) e Mux para
vídeo. Documento completo:
https://claude.ai/code/artifact/1aeaa1c6-07e6-46d1-94bd-3fa7d1ff32c6

## Rodar localmente

Com Docker instalado, o jeito mais rápido é o Supabase local:

1. `npx supabase start` (aplica a migração sozinho e mostra a URL e a chave publishable).
2. Copie `.env.example` para `.env.local` com esses dois valores.
3. `npm install` e `npm run dev`, depois abra http://localhost:3000.

Com um projeto na nuvem:

1. Crie um projeto no [Supabase](https://supabase.com) e aplique a migração em
   `supabase/migrations/` (pelo SQL Editor ou com `supabase db push`).
2. Em Authentication > URL Configuration, adicione `http://localhost:3000/auth/callback`
   às Redirect URLs.
3. Copie `.env.example` para `.env.local` e preencha a URL e a chave publishable.
4. `npm install` e `npm run dev`, depois abra http://localhost:3000.

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
- `src/app/painel/`: painel do restaurante.
