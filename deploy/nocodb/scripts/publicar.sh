#!/usr/bin/env bash
# Publica o banco do Cardápio Digital na VPS. Roda no Mac, na pasta do app, e só com OK do João.
#   deploy/nocodb/scripts/publicar.sh root@srv1974100.hstgr.cloud cardapio-db.6dtywz.easypanel.host
# Envia deploy/nocodb para /opt/cardapio-db (sem .env, backups e teste; não apaga nada lá), gera o .env NA VPS na
# primeira vez (os segredos não saem de lá), baixa as imagens e sobe. Não mexe no /opt/lembreiai nem no Easypanel.
set -euo pipefail
cd "$(dirname "$0")/.."
DESTINO="${1:?uso: deploy/nocodb/scripts/publicar.sh usuario@host <host-público>}"
HOST="${2:?uso: deploy/nocodb/scripts/publicar.sh usuario@host <host-público>}"
CHAVE="${SSH_KEY:-$HOME/.ssh/lembreiai_vps}"
PASTA=/opt/cardapio-db
ssh_() { ssh -o BatchMode=yes -i "$CHAVE" "$DESTINO" "$@"; }

ssh_ "mkdir -p $PASTA/backups && chmod 700 $PASTA/backups"
rsync -az --no-owner --no-group -e "ssh -o BatchMode=yes -i $CHAVE" \
  --exclude .env --exclude backups --exclude teste --exclude .gitignore ./ "$DESTINO:$PASTA/"
ssh_ "cd $PASTA && chmod +x scripts/*.sh && scripts/gen-env.sh '$HOST' \
  && docker compose --env-file .env pull -q && docker compose --env-file .env up -d \
  && docker compose --env-file .env ps --format '{{.Service}}: {{.State}} {{.Health}}'"
