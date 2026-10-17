#!/usr/bin/env bash
# Cria deploy/nocodb/.env com segredos aleatórios. RODE NA VPS: os segredos nascem lá e não passam por outro lugar.
# Não sobrescreve um .env existente (trocar a senha do banco ou o segredo do JWT quebra o que já está no ar).
#   scripts/gen-env.sh <host-público>
#   ex.: scripts/gen-env.sh cardapio-db.6dtywz.easypanel.host
# O token da API NÃO nasce aqui: o João cria na tela do NocoDB e cola só na Vercel.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -e .env ]; then echo ".env já existe: não sobrescrevi."; exit 0; fi
PUBLIC_HOST="${1:?uso: scripts/gen-env.sh <host-público>}"

# só letras e números: a senha entra na URL do NC_DB (pg://...&p=<senha>&...)
rand() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | cut -c1-"$1"; }

umask 077
cat > .env <<ENV
# Gerado por scripts/gen-env.sh em $(date -u +%F). NÃO commite e guarde uma cópia no cofre de senhas.
PUBLIC_HOST=$PUBLIC_HOST
POSTGRES_PASSWORD=$(rand 32)
NC_AUTH_JWT_SECRET=$(rand 48)

# Traefik do Easypanel (rede e entrypoint HTTPS), iguais aos do LembreiAi
TRAEFIK_NETWORK=easypanel
TRAEFIK_ENTRYPOINT=https

# porta da tela do NocoDB, só em 127.0.0.1 (túnel SSH)
NC_UI_PORT=18080
ENV
echo ".env criado (permissão 600). Endereço da API: https://$PUBLIC_HOST"
