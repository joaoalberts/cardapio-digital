#!/usr/bin/env bash
# Vigia do banco do Cardápio (cron, a cada 2 min). O Docker já sobe quem cai; isto cobre quem trava sem cair:
# banco ou NocoDB marcados como doentes pelo próprio healthcheck, e o porteiro que não responde 2 vezes seguidas.
# Também anota se o disco passar de 85%. Log em backups/vigia.log.
#   */2 * * * * /opt/cardapio-db/scripts/vigia.sh
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=backups/vigia.log
ESTADO=backups/.vigia
mkdir -p "$ESTADO"
dc() { docker compose --env-file "${ENV_FILE:-.env}" "$@"; }
anota() { echo "$(date '+%F %T') $*" >> "$LOG"; }
saude() { docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q "$1")" 2>/dev/null; }

# durante uma restauração (scripts/restore.sh) o NocoDB fica parado de propósito
[ -e backups/.restaurando ] && exit 0

# quem estiver parado volta, e fica anotado (senão um log vazio não provaria que nada caiu)
parados="$(comm -23 <(dc config --services | sort) <(dc ps --services --status running | sort) | tr '\n' ' ')"
if [ -n "${parados// /}" ]; then anota "parado(s): ${parados}religando"; dc up -d --no-recreate >/dev/null 2>&1; fi

for svc in db nocodb; do
  [ "$(saude $svc)" = unhealthy ] && { anota "$svc doente: reiniciando"; dc restart $svc >/dev/null 2>&1; }
done
# o porteiro só é culpado se o NocoDB estiver bem
if [ "$(saude nocodb)" = healthy ]; then
  if dc exec -T gateway wget -qO- -T 8 http://localhost/saude >/dev/null 2>&1; then rm -f "$ESTADO/gateway"
  else
    n=$(( $(cat "$ESTADO/gateway" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$ESTADO/gateway"
    [ "$n" -ge 2 ] && { anota "porteiro não respondeu 2x seguidas: reiniciando"; dc restart gateway >/dev/null 2>&1; rm -f "$ESTADO/gateway"; }
  fi
fi

uso=$(df -P / | awk 'NR==2 {print $5}' | tr -dc 0-9)
[ "${uso:-0}" -ge 85 ] && anota "ATENÇÃO: disco em ${uso}%"
[ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ] && tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exit 0
