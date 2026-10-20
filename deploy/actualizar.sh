#!/usr/bin/env bash
# Actualiza el código de Atalaya ya instalado (no toca /etc/atalaya.env ni los datos en /var/lib/atalaya).
# Uso (como root, desde la carpeta del proyecto ya extraída con la versión nueva):
#   bash deploy/actualizar.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Ejecuta como root."; exit 1; }
HERE="$(cd "$(dirname "$0")/.." && pwd)"
bash "$HERE/deploy/instalar.sh"
systemctl restart atalaya
sleep 2
curl -fsS -m 10 http://127.0.0.1:3000/api/health && echo || { echo "No respondió. Revisa: journalctl -u atalaya -n 50"; exit 1; }
echo "Atalaya actualizada."
