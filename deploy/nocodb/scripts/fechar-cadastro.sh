#!/usr/bin/env bash
# Liga "cadastro só por convite" no NocoDB. Nesta versão a opção não aparece na tela e a variável NC_INVITE_ONLY_SIGNUP
# não vale (testado em 16/10); a API aceita. Pela internet o cadastro já é barrado pelo porteiro: isto fecha também
# pelo túnel. Roda no Mac, com o túnel aberto (README.md). Pede o e-mail e a senha do administrador; a senha não
# aparece na tela nem fica no histórico.
#   deploy/nocodb/scripts/fechar-cadastro.sh [http://127.0.0.1:18080]
set -euo pipefail
TELA="${1:-http://127.0.0.1:18080}"
read -rp "E-mail do administrador do NocoDB: " EMAIL
read -rsp "Senha (não aparece): " SENHA; echo
export EMAIL SENHA
JWT="$(python3 -c 'import json,os; print(json.dumps({"email": os.environ["EMAIL"], "password": os.environ["SENHA"]}))' \
  | curl -s -X POST "$TELA/api/v1/auth/user/signin" -H 'content-type: application/json' --data-binary @- \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token", ""))')"
unset SENHA
[ -n "$JWT" ] || { echo "login recusado: confira o e-mail, a senha e o túnel"; exit 1; }
# a sessão vai para o curl por arquivo, não pela linha de comando (que aparece no ps)
H="$(mktemp)"; trap 'rm -f "$H"' EXIT; printf 'xc-auth: %s\n' "$JWT" > "$H"; unset JWT
curl -s -o /dev/null -X POST "$TELA/api/v1/app-settings" -H "@$H" -H 'content-type: application/json' \
  -d '{"invite_only_signup":true}'
estado="$(curl -s "$TELA/api/v1/app-settings" -H "@$H" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("invite_only_signup"))')"
[ "$estado" = True ] && echo "ok: cadastro só por convite ligado" || { echo "não ligou (resposta: $estado)"; exit 1; }
