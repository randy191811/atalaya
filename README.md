# Atalaya

Página para vendedores de Path of Exile 2: vigila tu tienda del mercado oficial, te avisa en el móvil cuando vendes algo y tasa tus objetos con IA apoyándose en anuncios reales. Con cuentas y créditos mensuales para el tasador. **Por ahora es gratis para todos**: 1 tienda revisada cada 10 minutos, 30 créditos al mes y 25 deseos (se cambia en `/etc/atalaya.env` con `FREE_SHOPS`, `FREE_INTERVAL_MIN`, `FREE_CREDITS` y `FREE_WISHES`).

Sin paquetes externos: solo necesita **Node 22.13 o superior**.

## Qué hay dentro

| Sección | Qué hace |
|---|---|
| **Portada** (`/`) | Explica el producto con un ejemplo de tasación, planes, preguntas y aviso de no afiliación. |
| **Tienda** | Tus objetos como casillas de alijo (color por rareza, icono por tipo si el del juego no carga), el valor total en divine, gráfico de 30 días, estado de la lectura y «Revisar ahora». Se actualiza sola cada minuto. **Revisor de precios**: cada objeto se compara poco a poco con anuncios parecidos y se marca «caro», «en precio» o «barato», con precio de mercado copiable (`~price`). Guía de primeros pasos. |
| **Ventas** | Gráfico de ganancias por día (30 días), libro de ventas por día, totales de 7 y 30 días, mejor venta, tiempo medio hasta vender y filtro por tienda. |
| **Tasador** | Pegas el objeto (Ctrl+C en el juego) o subes una captura. El servidor busca anuncios parecidos en el mercado y la IA propone precio, venta rápida, rango, confianza y razones. Incluye la nota `~price` lista para copiar. |
| **Mercado** | Exalted por divine y por chaos, con gráfico de 7 días. |
| **Deseos** | «Avísame cuando X salga por menos de Y». |
| **Cuenta y plan** | Plan, créditos, fecha de recarga, movimientos, pagos simulados, cambiar o cancelar plan, avisos del móvil, contraseña. |
| **Administrar** | (solo admin) guardar la clave de la IA desde el navegador, **«Probar conexión con el mercado»** (lee tu tienda, busca un objeto y pide las divisas, y te dice en claro qué falla), usuarios, invitaciones. |

## Planes de pago (apagados por ahora)

Con `BILLING_MODE=mock` aparecen estos planes con cobro **simulado** (aviso MODO DEMO). La sección de precios de la portada está guardada en `docs/seccion-planes-de-pago.html`.


| Plan | Precio | Tiendas | Revisión | Créditos/mes | Deseos |
|---|---|---|---|---|---|
| Gratis | $0 | 1 | cada 30 min | 5 | 5 |
| Pro | $5/mes | 1 | cada 10 min | 100 | 25 |
| Mercader | $12/mes | 3 | cada 5 min | 400 | 60 |

1 crédito = una tasación por texto. Una captura cuesta 2 (la IA primero lee la imagen). Los créditos se recargan cada mes y no se acumulan. Al bajar de plan, las tiendas de más quedan en pausa (no se borran).

**Coste de la IA por tasación (Claude Haiku 4.5, aprox.):** texto ≈ $0,005; captura ≈ $0,01. En el peor caso, un Mercader que gasta sus 400 créditos cuesta unos $2–4 de IA sobre $12; un Pro, menos de $1 sobre $5.

## Instalar en tu servidor

Necesitas Linux con systemd, Node 22.13+ y (recomendado) Caddy para el candado https.

1. Copia esta carpeta al servidor.
2. `sudo bash deploy/instalar.sh` (también descarga la fuente futurista Chakra Petch a `client/fonts`; si tu servidor no tiene internet en ese momento, la página usa una fuente de respaldo y puedes repetirlo luego con `sudo bash scripts/descargar-fuentes.sh /opt/atalaya/client/fonts`).
3. `sudo nano /etc/atalaya.env` → pon tu **dominio**, tu **correo de contacto** y la **liga actual**.
4. `sudo systemctl restart atalaya` y comprueba `curl -s http://127.0.0.1:3000/api/health` (debe decir `"ok":true`).
5. Pega el bloque de `deploy/Caddyfile.ejemplo` en tu Caddy (cambiando el dominio) y recárgalo.
6. Abre tu dominio y **regístrate el primero**: esa cuenta queda como administradora.
7. Añade tu tienda y ve a **Administrar → Probar conexión con el mercado**: es la forma rápida de confirmar que el mercado real responde como se espera.
8. En **Administrar → Clave de la IA** y pega tu clave de Anthropic (`sk-ant-…`). Se comprueba al momento y se guarda cifrada. Opcional: una de Google Gemini como respaldo.
9. Cambia `contacto@TU-DOMINIO` por tu correo real en `client/privacidad.html` y `client/terminos.html`.

