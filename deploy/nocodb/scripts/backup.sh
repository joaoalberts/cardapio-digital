#!/usr/bin/env bash
# Backup diário do banco inteiro do NocoDB (estrutura, metadados e dados da base "Cardápio Digital").
# Tem os hashes das senhas do painel: só o root lê. Guarda 14 dias.
#   crontab -e  ->  47 3 * * * /opt/cardapio-db/scripts/backup.sh >> /opt/cardapio-db/backups/backup.log 2>&1
# (03:47 UTC, meia hora depois do backup do LembreiAi, para não disputarem o disco). ENV_FILE troca o .env (teste local).
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
mkdir -p backups
# com a hora: um backup feito à mão (antes de uma troca) não some com o da madrugada do mesmo dia
arquivo="backups/cardapio-db-$(date +%F-%H%M).dump"
docker compose --env-file "${ENV_FILE:-.env}" exec -T db pg_dump -U nocodb -Fc nocodb > "$arquivo.tmp"
mv "$arquivo.tmp" "$arquivo"
find backups -name 'cardapio-db-*.dump' -mtime +14 -delete
echo "$(date '+%F %T') backup ok: $arquivo ($(du -h "$arquivo" | cut -f1))"
