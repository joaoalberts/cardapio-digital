# Banco do Cardápio Digital na VPS (NocoDB próprio)

Atualizado em 16/10/2026. Plano completo e lista do que é do João:
`docs/superpowers/plans/2026-10-16-nocodb-na-vps.md` (só na pasta local, fora do git).

| Peça | Onde | Endereço |
|---|---|---|
| App | Vercel, projeto `cardapio-digital` (região `gru1`) | — |
| Banco (API) | VPS `srv1974100`, em `/opt/cardapio-db` | `https://<nome>.6dtywz.easypanel.host` (o João escolhe o nome) |
| Tela do NocoDB | mesma VPS, só em `127.0.0.1:18080` | pelo túnel SSH (abaixo) |
| Backup | VPS, `/opt/cardapio-db/backups` (14 dias, 03:47 UTC) | — |

Custo extra: zero (a VPS já é paga). Sem limite de chamadas nem de linhas.

## Como funciona

```
Vercel (gru1) ──HTTPS──> Traefik do Easypanel ──> gateway (Caddy: só a API de dados, com token) ──> nocodb ──> db (Postgres)
                          (certificado *.6dtywz.easypanel.host)
Mac do João ──túnel SSH──> 127.0.0.1:18080 (tela do NocoDB, setup.mjs, cópia da base)
```

- Mesmo desenho do LembreiAi (`Aplicativos/lembreiAI/deploy/README.md`): nenhum contêiner publica porta para a
  internet; o `gateway` entra no Traefik do Easypanel por rótulos. Nada do Easypanel, do LembreiAi nem do Versdios muda.
- O porteiro (`Caddyfile`) deixa passar só o que o app usa: lista das tabelas, ler/criar/alterar/apagar linhas e
  contar, sempre com o cabeçalho `xc-token` (o `xc-auth` de sessão é descartado). Tela, login, cadastro, tokens e
  mudança de estrutura dão 404.
  `scripts/conferir-porteiro.sh` confere isso pelo endereço público, sem gravar nada.
- A Vercel não tem IP fixo no plano grátis: o filtro é por caminho e token, não por IP.

## Para não cair e não atrapalhar o LembreiAi

- Tetos (medidos no Docker do Mac em 16/10): NocoDB 1 GB (usa ~700 MB parado e no pico), Postgres 256 MB (~105 MB),
  porteiro 128 MB (~20 MB; 57 MB no pico com compressão). CPU: NocoDB no máximo 1 núcleo, banco e porteiro meio cada,
  todos com peso de CPU menor que o do LembreiAi (`cpu_shares: 512`).
- `restart: unless-stopped` em todos; `scripts/vigia.sh` (cron, a cada 2 min) religa quem parou e reinicia quem trava
  sem cair, e anota tudo em `backups/vigia.log`.

## Túnel para a tela (só o João)

```bash
ssh -N -L 18080:127.0.0.1:18080 -i ~/.ssh/lembreiai_vps root@srv1974100.hstgr.cloud
```

Com ele aberto: tela em http://127.0.0.1:18080 (feche com Ctrl+C).

## Operação (na VPS, em `/opt/cardapio-db`)

| Para… | Rode |
|---|---|
| ver se está tudo de pé | `docker compose --env-file .env ps` |
| ver erros do NocoDB | `docker compose --env-file .env logs nocodb --tail 50` |
| memória e CPU agora | `docker stats --no-stream` |
| backup agora | `scripts/backup.sh` |
| restaurar um backup | `scripts/restore.sh backups/cardapio-db-AAAA-MM-DD-HHMM.dump` (o vigia espera) |
| conferir o porteiro | `read -rs TOKEN; export TOKEN` (cole e Enter), depois `scripts/conferir-porteiro.sh https://<nome>.6dtywz.easypanel.host <base-id>` |
| esqueci a senha do administrador | ponha `NC_ADMIN_EMAIL` e `NC_ADMIN_PASSWORD` no `.env` e em `environment` do `nocodb`, `docker compose --env-file .env up -d`, entre, e tire as duas de novo (testado em 16/10) |
| atualizar o NocoDB | backup, trocar a versão em `image:` no compose, `docker compose --env-file .env pull && docker compose --env-file .env up -d` |

## Teste local (Docker do Mac, sem servidor)

```bash
deploy/nocodb/teste/teste-local.sh --carga
```

Sobe tudo do zero, cria a conta e o token de teste, cria as tabelas com o `setup.mjs`, enche uma base de origem,
copia com `scripts/nocodb/copiar-base.mjs`, confere o porteiro e o cliente do app, faz backup e restauração, mede a
carga e apaga tudo no fim (`--manter` deixa no ar).

## Segredos

- `/opt/cardapio-db/.env` (permissão 600), gerado lá por `scripts/gen-env.sh`: senha do Postgres e segredo do JWT do
  NocoDB. Guarde uma cópia no cofre de senhas.
- O token da API nasce na tela do NocoDB (o João cria) e vai só para a Vercel (`NOCODB_API_TOKEN`) e, durante a
  migração, para o `.env.migracao` do Mac (fora do git), apagado no fim.
