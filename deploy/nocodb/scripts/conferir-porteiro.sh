#!/usr/bin/env bash
# Confere o porteiro (Caddyfile) pelo endereço público: o que o app usa passa; tela, login, cadastro e mudanças de
# estrutura ficam barrados. Não grava nada: as escritas vão para uma tabela que não existe e o NocoDB recusa.
# "barrado" = 404 sem corpo, que só o Caddy responde; "passa" = a resposta veio do NocoDB.
#   read -rs TOKEN; export TOKEN    (cole o token e Enter: não aparece nem vai para o histórico)
#   scripts/conferir-porteiro.sh https://cardapio-db.6dtywz.easypanel.host <base-id>
# (sem TOKEN, confere só o que tem de ser barrado). O token vai para o curl por arquivo, não pela linha de comando.
set -uo pipefail
URL="${1:?uso: TOKEN=... scripts/conferir-porteiro.sh <url> <base-id>}"
BASE="${2:?uso: TOKEN=... scripts/conferir-porteiro.sh <url> <base-id>}"
TOKEN="${TOKEN:-}"
falhas=0
HCOM="$(mktemp)"; HJWT="$(mktemp)"; trap 'rm -f "$HCOM" "$HJWT"' EXIT
printf 'xc-token: %s\n' "$TOKEN" > "$HCOM"
# um JWT qualquer junto com token vazio: o porteiro tem de descartar o xc-auth, e aí o NocoDB recusa (401)
printf 'xc-token;\nxc-auth: eyJhbGciOiJIUzI1NiJ9.e30.invalido\n' > "$HJWT"   # "xc-token;" = cabeçalho vazio no curl

# método, caminho, "com"/"sem" token, esperado (passa|barra)
confere() {
  local metodo="$1" caminho="$2" token="$3" esperado="$4" corpo status h=()
  [ "$token" = com ] && h=(-H "@$HCOM")
  corpo="$(mktemp)"
  # ${h[@]+...}: o bash 3 do macOS acusa lista vazia com set -u
  status="$(curl -s --path-as-is -o "$corpo" -w '%{http_code}' -X "$metodo" ${h[@]+"${h[@]}"} -H 'content-type: application/json' \
    --data-binary '[]' -m 15 "$URL$caminho")"
  local obtido=passa
  [ "$status" = 404 ] && [ ! -s "$corpo" ] && obtido=barra
  [ -z "$status" ] || [ "$status" = 000 ] && obtido="sem-resposta"
  rm -f "$corpo"
  if [ "$obtido" = "$esperado" ]; then printf 'ok    %-6s %-58s %s (%s)\n' "$metodo" "$caminho" "$obtido" "$status"
  else printf 'FALHA %-6s %-58s %s, esperado %s (%s)\n' "$metodo" "$caminho" "$obtido" "$esperado" "$status"; falhas=$((falhas + 1)); fi
}

FALSA=mzzzzzzzzzzzzzz        # tabela que não existe: a escrita chega ao NocoDB e ele recusa
BASE_FALSA=pzzzzzzzzzzzzzz   # base que não existe: nunca mandar pedido destrutivo para a base real

# tem de ser barrado, com ou sem token
for t in sem com; do
  [ "$t" = com ] && [ -z "$TOKEN" ] && continue
  confere GET    /                                         $t barra
  confere GET    /dashboard/                               $t barra
  confere POST   /api/v1/auth/user/signup                  $t barra
  confere POST   /api/v1/auth/user/signin                  $t barra
  confere GET    /api/v1/auth/user/me                      $t barra
  confere GET    /api/v1/tokens                            $t barra
  confere GET    /api/v2/meta/bases/                       $t barra
  confere POST   "/api/v2/meta/bases/$BASE_FALSA/tables"   $t barra
  confere GET    "/api/v2/meta/bases/$BASE_FALSA/swagger.json" $t barra
  confere GET    "/api/v2/meta/tables/$FALSA"              $t barra
  confere POST   "/api/v2/meta/tables/$FALSA/columns"      $t barra
  confere DELETE "/api/v2/meta/bases/$BASE_FALSA"          $t barra
  confere GET    "/api/v2/tables/$FALSA/records/1"         $t barra
  confere PUT    "/api/v2/tables/$FALSA/records"           $t barra
  confere GET    "/api/v2/tables/$FALSA/records/..%2F..%2F..%2Fmeta%2Fbases%2F" $t barra
  confere GET    /api/v1/health                            $t barra
done
# sem token, nem a API de dados passa
confere GET "/api/v2/meta/bases/$BASE/tables" sem barra
confere GET "/api/v2/tables/$FALSA/records"   sem barra
# a saúde é pública e só diz "ok"; nada abaixo dela passa
confere GET /saude sem passa
if [ "$(curl -s -m 15 "$URL/saude")" = ok ]; then echo "ok    GET    /saude responde só \"ok\""
else echo "FALHA GET    /saude não responde só \"ok\""; falhas=$((falhas + 1)); fi
confere GET  /saude/api/v1/health        sem barra
confere POST /saude/api/v1/auth/user/signup sem barra
confere GET  "/saude/../api/v1/tokens"   sem barra

# token vazio + JWT de sessão: o porteiro descarta o xc-auth e o NocoDB tem de recusar. Aqui o JWT é falso, então só
# prova que não passa; a prova com um JWT válido está no teste local (teste/teste-local.sh).
s="$(curl -s -o /dev/null -w '%{http_code}' -H "@$HJWT" -m 15 "$URL/api/v2/meta/bases/$BASE/tables")"
if [ "$s" = 401 ] || [ "$s" = 404 ]; then echo "ok    GET    token vazio + xc-auth recusado ($s)"
else echo "FALHA GET    token vazio + xc-auth deu $s"; falhas=$((falhas + 1)); fi

# token que não tem cara de token não chega ao NocoDB (404 sem corpo do porteiro)
s="$(curl -s -o /dev/null -w '%{http_code}' -H 'xc-token: lixo' -m 15 "$URL/api/v2/tables/$FALSA/records")"
if [ "$s" = 404 ]; then echo "ok    GET    token lixo barrado no porteiro (404)"
else echo "FALHA GET    token lixo deu $s"; falhas=$((falhas + 1)); fi

if [ -n "$TOKEN" ]; then
  confere GET    "/api/v2/meta/bases/$BASE/tables"      com passa
  confere GET    "/api/v2/tables/$FALSA/records"        com passa
  confere GET    "/api/v2/tables/$FALSA/records/count"  com passa
  confere POST   "/api/v2/tables/$FALSA/records"        com passa
  confere PATCH  "/api/v2/tables/$FALSA/records"        com passa
  confere DELETE "/api/v2/tables/$FALSA/records"        com passa
fi

[ "$falhas" = 0 ] && echo "porteiro ok" || { echo "porteiro com $falhas falha(s)"; exit 1; }
