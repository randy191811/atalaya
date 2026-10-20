// Prueba de conexión con el mercado real: lee una tienda, hace una búsqueda y pide las divisas.
// Devuelve pasos en lenguaje claro para el administrador.
import { config } from '../lib/config.js';
import { decrypt } from '../lib/secrets.js';
import { searchShop, searchByName, exchangeRate } from './trade2.js';
import { MarketError, isBlocked, queueStatus } from './queue.js';

const why = (e) => {
  if (!(e instanceof MarketError)) return 'Error inesperado: ' + (e && e.message ? e.message : 'desconocido');
  if (e.kind === 'rate_limited') return 'El mercado pidió esperar (límite de peticiones). Vuelve a probar en unos minutos.';
  if (e.kind === 'blocked') return 'El mercado rechazó la petición (403). Puede que haya cambiado algo o que bloquee este servidor.';
  if (e.kind === 'network') return 'No se pudo conectar con pathofexile.com desde el servidor.';
  if (e.kind === 'disabled') return 'El mercado está apagado en la configuración (MARKET_ENABLED).';
  return e.message + (e.status === 400 ? ' Probablemente cambió el formato de la búsqueda o el nombre de la liga no existe.' : e.status === 404 ? ' La ruta ya no existe: hay que ajustar src/worker/trade2.js.' : '');
};

export async function runDiagnostic(shop) {
  const steps = [];
  const add = (name, ok, detail) => steps.push({ name, ok, detail });
  if (isBlocked()) {
    const q = queueStatus();
    add('Mercado disponible', false, `Ahora mismo está en pausa por límite hasta ${new Date(q.blockedUntil * 1000).toLocaleTimeString('es')}. Prueba después.`);
    return { steps, ok: false };
  }
  const league = shop ? shop.league : config.defaultLeague;
  if (shop) {
    try {
      const r = await searchShop(shop.poe_account, shop.league, decrypt(shop.poe_session_enc) || undefined);
      if (r.items.length) add(`Leer la tienda ${shop.poe_account} (${shop.league})`, true, `${r.items.length} objetos leídos de ${r.total} anuncios. Ejemplo: «${r.items[0].name}» a ${r.items[0].price_amount ?? '?'} ${r.items[0].price_currency ?? ''}.`);
      else add(`Leer la tienda ${shop.poe_account} (${shop.league})`, false, 'La búsqueda funcionó pero no devolvió objetos. Revisa el nombre de cuenta (con #número) y la liga, o añade el código de sesión en los ajustes de la tienda.');
    } catch (e) {
      add(`Leer la tienda ${shop.poe_account} (${shop.league})`, false, why(e));
    }
  } else {
    add('Leer una tienda', false, 'Añade primero tu tienda en la pestaña Tienda para poder probarla.');
  }
  try {
    const r = await searchByName('Headhunter', league, 3);
    add(`Buscar un objeto (Headhunter en ${league})`, true, r.items.length ? `${r.total} anuncios; el más barato pide ${r.items[0].price_amount} ${r.items[0].price_currency}.` : 'La búsqueda funcionó pero sin resultados (puede ser normal si nadie lo vende en esta liga).');
  } catch (e) {
    add(`Buscar un objeto en ${league}`, false, why(e));
  }
  for (const [label, id] of [['divine', config.currencyIds.divine], ['chaos', config.currencyIds.chaos]]) {
    try {
      const r = await exchangeRate(config.currencyIds.exalted, id, league);
      add(`Tasa de ${label}`, r > 0, r > 0 ? `1 ${label} ≈ ${(Math.round(r * 10) / 10).toLocaleString('es')} exalted.` : `El mercado respondió pero no pude leer la tasa. Revisa el código de moneda (${id}) o el formato del cambio de divisas en src/worker/trade2.js.`);
    } catch (e) {
      add(`Tasa de ${label}`, false, why(e));
    }
  }
  return { steps, ok: steps.every((s) => s.ok) };
}
