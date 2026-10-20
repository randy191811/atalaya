#!/usr/bin/env bash
# Descarga la fuente Chakra Petch (licencia libre SIL OFL) a client/fonts para servirla desde tu propio servidor.
# Si no hay internet, la página usa una fuente técnica de respaldo y sigue funcionando.
set -u
DEST="${1:-$(cd "$(dirname "$0")/.." && pwd)/client/fonts}"
mkdir -p "$DEST"
BASE="https://raw.githubusercontent.com/google/fonts/main/ofl/chakrapetch"
ok=0
for w in Medium SemiBold Bold; do
  if curl -fsSL -m 30 -o "$DEST/ChakraPetch-$w.ttf" "$BASE/ChakraPetch-$w.ttf"; then ok=$((ok+1)); else rm -f "$DEST/ChakraPetch-$w.ttf"; fi
done
curl -fsSL -m 30 -o "$DEST/OFL.txt" "$BASE/OFL.txt" || true
echo "Fuentes descargadas: $ok de 3 en $DEST"
