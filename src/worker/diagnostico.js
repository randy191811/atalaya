// Prueba de conexión con el mercado real: mira las ligas, lee una tienda, hace una búsqueda
// y pide las divisas. Devuelve pasos en lenguaje claro para el administrador.
import { config } from '../lib/config.js';
import { decrypt } from '../lib/secrets.js';
import { searchShop, searchByName, exchangeRate, listLeagues, currentLeague } from './trade2.js';
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

  // 1) Ligas: confirma que el servidor habla con el mercado y que la liga de la tienda existe.
  let leagues = [];
  try {
    leagues = await listLeagues();
    const seasonal = await currentLeague();
    const known = leagues.some((l) => l.toLowerCase() === String(league).toLowerCase());
    add('Leer las ligas del juego', leagues.length > 0,
      leagues.length
        ? `${leagues.length} ligas. La de temporada es «${seasonal}». ${known ? `Tu liga «${league}» existe.` : `OJO: «${league}» no está en la lista; corrígela en los ajustes de la tienda.`}`
        : 'El mercado no devolvió ninguna liga.');
  } catch (e) {
    add('Leer las ligas del juego', false, why(e));
  }

  // 2) La tienda del usuario. Guardamos un objeto real para la búsqueda del paso 3.
  let sample = null;
  if (shop) {
    try {
      const r = await searchShop(shop.poe_account, shop.league, decrypt(shop.poe_session_enc) || undefined);
      if (r.items.length) {
        sample = r.items[0];
        const conMods = r.items.filter((i) => i.stats && i.stats.length).length;
        add(`Leer la tienda ${shop.poe_account} (${shop.league})`, true,
          `${r.items.length} objetos leídos de ${r.total} anuncios; ${conMods} con modificadores. Ejemplo: «${sample.name}» a ${sample.price_amount ?? '?'} ${sample.price_currency ?? ''}.`);
      } else {
        add(`Leer la tienda ${shop.poe_account} (${shop.league})`, false, 'La búsqueda funcionó pero no devolvió objetos. Revisa el nombre de cuenta (con #número) y la liga, o añade el código de sesión en los ajustes de la tienda.');
      }
    } catch (e) {
      add(`Leer la tienda ${shop.poe_account} (${shop.league})`, false, why(e));
    }
  } else {
    add('Leer una tienda', false, 'Añade primero tu tienda en la pestaña Tienda para poder probarla.');
  }

  // 3) Búsqueda por nombre. Se usa un objeto que SABEMOS que existe (uno de la tienda):
  // así el paso prueba de verdad el buscador en vez de un nombre inventado.
  const term = (sample && (sample.name || sample.base_type)) || 'Sapphire Ring';
  try {
    const r = await searchByName(term, league, 3);
    add(`Buscar «${term}» en ${league}`, r.items.length > 0,
      r.items.length
        ? `${r.total} anuncios (encontrado por ${r.matchedBy}); el más barato pide ${r.items[0].price_amount ?? '?'} ${r.items[0].price_currency ?? ''}.`
        : 'El buscador respondió pero sin resultados, ni por nombre ni por tipo. Si el objeto sí se vende en el juego, cambió el formato de la búsqueda.');
  } catch (e) {
    add(`Buscar «${term}» en ${league}`, false, why(e));
  }

  // 4) Divisas: sin esto, los precios en divine/chaos no se pueden comparar.
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
