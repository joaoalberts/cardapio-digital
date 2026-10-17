#!/usr/bin/env bash
# Restaura um backup do scripts/backup.sh por cima do banco atual (tudo ou nada).
#   scripts/restore.sh backups/cardapio-db-AAAA-MM-DD-HHMM.dump
# Para o NocoDB durante a troca (o app fica fora do ar por alguns segundos) e sobe de novo no fim. Enquanto isso, o
# vigia.sh não religa o NocoDB (trava em backups/.restaurando).
set -euo pipefail
cd "$(dirname "$0")/.."
dump="${1:?uso: scripts/restore.sh backups/cardapio-db-AAAA-MM-DD-HHMM.dump}"
[ -s "$dump" ] || { echo "não achei $dump"; exit 1; }
dc() { docker compose --env-file "${ENV_FILE:-.env}" "$@"; }

mkdir -p backups && touch backups/.restaurando
dc stop nocodb >/dev/null
trap 'dc start nocodb >/dev/null; rm -f backups/.restaurando' EXIT
dc exec -T db pg_restore -U nocodb -d nocodb --clean --if-exists --no-owner --single-transaction --exit-on-error < "$dump"
echo "restaurado: $dump"
