#!/usr/bin/env bash
# Vuelve a la app antigua: apaga Atalaya (sin borrar sus datos), restaura la config de Caddy y reactiva los servicios antiguos.
# Uso: bash /opt/atalaya/deploy/volver-al-antiguo.sh /root/respaldo-poe2-notifier-FECHA
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Ejecuta como root."; exit 1; }
BK="${1:-}"
[ -d "$BK" ] || { echo "Dime la carpeta de respaldo. Las que hay:"; ls -d /root/respaldo-poe2-notifier-* 2>/dev/null; exit 1; }
systemctl stop atalaya 2>/dev/null || true
systemctl disable atalaya 2>/dev/null || true
if [ -d "$BK/caddy" ]; then cp -a "$BK/caddy/." /etc/caddy/; systemctl reload caddy || systemctl restart caddy; echo "Caddy restaurado."; fi
for u in $(cat "$BK/servicios-antiguos.txt" 2>/dev/null); do
  systemctl enable "$u" 2>/dev/null || true
  systemctl start "$u" && echo "Reactivado: $u"
done
if [ -f "$BK/pm2.json" ] && command -v pm2 >/dev/null; then pm2 resurrect >/dev/null 2>&1 || pm2 start all >/dev/null 2>&1 || true; fi
echo "Listo. La app antigua vuelve a estar activa. Los datos de Atalaya siguen en /var/lib/atalaya por si quieres volver."
