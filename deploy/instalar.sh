#!/usr/bin/env bash
# Instala Atalaya en ESTE servidor (Linux con systemd). Ejecutar como root, desde la carpeta del proyecto.
# No toca nada más: crea un usuario propio, copia los archivos a /opt/atalaya y deja el servicio listo.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Ejecuta con sudo o como root."; exit 1; }
command -v node >/dev/null || { echo "Falta Node.js 22.13 o superior."; exit 1; }
NODE_OK=$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);console.log(a>22||(a===22&&b>=13)?"ok":"no")')
[ "$NODE_OK" = ok ] || { echo "Tu Node es $(node -v). Se necesita 22.13 o superior."; exit 1; }
HERE="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/atalaya

id atalaya >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin atalaya
mkdir -p "$APP"
cp -r "$HERE/src" "$HERE/client" "$HERE/db" "$HERE/scripts" "$HERE/deploy" "$HERE/package.json" "$APP/"
bash "$HERE/scripts/descargar-fuentes.sh" "$APP/client/fonts" || echo "(Sin fuentes: se usará la de respaldo)"
chown -R root:atalaya "$APP"; chmod -R go-w "$APP"

if [ ! -f /etc/atalaya.env ]; then
  cp "$HERE/.env.example" /etc/atalaya.env
  chmod 600 /etc/atalaya.env; chown root:root /etc/atalaya.env
  echo ">> Creé /etc/atalaya.env. EDÍTALO (dominio y correo) antes de arrancar."
fi
cp "$HERE/deploy/atalaya.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable atalaya >/dev/null
echo
echo "Listo. Siguientes pasos:"
echo "  1) nano /etc/atalaya.env      (pon tu dominio y tu correo)"
echo "  2) systemctl restart atalaya"
echo "  3) curl -s http://127.0.0.1:3000/api/health   (debe decir ok:true)"
echo "  4) Añade el bloque de deploy/Caddyfile.ejemplo a tu Caddy y recárgalo."
