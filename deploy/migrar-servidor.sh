#!/usr/bin/env bash
# Cambia la app antigua (poe2-notifier) por Atalaya en ESTE servidor, sin borrar nada:
#   1) guarda una copia con fecha de la app antigua, su base de datos, su servicio y la config de Caddy
#   2) apaga la app antigua (no la borra)
#   3) instala Atalaya en /opt/atalaya con sus datos en /var/lib/atalaya
#   4) apunta Caddy al nuevo servicio y comprueba que responde por https
# Si algo falla en el paso 4, deja Caddy como estaba. Para volver atrás del todo: deploy/volver-al-antiguo.sh
#
# Uso (como root, desde la carpeta de Atalaya):
#   ADMIN_EMAIL=tu@correo.com bash deploy/migrar-servidor.sh
# Opcionales: DOMAIN (por defecto 2-29-45-213.sslip.io), PORT (por defecto 3000), LEAGUE, CONTACT
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Ejecuta como root."; exit 1; }
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="${DOMAIN:-2-29-45-213.sslip.io}"
PORT="${PORT:-3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
CONTACT="${CONTACT:-$ADMIN_EMAIL}"
LEAGUE="${LEAGUE:-Standard}"
OLD_APP=/opt/poe2-notifier
OLD_DATA=/var/lib/poe2-notifier
TS="$(date +%Y%m%d-%H%M%S)"
BK="/root/respaldo-poe2-notifier-$TS"

paso() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }
ok() { printf '   \033[32m✔\033[0m %s\n' "$*"; }
aviso() { printf '   \033[33m!\033[0m %s\n' "$*"; }

[ -n "$ADMIN_EMAIL" ] || { echo "Falta ADMIN_EMAIL. Ejemplo: ADMIN_EMAIL=tu@correo.com bash deploy/migrar-servidor.sh"; exit 1; }

paso "0. Comprobaciones"
command -v node >/dev/null || { echo "No hay Node.js instalado."; exit 1; }
NODE_OK=$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);console.log(a>22||(a===22&&b>=13)?"ok":"no")')
if [ "$NODE_OK" != ok ]; then
  echo "Tu Node es $(node -v) y Atalaya necesita 22.13 o superior."
  echo "Actualízalo y vuelve a lanzar este script. Por ejemplo, en Ubuntu/Debian:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs"
  exit 1
fi
ok "Node $(node -v)"
command -v caddy >/dev/null && ok "Caddy encontrado" || aviso "No encuentro Caddy: instalaré Atalaya pero tendrás que configurar el https a mano."
if command -v ss >/dev/null && ss -ltn "( sport = :$PORT )" | grep -q ":$PORT"; then
  OWNER=$(ss -ltnp "( sport = :$PORT )" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)
  OWNER_CWD=$(readlink "/proc/${OWNER:-0}/cwd" 2>/dev/null || true)
  if [ "$OWNER_CWD" != "$OLD_APP" ] && [ -n "$OWNER_CWD" ] && [ "$OWNER_CWD" != /opt/atalaya ]; then
    echo "El puerto $PORT lo usa otro programa ($OWNER_CWD). Elige otro: PORT=3100 ADMIN_EMAIL=... bash $0"; exit 1
  fi
fi

