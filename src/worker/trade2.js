// Cliente del mercado oficial (trade2). Solo lectura. Todo pasa por la cola serial.
import crypto from 'node:crypto';
import { config } from '../lib/config.js';
import { request } from './queue.js';

const league = (l) => encodeURIComponent(l || config.defaultLeague);

// Cada mod puede llegar como texto plano ("+30 to maximum Mana") o, según el objeto,
// como {name:...} / {text:...}. Siempre lo pasamos a texto legible.
function modText(m) {
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object') return String(m.name || m.text || m.mod || m.display || '').trim() || null;
  return null;
}

export function normalizeEntry(entry) {
  if (!entry || !entry.item) return null;
  const it = entry.item;
  const l = entry.listing || {};
  const name = (it.name || it.typeLine || '').trim();
  const base = (it.baseType || it.typeLine || '').trim();
  const mods = [...(it.implicitMods || []), ...(it.explicitMods || []), ...(it.runeMods || []), ...(it.enchantMods || [])]
    .map(modText)
    .filter(Boolean);
  const fp = crypto.createHash('sha1').update([name, base, it.rarity || '', ...mods].join('|')).digest('hex').slice(0, 16);
  return {
    key: String(entry.id),
    name: name || base || 'Objeto',
    base_type: base,
    rarity: it.rarity || null,
    icon: typeof it.icon === 'string' && /^https:\/\//.test(it.icon) ? it.icon : null,
    price_amount: l.price && isFinite(Number(l.price.amount)) ? Number(l.price.amount) : null,
    price_currency: l.price ? String(l.price.currency || '') : null,
    stash_tab: l.stash && l.stash.name ? String(l.stash.name) : null,
    stats: mods.slice(0, 12),
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

// Los primeros anuncios (más baratos) de un objeto por nombre.
export async function searchByName(name, leagueName, count = 10) {
  const body = { query: { name, status: { option: 'online' } }, sort: { price: 'asc' } };
  const s = await request('POST', `/search/${league(leagueName)}`, { body });
  const ids = ((s && s.result) || []).slice(0, count);
  const items = ids.length ? await fetchEntries(ids, s.id) : [];
  return { items, total: Number(s && s.total) || ids.length, searchId: s && s.id };
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

// Comparables para el tasador: mismo nombre (únicos) o misma base (raros/mágicos), los más baratos en línea.
export async function searchComparables({ name, base, rarity }, leagueName, count = 10) {
  const isUnique = String(rarity || '').toLowerCase() === 'unique';
  const q = { status: { option: 'online' } };
  if (isUnique && name) q.name = name;
  if (base) q.type = base;
  if (!q.name && !q.type) return { items: [], total: 0, searchId: null };
  const s = await request('POST', `/search/${league(leagueName)}`, { body: { query: q, sort: { price: 'asc' } } });
  const ids = ((s && s.result) || []).slice(0, count);
  const items = ids.length ? await fetchEntries(ids, s.id) : [];
  return { items, total: Number(s && s.total) || ids.length, searchId: s && s.id };
}
