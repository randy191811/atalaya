// Cliente del mercado oficial (trade2). Solo lectura. Todo pasa por la cola serial.
import crypto from 'node:crypto';
import { config } from '../lib/config.js';
import { request } from './queue.js';

const league = (l) => encodeURIComponent(l || config.defaultLeague);

// Cada mod puede llegar como texto plano ("+30 to maximum Mana") o, según el objeto,
// como {name:...} / {text:...}. Siempre lo pasamos a texto legible.
function modText(m) {
  if (typeof m === 'string') return m.trim() || null;
  if (typeof m === 'number') return String(m);
  if (m && typeof m === 'object') return String(m.name || m.text || m.mod || m.display || m.value || '').trim() || null;
  return null;
}

// Orden en que el juego muestra los modificadores. Después se barre cualquier otra
// lista que acabe en "Mods" (así, si el mercado añade un tipo nuevo, igual se lee).
const MOD_ORDER = [
  'enchantMods', 'scourgeMods', 'implicitMods', 'runeMods', 'fracturedMods',
  'explicitMods', 'craftedMods', 'desecratedMods', 'veiledMods', 'crucibleMods',
  'logbookMods', 'utilityMods', 'notableProperties',
];

// "Monster Level: 79", "Quality: +20%"… el formato de propiedades del mercado es
// { name, values: [[valor, tipo]] }.
function propText(p) {
  if (!p || typeof p !== 'object') return null;
  const name = String(p.name || '').trim();
  const vals = Array.isArray(p.values) ? p.values.map((v) => (Array.isArray(v) ? v[0] : v)).filter((v) => v != null && v !== '') : [];
  if (!name && !vals.length) return null;
  if (!vals.length) return name || null;
  // Algunas propiedades traen el hueco %0 dentro del propio nombre.
  if (/%\d/.test(name)) return name.replace(/%(\d)/g, (_, i) => String(vals[Number(i)] ?? ''));
  return name ? `${name}: ${vals.join(', ')}` : vals.join(', ');
}

// Reúne TODO el texto del objeto, pase lo que pase con el nombre de los campos.
export function collectMods(it) {
  const out = [];
  const push = (v) => {
    const t = modText(v);
    if (t && !out.includes(t)) out.push(t);
  };

  for (const k of MOD_ORDER) if (Array.isArray(it[k])) it[k].forEach(push);
  for (const k of Object.keys(it)) {
    if (!MOD_ORDER.includes(k) && /Mods$/.test(k) && Array.isArray(it[k])) it[k].forEach(push);
  }

  // Habilidades que concede el objeto (muchos únicos las llevan).
  for (const k of ['grantedSkills', 'additionalProperties']) {
    if (Array.isArray(it[k])) it[k].forEach((p) => push(propText(p)));
  }

  // Si por el tipo de objeto no hubo ningún modificador (tabletas, monedas, gemas…),
  // se usa su propia descripción y sus propiedades para no dejar la ficha vacía.
  if (!out.length) {
    if (Array.isArray(it.properties)) it.properties.forEach((p) => push(propText(p)));
    for (const k of ['descrText', 'secDescrText']) if (typeof it[k] === 'string') push(it[k]);
    const ex = it.extended && it.extended.mods;
    if (ex && typeof ex === 'object') {
      for (const group of Object.values(ex)) if (Array.isArray(group)) group.forEach(push);
    }
  }
  return out;
}

export function normalizeEntry(entry) {
  if (!entry || !entry.item) return null;
  const it = entry.item;
  const l = entry.listing || {};
  const name = (it.name || it.typeLine || '').trim();
  const base = (it.baseType || it.typeLine || '').trim();
  const mods = collectMods(it);
  const fp = crypto.createHash('sha1').update([name, base, it.rarity || '', ...mods].join('|')).digest('hex').slice(0, 16);
  return {
    key: String(entry.id),
    name: name || base || 'Objeto',
    base_type: base,
    rarity: it.rarity || null,
    icon: typeof it.icon === 'string' && /^https:\/\//.test(it.icon) ? it.icon : null,
    item_level: Number(it.ilvl || it.itemLevel) || null,
    corrupted: it.corrupted ? 1 : 0,
    price_amount: l.price && isFinite(Number(l.price.amount)) ? Number(l.price.amount) : null,
    price_currency: l.price ? String(l.price.currency || '') : null,
    stash_tab: l.stash && l.stash.name ? String(l.stash.name) : null,
    stats: mods.slice(0, 16),
    fp,
  };
}

export async function fetchEntries(ids, queryId, cookie) {
  const out = [];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const data = await request('GET', `/fetch/${chunk.join(',')}?query=${encodeURIComponent(queryId)}`, { cookie });
    for (const e of (data && data.result) || []) {
      const n = normalizeEntry(e);
      if (n) out.push(n);
    }
  }
  return out;
}

// Muestra representativa: los más baratos (el suelo del precio) y luego un reparto
// parejo por todo el resto. Así la mediana refleja el mercado y no solo la basura barata.
export function spreadSample(ids, n) {
  if (ids.length <= n) return ids.slice();
  const head = Math.min(3, n);
  const out = ids.slice(0, head);
  const rest = n - head;
  const step = (ids.length - head) / rest;
  for (let i = 0; i < rest; i++) out.push(ids[head + Math.floor(i * step)]);
  return [...new Set(out)];
}