paso "1. Copia de seguridad de la app antigua en $BK"
mkdir -p "$BK"
OLD_UNITS=$(systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk '{print $1}' | grep -Ei 'poe2|notifier' | grep -v '^atalaya' || true)
# También servicios cuyo WorkingDirectory o ExecStart apunten a la carpeta antigua
for f in /etc/systemd/system/*.service; do
  [ -f "$f" ] || continue
  if grep -q "$OLD_APP" "$f"; then OLD_UNITS="$OLD_UNITS $(basename "$f")"; fi
done
OLD_UNITS=$(echo "$OLD_UNITS" | tr ' ' '\n' | sort -u | grep -v '^$' || true)
echo "$OLD_UNITS" > "$BK/servicios-antiguos.txt"
[ -n "$OLD_UNITS" ] && ok "Servicios antiguos: $(echo $OLD_UNITS)" || aviso "No encontré servicios systemd de la app antigua."
for u in $OLD_UNITS; do
  [ -f "/etc/systemd/system/$u" ] && cp -a "/etc/systemd/system/$u" "$BK/"
done
if command -v pm2 >/dev/null; then pm2 jlist > "$BK/pm2.json" 2>/dev/null || true; fi
[ -d /etc/caddy ] && cp -a /etc/caddy "$BK/caddy" && ok "Config de Caddy guardada"
for f in /etc/poe2-notifier.env /etc/poe2-notifier /opt/poe2-notifier/.env; do [ -e "$f" ] && cp -a "$f" "$BK/" || true; done
# Base de datos: copia consistente aunque esté en uso
if [ -f "$OLD_DATA/app.db" ]; then
  if command -v sqlite3 >/dev/null; then
    sqlite3 "$OLD_DATA/app.db" ".backup '$BK/app.db'" && ok "Base de datos copiada (sqlite3 .backup)"
  else
    node --disable-warning=ExperimentalWarning -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec(\"VACUUM INTO '\"+process.argv[2]+\"'\")" "$OLD_DATA/app.db" "$BK/app.db" \
      && ok "Base de datos copiada (VACUUM INTO)"
  fi
  cp -a "$OLD_DATA" "$BK/datos-completos" 2>/dev/null || true
else
  aviso "No encontré $OLD_DATA/app.db"
fi
if [ -d "$OLD_APP" ]; then
  tar --exclude='node_modules' -czf "$BK/app-antigua.tgz" -C "$(dirname "$OLD_APP")" "$(basename "$OLD_APP")" && ok "Código antiguo guardado (sin node_modules)"
fi
chmod -R go-rwx "$BK"
ok "Copia lista en $BK"

paso "2. Apagar la app antigua (sin borrarla)"
for u in $OLD_UNITS; do
  systemctl stop "$u" 2>/dev/null || true
  systemctl disable "$u" 2>/dev/null || true
  ok "Detenido y desactivado: $u"
done
if command -v pm2 >/dev/null && pm2 jlist 2>/dev/null | grep -q "$OLD_APP"; then
  pm2 stop all >/dev/null 2>&1 || true; pm2 save >/dev/null 2>&1 || true; ok "Procesos de pm2 detenidos"
fi
sleep 1

paso "3. Instalar Atalaya"
bash "$HERE/deploy/instalar.sh" >/dev/null
ok "Archivos en /opt/atalaya"
ADMIN_PASS="$(node -e 'console.log(require("crypto").randomBytes(9).toString("base64url"))')"
cat > /etc/atalaya.env <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=$PORT
PUBLIC_ORIGIN=https://$DOMAIN
MARKET_CONTACT=$CONTACT
DEFAULT_LEAGUE=$LEAGUE
SIGNUP_MODE=open
MAX_USERS=1000
ADMIN_NAME=Randy
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASS
FREE_SHOPS=1
FREE_INTERVAL_MIN=10
FREE_CREDITS=30
FREE_WISHES=25
AI_PER_USER_MIN=6
AI_GLOBAL_DAY=1500
EOF
chmod 600 /etc/atalaya.env
systemctl restart atalaya
for i in $(seq 1 20); do curl -fsS -m 5 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS -m 5 "http://127.0.0.1:$PORT/api/health" >/dev/null && ok "Atalaya responde en el puerto $PORT" || { echo "Atalaya no arrancó. Mira: journalctl -u atalaya -n 50"; exit 1; }
# La contraseña ya creó la cuenta: se quita del archivo para que no quede escrita.
sed -i '/^ADMIN_PASSWORD=/d' /etc/atalaya.env

paso "4. Caddy (https)"
if command -v caddy >/dev/null && [ -f /etc/caddy/Caddyfile ]; then
  cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.antes-de-atalaya-$TS"
  SITES=$(grep -cE '^[^#[:space:]].*\{[[:space:]]*$' /etc/caddy/Caddyfile || true)
  if [ "${SITES:-0}" -le 1 ]; then
    cat > /etc/caddy/Caddyfile <<EOF
# Atalaya ($TS). La configuración anterior está en /etc/caddy/Caddyfile.antes-de-atalaya-$TS
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
	header {
		Strict-Transport-Security "max-age=31536000"
	}
}
EOF
    if caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 && systemctl reload caddy; then
      ok "Caddy apunta a Atalaya"
    else
      cp -a "/etc/caddy/Caddyfile.antes-de-atalaya-$TS" /etc/caddy/Caddyfile; systemctl reload caddy || true
      aviso "La config nueva de Caddy no validó; dejé la anterior. Revisa deploy/Caddyfile.ejemplo."
    fi
  else
    aviso "Tu Caddyfile tiene varios sitios; no lo toco. Cambia el bloque de $DOMAIN para que diga: reverse_proxy 127.0.0.1:$PORT  y luego: systemctl reload caddy"
  fi
fi

paso "5. Comprobación final"
sleep 2
if curl -fsS -m 15 "https://$DOMAIN/api/health" | grep -q '"ok":true'; then ok "https://$DOMAIN responde con Atalaya"; else aviso "https://$DOMAIN todavía no responde con Atalaya. Prueba en un minuto: curl -s https://$DOMAIN/api/health"; fi
FONTS=$( (ls /opt/atalaya/client/fonts/*.ttf 2>/dev/null || true) | wc -l)
[ "$FONTS" -ge 1 ] && ok "Fuente futurista instalada" || aviso "No se descargó la fuente; la página usa la de respaldo."

cat <<EOF

=====================================================================
 ATALAYA INSTALADA
   Página:      https://$DOMAIN
   Admin:       $ADMIN_EMAIL
   Contraseña:  $ADMIN_PASS      <- apúntala y cámbiala en «Cuenta y plan»
 Siguientes pasos en la página:
   1. Entra con esa cuenta.
   2. Tienda: añade tu cuenta de Path of Exile y la liga.
   3. Administrar: «Probar conexión con el mercado».
   4. Administrar: pega tu clave de Anthropic.
 La app antigua está APAGADA, no borrada. Copia en: $BK
 Para volver a la antigua:  bash /opt/atalaya/deploy/volver-al-antiguo.sh $BK
=====================================================================
EOF
