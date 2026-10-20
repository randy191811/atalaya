#!/usr/bin/env bash
# Deja un Ubuntu 24.04 recién creado listo para Atalaya: instala Node 22, Caddy,
# y luego corre deploy/migrar-servidor.sh (que, al no encontrar la app vieja,
# simplemente avisa y sigue con la instalación normal).
# Uso (como root, desde la carpeta del proyecto ya extraída):
#   ADMIN_EMAIL=tu@correo.com bash deploy/bootstrap-nuevo.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Ejecuta como root."; exit 1; }
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
[ -n "$ADMIN_EMAIL" ] || { echo "Falta ADMIN_EMAIL."; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -y

if ! command -v node >/dev/null || [ "$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);console.log(a>22||(a===22&&b>=13)?"ok":"no")' 2>/dev/null)" != ok ]; then
  echo "== Instalando Node.js 22 =="
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  echo "== Instalando Caddy =="
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y
  apt-get install -y caddy
fi

command -v sqlite3 >/dev/null || apt-get install -y sqlite3 || true

echo "== Lanzando la instalación de Atalaya =="
ADMIN_EMAIL="$ADMIN_EMAIL" bash "$HERE/deploy/migrar-servidor.sh"