// Solo para depurar: trae 1 anuncio de la tienda SIN normalizar, tal cual lo manda el mercado.
export async function debugRawShopItem(account, leagueName, cookie) {
  const body = {
    query: { status: { option: 'any' }, filters: { trade_filters: { filters: { account: { input: account } } } } },
    sort: { price: 'asc' },
  };
  const s = await request('POST', `/search/${league(leagueName)}`, { body, cookie });
  const id = ((s && s.result) || [])[0];
  if (!id) return null;
  const data = await request('GET', `/fetch/${id}?query=${encodeURIComponent(s.id)}`, { cookie });
  return ((data && data.result) || [])[0] || null;
}

// Todos los anuncios de la tienda de una cuenta (hasta 100, el máximo que devuelve una búsqueda).
export async function searchShop(account, leagueName, cookie) {
  const body = {
    query: {
      status: { option: 'any' },
      filters: { trade_filters: { filters: { account: { input: account } } } },
    },
    sort: { price: 'asc' },
  };
  const s = await request('POST', `/search/${league(leagueName)}`, { body, cookie });
  const ids = ((s && s.result) || []).slice(0, 100);
  const items = ids.length ? await fetchEntries(ids, s.id, cookie) : [];
  return { items, total: Number(s && s.total) || ids.length, searchId: s && s.id };
}

// Busca un objeto por su nombre; si no hay nada, lo prueba como tipo base.
// (El mercado distingue "nombre" —únicos— de "tipo" —bases como «Sapphire Ring»—.)
export async function searchByName(name, leagueName, count = 10) {
  let lastErr = null;
  for (const q of [{ name, status: { option: 'online' } }, { type: name, status: { option: 'online' } }]) {
    let s;
    try {
      s = await request('POST', `/search/${league(leagueName)}`, { body: { query: q, sort: { price: 'asc' } } });
    } catch (e) {
      // Si el mercado está caído, en pausa o nos rechaza, se avisa tal cual: no se gasta
      // otra petición. Solo se reintenta como tipo cuando la consulta en sí no le gustó.
      if (e.kind !== 'http') throw e;
      lastErr = e;
      continue;
    }
    const all = ((s && s.result) || []).filter(Boolean);
    if (all.length) {
      const ids = all.slice(0, count);
      return { items: await fetchEntries(ids, s.id), total: Number(s && s.total) || all.length, searchId: s.id, matchedBy: q.name ? 'nombre' : 'tipo' };
    }
  }
  if (lastErr) throw lastErr;
  return { items: [], total: 0, searchId: null, matchedBy: null };
}

// Cambio de divisas: cuántas unidades de `have` se pagan por una de `want` (mediana de las primeras ofertas).
export async function exchangeRate(have, want, leagueName) {
  const body = { query: { status: { option: 'online' }, have: [have], want: [want] }, sort: { have: 'asc' } };
  const data = await request('POST', `/exchange/${league(leagueName)}`, { body });
  const result = data && data.result;
  const rows = Array.isArray(result) ? result : result && typeof result === 'object' ? Object.values(result) : [];
  const ratios = [];
  for (const r of rows.slice(0, 12)) {
    const offers = (r && r.listing && r.listing.offers) || [];
    const o = offers[0];
    if (!o || !o.exchange || !o.item) continue;
    const pay = Number(o.exchange.amount);
    const get = Number(o.item.amount);
    if (pay > 0 && get > 0) ratios.push(pay / get);
  }
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)];
}

// Lista de ligas activas, para el desplegable (se guarda en caché una hora; si el mercado
// no responde, se usan las de siempre para que el campo nunca se quede vacío).
let leaguesCache = { at: 0, list: [] };
export async function listLeagues() {
  if (Date.now() - leaguesCache.at < 3600_000 && leaguesCache.list.length) return leaguesCache.list;
  try {
    const data = await request('GET', '/data/leagues');
    const list = ((data && data.result) || [])
      .map((l) => String((l && (l.id || l.text)) || '').trim())
      .filter(Boolean);
    if (list.length) {
      leaguesCache = { at: Date.now(), list };
      return list;
    }
  } catch { /* se usa el respaldo de abajo */ }
  return leaguesCache.list.length ? leaguesCache.list : ['Standard', 'Hardcore'];
}

// La liga de temporada en curso: la primera que no es permanente ni variante.
// Es lo que casi siempre quiere el jugador, así que es el valor que se propone por defecto.
const NOT_SEASONAL = /\b(standard|est[aá]ndar|hardcore|ssf|solo self[- ]?found|ruthless|despiadad)/i;
export async function currentLeague() {
  const list = await listLeagues();
  return list.find((l) => !NOT_SEASONAL.test(l)) || list[0] || config.defaultLeague;
}

// Comparables para el tasador y el revisor: mismo nombre (únicos) o misma base (raros/mágicos).
export async function searchComparables({ name, base, rarity }, leagueName, count = 10) {
  const isUnique = String(rarity || '').toLowerCase() === 'unique';
  const q = { status: { option: 'online' } };
  if (isUnique && name) q.name = name;
  // En un único, el nombre NO es un tipo válido: si no se leyó la base real, no se filtra por tipo.
  if (base && (!isUnique || base !== name)) q.type = base;
  if (!q.name && !q.type) return { items: [], total: 0, searchId: null };
  const s = await request('POST', `/search/${league(leagueName)}`, { body: { query: q, sort: { price: 'asc' } } });
  const all = ((s && s.result) || []).filter(Boolean);
  const ids = spreadSample(all, count);
  const items = ids.length ? await fetchEntries(ids, s.id) : [];
  return { items, total: Number(s && s.total) || all.length, searchId: s && s.id };
}
