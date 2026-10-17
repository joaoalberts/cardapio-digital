#!/usr/bin/env bash
# Teste completo do pacote no Docker do Mac, do zero, sem tocar em servidor nenhum:
#   deploy/nocodb/teste/teste-local.sh            sobe, testa tudo e apaga no fim
#   deploy/nocodb/teste/teste-local.sh --manter   deixa no ar (tela em http://127.0.0.1:18081, porteiro em :18090)
#   deploy/nocodb/teste/teste-local.sh --carga    inclui a medida de carga (20, 45 e 80 pedidos/s)
# Usa o projeto Docker "cardapio-db-teste" e as portas 18081 (tela) e 18090 (porteiro, no lugar do Traefik).
# A conta e o token de teste nascem aqui, em teste/.env.teste (fora do git), e morrem com o teste.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"; PACOTE="$(dirname "$AQUI")"; APP="$(cd "$PACOTE/../.." && pwd)"
ENVF="$AQUI/.env.teste"; P=cardapio-db-teste; REDE=cardapio-db-teste-traefik
TELA=http://127.0.0.1:18081; PORTEIRO=http://127.0.0.1:18090
dc() { docker compose -p $P --env-file "$ENVF" -f "$PACOTE/docker-compose.yml" -f "$AQUI/docker-compose.teste.yml" "$@"; }
passo() { printf '\n== %s\n' "$*"; }
espera() { for _ in $(seq 1 90); do [ "$(curl -s -o /dev/null -w '%{http_code}' $TELA/api/v1/health)" = 200 ] && return; sleep 2; done; echo "NocoDB não subiu"; exit 1; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
falha() { echo "FALHOU: $*"; exit 1; }
[[ " $* " == *" --manter "* ]] || trap 'dc down -v >/dev/null 2>&1; docker network rm $REDE >/dev/null 2>&1; rm -rf "$PACOTE/backups" "$ENVF"' EXIT

passo "sobe do zero (Postgres + NocoDB + porteiro)"
dc down -v >/dev/null 2>&1 || true
docker network inspect $REDE >/dev/null 2>&1 || docker network create $REDE >/dev/null
rand() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | cut -c1-"$1"; }
( umask 077; cat > "$ENVF" <<ENV
PUBLIC_HOST=cardapio-db.localhost
POSTGRES_PASSWORD=$(rand 32)
NC_AUTH_JWT_SECRET=$(rand 48)
TRAEFIK_NETWORK=$REDE
NC_UI_PORT=18081
ENV
)
dc up -d >/dev/null 2>&1; espera

passo "primeiro acesso vira administrador; token de teste"
SENHA="Tt-$(rand 20)9!"
JWT=$(curl -s -X POST $TELA/api/v1/auth/user/signup -H 'content-type: application/json' \
  -d "{\"email\":\"admin-teste@cardapio.test\",\"password\":\"$SENHA\"}" | json 'd["token"]')
TOKEN=$(curl -s -X POST $TELA/api/v1/tokens -H "xc-auth: $JWT" -H 'content-type: application/json' -d '{"description":"teste"}' | json 'd["token"]')
# o passo do João (scripts/fechar-cadastro.sh), aqui direto pela API
curl -s -o /dev/null -X POST $TELA/api/v1/app-settings -H "xc-auth: $JWT" -H 'content-type: application/json' \
  -d '{"invite_only_signup":true}'
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST $TELA/api/v1/auth/user/signup -H 'content-type: application/json' \
  -d '{"email":"intruso@cardapio.test","password":"Intruso-123!x"}')" != 200 ] || falha "segundo cadastro aceito"
echo "segundo cadastro recusado: ok"

passo "setup.mjs cria as tabelas (destino) e uma base de origem simulada"
base() { NOCODB_SELF_HOSTED=1 NOCODB_URL=$TELA NOCODB_API_TOKEN=$TOKEN NOCODB_BASE_TITLE="$1" node "$APP/scripts/nocodb/setup.mjs" | sed -nE 's/^base (criada|existente): (.*)/\2/p'; }
DESTINO=$(base "Cardápio Digital"); ORIGEM=$(base "Origem teste"); echo "destino $DESTINO, origem $ORIGEM"
URL=$TELA TOKEN=$TOKEN BASE=$ORIGEM node "$AQUI/semear.mjs" | tr '\n' ' '; echo