Los datos (cuentas, créditos, claves cifradas) viven en `/var/lib/atalaya`, **fuera** de la carpeta que se sirve. Actualizar la página no los toca. Haz copia de esa carpeta.

## Cuenta de prueba

En el servidor:

```
cd /opt/atalaya
sudo -u atalaya env $(sudo cat /etc/atalaya.env | xargs) DATA_DIR=/var/lib/atalaya node --disable-warning=ExperimentalWarning scripts/crear-cuenta-prueba.js
```

Te da `prueba@ejemplo.com` y una contraseña. Recorrido para comprobarlo todo:

1. Entra → Tienda → escribe una cuenta de PoE y liga → verás los objetos tras la primera lectura.
2. Tasador → pega un objeto → baja 1 crédito.
3. Gasta los 5 créditos → aparece la ventana «Necesitas más».
4. Elige Pro → «Simular pago» → tienes 100 créditos.
5. Cuenta y plan → movimientos y pago simulado → «Cancelar y volver a Gratis».

## Seguridad

- La clave de la IA solo vive en el servidor, cifrada (AES-256-GCM). Nunca va al navegador; la pantalla de administración solo muestra sus 4 últimos caracteres.
- Los créditos se reservan en el servidor **antes** de llamar a la IA y se devuelven si falla. El contador del navegador es solo informativo.
- Contraseñas con scrypt; sesión con cookie `httpOnly` firmada; límite de intentos; política de seguridad estricta (sin scripts ni estilos en línea).
- El código de sesión de PoE (POESESSID) es opcional, se guarda cifrado, nunca vuelve al navegador y solo viaja al mercado oficial para leer tu propia tienda.
- Las capturas no se guardan: se leen y se descartan.
- No existe ningún campo para datos de tarjeta. El pago real, cuando llegue, se hará en la página de la plataforma de pago.

## Cómo respeta al mercado oficial

Una sola cola, una petición a la vez, con la pausa que piden sus cabeceras de ritmo. Ante un «espera» (429) se detiene lo que pidan y conserva los últimos datos (nunca enseña ceros falsos). Una venta solo se confirma si el objeto falta en dos lecturas seguidas; un cambio de precio no es venta; un vaciado repentino de la tienda no se cree a la primera.

## Pruebas

`npm test` arranca un mercado y una IA **falsos** en local y comprueba 112 cosas: cuentas, clave de la IA, tasador por texto y por captura, respaldo de Gemini, devolución de créditos, bloqueo sin créditos, pago simulado, renovación, cancelación, tiendas, ventas en dos pasos, cambio de precio, varias tiendas, límite del mercado, divisas, deseos que los datos sobreviven a un reinicio y el modo gratis.

## Lo que falta comprobar en el servidor real

1. **El mercado real.** Desde mi entorno no llego a pathofexile.com. Rutas, formato y códigos de moneda salen del dossier anterior. Si algo no cuadra, el ajuste está en `src/worker/trade2.js`.
2. **La IA real.** Las pruebas usan una IA falsa con la forma exacta de las respuestas de Anthropic y Gemini. La calidad de las tasaciones hay que juzgarla con objetos tuyos.
3. **Avisos en dispositivos reales** (en iPhone, solo con la página añadida a la pantalla de inicio).
4. **Revisar cada 5 minutos con muchos usuarios** puede chocar con los límites del mercado. La cola se adapta sola, pero si hay cientos de tiendas el ritmo real será más lento que el prometido.

## Antes de cobrar de verdad

- **Riesgo con Grinding Gear Games.** Su página para desarrolladores (pathofexile.com/developer/docs) dice que, por regla general, no permiten usar su propiedad intelectual para generar ingresos comerciales, y que el acceso se limita a su API oficial (el mercado de comercio no forma parte de ella). Atalaya lee la web de comercio, como muchas herramientas de la comunidad, pero cobrar por ello aumenta el riesgo de que bloqueen el acceso. Antes de cobrar de verdad, escríbeles para preguntar. Si dicen que no, la salida más segura es dejarla gratis o con donaciones.
- Para la pasarela: dime en qué país vives y si cobras como persona o como empresa, y te recomiendo la adecuada y te guío paso a paso.
