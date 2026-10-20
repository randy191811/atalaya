#!/usr/bin/env bash
# Se ejecuta cada 5 minutos por cron. Si hay código nuevo en GitHub, lo instala y reinicia solo.
# No hace nada si no hay cambios (silencioso). Guarda su propio registro en /var/log/atalaya-auto.log
set -euo pipefail
REPO=/root/atalaya-repo
LOG=/var/log/atalaya-auto.log
exec >> "$LOG" 2>&1

cd "$REPO"
BEFORE="$(git rev-parse HEAD)"
git fetch --quiet origin main
git reset --quiet --hard origin/main
AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" != "$AFTER" ]; then
  echo "[$(date -Is)] Cambios detectados ($BEFORE -> $AFTER). Actualizando…"
  bash deploy/actualizar.sh
  echo "[$(date -Is)] Listo."
fi
