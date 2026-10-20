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

// El juego muestra primero lo que trae la base (implícitos, runas, encantamientos)
// y debajo los modificadores que le tocaron al objeto. Se separan en dos grupos porque
// un objeto puede traer los de arriba y faltarle los de abajo: entonces hay que ir a
// buscarlos a otro sitio en vez de dar la ficha por buena con una sola línea.
const IMPLICIT_FIELDS = ['enchantMods', 'scourgeMods', 'implicitMods', 'runeMods'];
const EXPLICIT_FIELDS = [
  'fracturedMods', 'explicitMods', 'craftedMods', 'desecratedMods',
  'veiledMods', 'crucibleMods', 'logbookMods', 'utilityMods',
];
const MOD_ORDER = [...IMPLICIT_FIELDS, ...EXPLICIT_FIELDS];
// Listas de texto que NO son modificadores, para que el barrido general no las cuele.
const NOT_MODS = new Set([
  'flavourText', 'descrText', 'secDescrText', 'prophecyText', 'requirements',
  'properties', 'additionalProperties', 'nextLevelRequirements', 'sockets',
  'socketedItems', 'influences', 'hashes', 'extended', 'incubatedItem', 'ultimatumMods',
]);

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

// Diccionario de estadísticas del mercado: convierte un identificador como
// "explicit.stat_3299347043" en su texto ("#% increased Spell Damage"). Solo se descarga
// si hace falta de verdad, y se guarda un día en memoria.
let statsDict = null;
let statsTriedAt = 0;
export function setStatsDict(d) { statsDict = d; } // para las pruebas
export async function loadStats() {
  if (statsDict || Date.now() - statsTriedAt < 3600_000) return statsDict;
  statsTriedAt = Date.now();
  try {
    const data = await request('GET', '/data/stats');
    const map = new Map();
    for (const group of (data && data.result) || []) {
      for (const e of (group && group.entries) || []) {
        if (e && e.id && e.text) map.set(String(e.id), String(e.text));
      }
    }
    if (map.size) statsDict = map;
  } catch { /* se seguirá usando el nombre del afijo */ }
  return statsDict;
}

// Reconstruye el texto de un modificador a partir de sus valores y el diccionario.
// { name:'Tyrannical', magnitudes:[{hash:'explicit.stat_X', min:'155', max:'169'}] }
function textFromExtended(mod, dict) {
  const out = [];
  const seen = new Set();
  for (const g of (mod && mod.magnitudes) || []) {
    if (!g || !g.hash || seen.has(g.hash)) continue;
    seen.add(g.hash);
    const tpl = dict && dict.get(String(g.hash));
    if (!tpl) continue;
    const val = String(g.min) === String(g.max) ? String(g.min) : `${g.min}-${g.max}`;
    out.push(tpl.replace(/#/g, val));
  }
  if (out.length) return out;
  const n = modText(mod);
  return n ? [n] : [];
}

function extendedGroup(it, kinds) {
  const ex = it.extended && it.extended.mods;
  if (!ex || typeof ex !== 'object') return [];
  const out = [];
  for (const [k, group] of Object.entries(ex)) {
    if (!Array.isArray(group) || !kinds.includes(k)) continue;
    for (const mod of group) out.push(...textFromExtended(mod, statsDict));
  }
  return out;
}

// ¿Este objeto se quedaría sin sus características propias? Entonces conviene
// descargar el diccionario de estadísticas antes de leerlo.
export function needsStatsDict(entry) {
  const it = entry && entry.item;
  if (!it || statsDict) return false;
  const tieneTexto = EXPLICIT_FIELDS.some((k) => Array.isArray(it[k]) && it[k].length);
  const tieneExtendido = !!(it.extended && it.extended.mods && Object.keys(it.extended.mods).length);
  return !tieneTexto && tieneExtendido;
}

// Reúne TODO el texto del objeto, pase lo que pase con el nombre de los campos.
// Se devuelve en el orden del juego: primero lo de la base, luego lo propio del objeto.
export function collectMods(it) {
  const imp = [];
  const exp = [];
  const into = (arr) => (v) => {
    const t = modText(v);
    if (t && !arr.includes(t) && !imp.includes(t) && !exp.includes(t)) arr.push(t);
  };

  for (const k of IMPLICIT_FIELDS) if (Array.isArray(it[k])) it[k].forEach(into(imp));
  for (const k of EXPLICIT_FIELDS) if (Array.isArray(it[k])) it[k].forEach(into(exp));
  // Cualquier otra lista de modificadores, incluida una que el juego añada mañana.
  for (const k of Object.keys(it)) {
    if (MOD_ORDER.includes(k) || NOT_MODS.has(k) || !Array.isArray(it[k])) continue;
    if (/Mods$/.test(k) || /^(stats|affixes)$/.test(k)) it[k].forEach(into(exp));
  }
  // Habilidades que concede la base (los cetros y varitas de PoE2 las llevan).
  if (Array.isArray(it.grantedSkills)) it.grantedSkills.forEach((p) => into(imp)(propText(p)));

  // Si el objeto tiene afijos pero el mercado no mandó su texto, se reconstruye desde
  // el bloque extendido. Esto es lo que rescata los modificadores de los raros.
  if (!exp.length) extendedGroup(it, ['explicit', 'crafted', 'fractured', 'veiled', 'desecrated']).forEach(into(exp));
  if (!imp.length) extendedGroup(it, ['implicit', 'enchant', 'rune', 'scourge']).forEach(into(imp));

  // Y si de verdad no hay ningún modificador (tabletas, monedas, gemas…), se usan sus
  // propiedades y su descripción para no dejar la ficha en blanco.
  if (!imp.length && !exp.length) {
    if (Array.isArray(it.properties)) it.properties.forEach((p) => into(exp)(propText(p)));
    for (const k of ['descrText', 'secDescrText']) if (typeof it[k] === 'string') into(exp)(it[k]);
  }
  return [...imp, ...exp];
}

// Resumen en claro de qué trae un objeto del mercado. Sirve para ver de un vistazo,
// desde Administrar, si falta algo y dónde, sin tener que leer el JSON entero.
export function inventoryOf(it) {
  if (!it || typeof it !== 'object') return [];
  const out = [];
  for (const [k, v] of Object.entries(it)) {
    if (Array.isArray(v)) out.push(`${k}[${v.length}]`);
    else if (v && typeof v === 'object') out.push(`${k}{${Object.keys(v).join(',')}}`);
  }
  const ex = it.extended && it.extended.mods;
  if (ex && typeof ex === 'object') {
    for (const [k, v] of Object.entries(ex)) out.push(`extended.mods.${k}[${Array.isArray(v) ? v.length : '?'}]`);
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
    const entries = ((data && data.result) || []).filter(Boolean);
    // Si algún objeto trae sus afijos sin texto, se descarga una sola vez el diccionario
    // del mercado para poder escribirlos. Lo normal es no necesitarlo nunca.
    if (entries.some(needsStatsDict)) await loadStats();
    for (const e of entries) {
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
  const raw = ((data && data.result) || [])[0] || null;
  if (!raw) return null;
  if (needsStatsDict(raw)) await loadStats();
  return {
    resumen: {
      campos: inventoryOf(raw.item),
      leido: collectMods(raw.item),
      diccionario: statsDict ? `${statsDict.size} estadísticas cargadas` : 'no hizo falta',
    },
    crudo: raw,
  };
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
