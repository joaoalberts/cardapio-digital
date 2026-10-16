# Cardápio Digital

Cardápio em stories 9:16 para restaurantes, com painel de edição, QR Code por mesa e
atualização em tempo real. Vários restaurantes usam o mesmo sistema, cada um vendo só
os próprios dados.

Arquitetura: Next.js na Vercel, banco no NocoDB (base "Cardápio Digital"), login próprio
do app, fotos no Vercel Blob e Mux para vídeo. Documento completo:
https://claude.ai/code/artifact/1aeaa1c6-07e6-46d1-94bd-3fa7d1ff32c6

## Banco (NocoDB)

`node scripts/nocodb/setup.mjs` (com `NOCODB_API_TOKEN`) cria ou completa as tabelas na
base. O app só fala com o NocoDB pelo servidor (`src/lib/db/nocodb.ts`), e cada ação
confere se quem chamou é membro do restaurante (`src/lib/auth`). O NocoDB na nuvem aceita
5 pedidos por segundo por token; o app se segura em 4 por instância e espera quando passa.
Num NocoDB próprio, sem esse limite, `NOCODB_MAX_RPS` sobe o teto (ex.: 20).

## Rodar localmente

1. Copie `.env.example` para `.env.local` e preencha `NOCODB_API_TOKEN` (e
   `BLOB_READ_WRITE_TOKEN` para enviar fotos).
2. `npm install` e `npm run dev`, depois abra http://localhost:3000.

## Publicar (Vercel)

1. Variáveis (marque Production e Preview e faça um novo deploy depois de mudar):
   - `NOCODB_API_TOKEN`: token do NocoDB com acesso à base "Cardápio Digital".
   - `BLOB_READ_WRITE_TOKEN`: criada sozinha ao ligar um Blob store ao projeto (Storage >
     Create > Blob). Crie a loja como **Public** e marque "Add a read-write token env var";
     sem isso as fotos não abrem para o cliente ou o painel não envia fotos.
   - `AUTH_SECRET` (opcional): assina o cookie de login; sem ela, deriva do token do
     NocoDB. Trocar qualquer um dos dois desconecta todo mundo.
   - `ANTHROPIC_API_KEY` (opcional) liga a sugestão de traduções.
   - `MUX_TOKEN_ID` e `MUX_TOKEN_SECRET` ligam o vídeo dos pratos em qualidade máxima; sem
     eles, só vídeos de até 4 MB.
   - `SUPPORT_WHATSAPP` (opcional, só dígitos com DDI, ex.: 5511999999999) mostra o botão
     de WhatsApp na página Suporte. As mensagens ficam na tabela `support_requests`.
2. "Esqueci minha senha" ainda não manda e-mail (não há serviço de e-mail ligado); a
   página orienta a chamar o suporte.

## Pedidos (carrinho)

O cliente que lê o QR de uma mesa pode montar o pedido no próprio cardápio (Adicionar, meio a
meio nas categorias que aceitam, observação de até 140 caracteres) e enviar deslizando. O pedido
cai no painel (aba **Pedidos**), que consulta a cada 5 s. O cliente acompanha em "Meus pedidos".
Não há pagamento: a conta é paga direto no restaurante.

- **Chave:** painel > Pedidos > "Receber pedidos pelo cardápio" (`restaurants.orders_enabled`).
  Desligada, ou sem `?mesa=<código>` válido, o cardápio fica exatamente como era.
- **Categorias:** "Aceita meio a meio" (`categories.half_half`). O preço da metade-metade é a
  média dos dois sabores, arredondada para cima no centavo.
- **Tabela `orders`** (criada por `scripts/nocodb/setup.mjs`): `uid`, `restaurant_id`, `table_id`,
  `table_label`, `status` (`new` > `preparing` > `ready` > `delivered`), `open`, `lines` (JSON),
  `total_cents`, `device_id`, `client_ref` (idempotência: o mesmo `ref` nunca gera dois pedidos),
  `created_at`, `status_at`.
- **Rota** `/api/pedidos/[slug]`: `POST` cria o pedido (o servidor recalcula preço e confere
  prato, horário da categoria e chave; recusa com `disabled`, `invalid`, `unavailable` etc.);
  `GET ?device=` lista só os pedidos daquele aparelho nas últimas 6 h.
- **Limites:** 20 unidades por linha, 30 linhas por pedido, carrinho guardado 6 h no celular.
- **Testes:** `npm test` (Vitest, com banco falso em memória).
- **Antes de publicar:** rode `setup.mjs` na base real, porque salvar categoria grava `half_half`
  e a chave na aba Pedidos grava `orders_enabled`.

### NocoDB local descartável (teste ponta a ponta)

```bash
docker run -d --name cardapio-nocodb -p 8080:8080 nocodb/nocodb:latest
# abra http://localhost:8080, crie a conta de administrador (só deste contêiner)
# e gere um token em Team & Settings > Tokens
NOCODB_SELF_HOSTED=1 NOCODB_URL=http://localhost:8080 NOCODB_API_TOKEN=<token> node scripts/nocodb/setup.mjs
```

Grave no `.env.local` (ignorado pelo git) `NOCODB_URL=http://localhost:8080`, `NOCODB_API_TOKEN`,
`NOCODB_BASE_ID` (id que o setup imprime) e `AUTH_SECRET`; depois `npm run dev`. Para parar:
`docker stop cardapio-nocodb`. Nunca aponte o teste para a NocoDB da nuvem.

## Verificações

- `npm test`, `npm run lint` e `npm run typecheck`
- `npm run build`

## Estrutura

- `supabase/migrations/`: o banco antigo, guardado como referência até a troca final.
- `src/lib/db/`, `src/lib/auth/`, `src/lib/storage.ts`: NocoDB, login e arquivos.
- `src/proxy.ts`: protege `/painel` pelo cookie de login.
- `src/app/(auth)/`: cadastro e login.
- `src/app/painel/cardapio/`: categorias e pratos (foto, preço, promoção, selos, ordem,
  esconder) e traduções. Com `ANTHROPIC_API_KEY` no `.env.local`, o painel sugere as
  traduções sozinho e o dono revisa; sem ela, traduz à mão.
- `src/app/painel/`: painel do restaurante; `aparencia/` escolhe a fonte do cardápio com
  prévia ao vivo.
- `src/app/painel/perfil/`: logo (enviada ao Vercel Blob, pasta por restaurante)
  e horário de funcionamento, que vira o selo "Aberto | até 23h" abaixo da logo.
- `src/app/[slug]/`: cardápio público em stories (`/<endereço-do-restaurante>`), com
  idiomas por bandeira e lista.
- `src/lib/menu/`: leitura do cardápio, idiomas, fontes e mídia.
- `supabase/seed.sql` e `public/demo/`: restaurante de exemplo Forno Aurora.