passo "cópia: igual, recusa destino cheio, acusa diferença, substitui"
export ORIGEM_URL=$TELA ORIGEM_TOKEN=$TOKEN ORIGEM_BASE=$ORIGEM DESTINO_URL=$TELA DESTINO_TOKEN=$TOKEN DESTINO_BASE=$DESTINO
copia() { node "$APP/scripts/nocodb/copiar-base.mjs" "$@"; }
copia | tail -3
contar() { curl -s "$TELA/api/v2/tables/$1/records/count" -H "xc-token: $TOKEN" | json 'd["count"]'; }
TRAD=$(curl -s $TELA/api/v2/meta/bases/$DESTINO/tables -H "xc-token: $TOKEN" | json '[t["id"] for t in d["list"] if t["title"]=="translations"][0]')
[ "$(contar $TRAD)" = 1234 ] || falha "translations no destino: $(contar $TRAD), esperado 1234 (paginação)"
echo "1234 traduções no destino (passou da página de 1000): ok"
saida=$(copia 2>&1 || true); grep -q "já tem linhas" <<<"$saida" || falha "copiou por cima de um destino cheio"
[ "$(contar $TRAD)" = 1234 ] || falha "a recusa duplicou o destino"
echo "destino cheio recusado, sem duplicar: ok"
TID=$(curl -s $TELA/api/v2/meta/bases/$DESTINO/tables -H "xc-token: $TOKEN" | json '[t["id"] for t in d["list"] if t["title"]=="items"][0]')
ID=$(curl -s "$TELA/api/v2/tables/$TID/records?limit=1&offset=30" -H "xc-token: $TOKEN" | json 'd["list"][0]["Id"]')
curl -s -o /dev/null -X PATCH $TELA/api/v2/tables/$TID/records -H "xc-token: $TOKEN" -H 'content-type: application/json' -d "[{\"Id\":$ID,\"price_cents\":1}]"
copia --conferir >/dev/null 2>&1 && falha "--conferir não viu a linha alterada"; echo "linha alterada acusada: ok"
copia --substituir | tail -1

passo "porteiro (Caddy): o app passa, o resto fica barrado"
TOKEN=$TOKEN "$PACOTE/scripts/conferir-porteiro.sh" $PORTEIRO $DESTINO | tail -1
# um JWT de sessão válido não pode passar no lugar do token, nem como xc-auth nem como Authorization, com token
# vazio, lixo ou com cara de token ("xc-token;" é como o curl manda o cabeçalho vazio; "xc-token: " ele não manda)
FALSO=$(rand 40)
for h in "xc-token;" "xc-token: lixo" "xc-token: $FALSO"; do
  for a in "xc-auth: $JWT" "Authorization: Bearer $JWT"; do
    c=$(curl -s -o /dev/null -w '%{http_code}' -H "$h" -H "$a" "$PORTEIRO/api/v2/meta/bases/$DESTINO/tables")
    case "$c" in 401|404) ;; *) falha "JWT de sessão (${a%%:*}) com '${h%%:*}…' deu $c pelo porteiro" ;; esac
  done
done
echo "JWT de sessão sem token recusado (xc-auth e Authorization): ok"

passo "o cliente do app (src/lib/db/nocodb.ts) pelo porteiro"
( cd "$APP" && NOCODB_URL=$PORTEIRO NOCODB_API_TOKEN=$TOKEN NOCODB_BASE_ID=$DESTINO \
  node --no-warnings --conditions=react-server deploy/nocodb/teste/app-contra-porteiro.mjs )

passo "backup, estrago e restauração"
( cd "$PACOTE" && COMPOSE_PROJECT_NAME=$P ENV_FILE="$ENVF" scripts/backup.sh )
IDS=$(curl -s "$TELA/api/v2/tables/$TID/records?limit=3" -H "xc-token: $TOKEN" | json 'json.dumps([{"Id":r["Id"]} for r in d["list"]])')
curl -s -o /dev/null -X DELETE $TELA/api/v2/tables/$TID/records -H "xc-token: $TOKEN" -H 'content-type: application/json' -d "$IDS"
copia --conferir >/dev/null 2>&1 && falha "estrago não apareceu"
( cd "$PACOTE" && COMPOSE_PROJECT_NAME=$P ENV_FILE="$ENVF" scripts/restore.sh "$(ls -t backups/cardapio-db-*.dump | head -1)" 2>&1 | grep -v Container )
espera; copia --conferir | tail -1

if [[ " $* " == *" --carga "* ]]; then
  passo "carga pelo porteiro"
  for c in "20 30" "45 20" "80 10"; do set -- $c
    URL=$PORTEIRO TOKEN=$TOKEN BASE=$DESTINO RPS=$1 SEGUNDOS=$2 node "$AQUI/carga.mjs"; done
  docker stats --no-stream --format '{{.Name}} CPU {{.CPUPerc}} memória {{.MemUsage}}' $P-nocodb-1 $P-db-1 $P-gateway-1
fi

passo "memória"
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' $P-nocodb-1 $P-db-1 $P-gateway-1
echo; echo "TUDO OK"
