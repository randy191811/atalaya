// Cliente del mercado oficial (trade2). Solo lectura. Todo pasa por la cola serial.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../lib/config.js';
import { request } from './queue.js';

const league = (l) => encodeURIComponent(l || config.defaultLeague);

// El mercado manda el texto con el marcado interno del juego: "[Mace|One Hand Mace]" se
// enseña como «One Hand Mace» y "[Physical] Damage" como «Physical Damage». Sin esto, la
// ficha sale llena de corchetes y barras.
export function cleanMarkup(s) {
  return String(s == null ? '' : s)
    .replace(/\[([^[\]|]*)\|([^[\]]*)\]/g, '$2')
    .replace(/\[([^[\]]*)\]/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ESTO ERA EL FALLO. Según la documentación de GGG, `implicitMods` y `explicitMods` NO son
// listas de texto: son listas de objetos { description, flags }. Solo `enchantMods`,
// `runeMods`, `bondedMods` y compañía son texto plano. Como aquí no se miraba `description`,
// TODOS los afijos de TODOS los objetos se quedaban en nada, y en la ficha solo salía lo que
// venía por otro lado (propiedades, requisitos, habilidad concedida, texto de sabor).
export function modText(m) {
  if (typeof m === 'string') return cleanMarkup(m) || null;
  if (typeof m === 'number') return String(m);
  if (m && typeof m === 'object') {
    return cleanMarkup(m.description || m.name || m.text || m.mod || m.display || m.value || '') || null;
  }
  return null;
}

// `logbookMods` llega como { name, faction, mods:[texto] }: lo que interesa es `mods`.
function flattenMods(arr) {
  const out = [];
  for (const m of Array.isArray(arr) ? arr : []) {
    if (m && typeof m === 'object' && Array.isArray(m.mods)) out.push(...m.mods);
    else out.push(m);
  }
  return out;
}

// El juego muestra primero lo que trae la base (implícitos, runas, encantamientos)
// y debajo los modificadores que le tocaron al objeto. Se separan en dos grupos porque
// un objeto puede traer los de arriba y faltarle los de abajo: entonces hay que ir a
// buscarlos a otro sitio en vez de dar la ficha por buena con una sola línea.
const IMPLICIT_FIELDS = ['enchantMods', 'scourgeMods', 'implicitMods', 'runeMods'];
const EXPLICIT_FIELDS = [
  'explicitMods', 'bondedMods', 'desecratedMods', 'veiledMods',
  'crucibleMods', 'logbookMods', 'utilityMods', 'fracturedMods', 'craftedMods',
];
const MOD_ORDER = [...IMPLICIT_FIELDS, ...EXPLICIT_FIELDS];
// Listas de texto que NO son modificadores, para que el barrido general no las cuele.
const NOT_MODS = new Set([
  'flavourText', 'descrText', 'secDescrText', 'prophecyText', 'requirements',
  'properties', 'additionalProperties', 'nextLevelRequirements', 'sockets',
  'socketedItems', 'influences', 'hashes', 'extended', 'incubatedItem', 'ultimatumMods',
]);

// Propiedades y requisitos: { name, values: [[valor, tipo]], displayMode }.
// displayMode dice cómo los coloca el juego:
//   0 → «Nombre: valor»   1 → «valor Nombre» (ej. «98 Str»)
//   2 → barra, se trata como 0   3 → el valor va dentro del nombre, en %0, %1…
export function propText(p) {
  if (!p || typeof p !== 'object') return null;
  const name = cleanMarkup(p.name);
  const vals = Array.isArray(p.values)
    ? p.values.map((v) => cleanMarkup(Array.isArray(v) ? v[0] : v)).filter((v) => v !== '')
    : [];
  if (!name && !vals.length) return null;
  if (!vals.length) return name || null;
  if (Number(p.displayMode) === 3 || /%\d/.test(name)) {
    return name.replace(/%(\d)/g, (_, i) => String(vals[Number(i)] ?? '')).trim();
  }
  if (!name) return vals.join(', ');
  if (Number(p.displayMode) === 1) return `${vals.join(', ')} ${name}`;
  return `${name}: ${vals.join(', ')}`;
}

// Los requisitos se escriben distinto que las propiedades: el juego pone «Level 31» y
// «20 Str», sin los dos puntos, y los junta todos en una línea «Requiere: …».
export function reqText(p) {
  if (!p || typeof p !== 'object') return null;
  const name = cleanMarkup(p.name);
  const vals = Array.isArray(p.values)
    ? p.values.map((v) => cleanMarkup(Array.isArray(v) ? v[0] : v)).filter((v) => v !== '')
    : [];
  if (!name && !vals.length) return null;
  if (!vals.length) return name || null;
  if (!name) return vals.join(', ');
  if (Number(p.displayMode) === 3 || /%\d/.test(name)) {
    return name.replace(/%(\d)/g, (_, i) => String(vals[Number(i)] ?? '')).trim();
  }
  return Number(p.displayMode) === 1 ? `${vals.join(', ')} ${name}` : `${name} ${vals.join(', ')}`;
}

// Diccionario de estadísticas del mercado: convierte un identificador como
// "explicit.stat_3299347043" en su texto ("#% increased Spell Damage").
// SIN ESTO los afijos de los objetos raros salen con su nombre interno («Reaver's»,
// «of Dueling») en vez de con lo que hacen, así que es imprescindible, no un respaldo.
// Se guarda en disco una semana: así sobrevive a los reinicios y solo se pide una vez.
const STATS_FILE = path.join(config.dataDir, 'trade-stats.json');
const STATS_TTL = 7 * 86400_000;
let statsDict = null;
let statsTriedAt = 0;
let statsStatus = 'todavía no se ha pedido';
export const statsState = () => statsStatus;
export function setStatsDict(d, estado) { // para las pruebas
  statsDict = d;
  statsTriedAt = 0;
  statsStatus = estado || (d ? `${d.size} estadísticas` : 'todavía no se ha pedido');
}

function statsFromDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    if (raw && raw.at && Date.now() - raw.at < STATS_TTL && raw.entries) {
      const map = new Map(Object.entries(raw.entries));
      if (map.size) {
        statsDict = map;
        statsStatus = `${map.size} estadísticas (guardadas el ${new Date(raw.at).toLocaleDateString('es')})`;
        return true;
      }
    }
  } catch { /* no hay copia o está rota: se pide al mercado */ }
  return false;
}

export async function loadStats() {
  if (statsDict) return statsDict;
  if (statsFromDisk()) return statsDict;
  // Si acaba de fallar se espera un poco, pero no una hora: sin esto la ficha queda coja.
  if (Date.now() - statsTriedAt < 120_000) return null;
  statsTriedAt = Date.now();
  try {
    const data = await request('GET', '/data/stats');
    const map = new Map();
    for (const group of (data && data.result) || []) {
      for (const e of (group && group.entries) || []) {
        if (e && e.id && e.text) map.set(String(e.id), String(e.text));
      }
    }
    if (!map.size) {
      statsStatus = 'el mercado respondió, pero sin ninguna estadística (cambió el formato de /data/stats)';
      return null;
    }
    statsDict = map;
    statsStatus = `${map.size} estadísticas cargadas`;
    try {
      fs.writeFileSync(STATS_FILE, JSON.stringify({ at: Date.now(), entries: Object.fromEntries(map) }), { mode: 0o600 });
    } catch (e) {
      statsStatus += ' (no se pudo guardar en disco: ' + (e.message || e) + ')';
    }
  } catch (e) {
    statsStatus = `no se pudo pedir /data/stats: ${(e && e.message) || e}`;
  }
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

// Los modificadores, separados en los dos bloques que enseña el juego:
// `imp` = lo que trae la base (implícitos, runas, encantamientos, habilidad concedida)
// `exp` = lo que le tocó al objeto (los afijos).
export function collectModGroups(it) {
  const imp = [];
  const exp = [];
  const granted = [];
  const into = (arr) => (v) => {
    const t = modText(v);
    if (t && !imp.includes(t) && !exp.includes(t) && !granted.includes(t)) arr.push(t);
  };

  for (const k of IMPLICIT_FIELDS) if (Array.isArray(it[k])) flattenMods(it[k]).forEach(into(imp));
  for (const k of EXPLICIT_FIELDS) if (Array.isArray(it[k])) flattenMods(it[k]).forEach(into(exp));
  // Las gemas vaal y similares traen una segunda cara en `hybrid`.
  if (it.hybrid && Array.isArray(it.hybrid.explicitMods)) flattenMods(it.hybrid.explicitMods).forEach(into(exp));
  // Cualquier otra lista de modificadores, incluida una que el juego añada mañana.
  for (const k of Object.keys(it)) {
    if (MOD_ORDER.includes(k) || NOT_MODS.has(k) || !Array.isArray(it[k])) continue;
    if (/Mods$/.test(k) || /^(stats|affixes)$/.test(k)) flattenMods(it[k]).forEach(into(exp));
  }
  // Habilidades que concede la base (los cetros y varitas de PoE2 las llevan). El juego
  // las enseña en su propio bloque, encima del implícito, así que van aparte.
  if (Array.isArray(it.grantedSkills)) it.grantedSkills.forEach((p) => into(granted)(propText(p)));

  // Si el objeto tiene afijos pero el mercado no mandó su texto, se reconstruye desde
  // el bloque extendido. Esto es lo que rescata los modificadores de los raros.
  if (!exp.length) extendedGroup(it, ['explicit', 'crafted', 'fractured', 'veiled', 'desecrated']).forEach(into(exp));
  if (!imp.length) extendedGroup(it, ['implicit', 'enchant', 'rune', 'scourge']).forEach(into(imp));
  return { imp, exp, granted };
}

// Reúne TODO el texto del objeto, pase lo que pase con el nombre de los campos.
// Se devuelve en el orden del juego: primero lo de la base, luego lo propio del objeto.
export function collectMods(it) {
  const { imp, exp, granted } = collectModGroups(it);
  // Si de verdad no hay ningún modificador (tabletas, monedas, gemas…), se usan sus
  // propiedades y su descripción para no dejar la lista en blanco.
  if (!imp.length && !exp.length && !granted.length) {
    const otros = [];
    if (Array.isArray(it.properties)) for (const p of it.properties) { const t = propText(p); if (t && !otros.includes(t)) otros.push(t); }
    for (const k of ['descrText', 'secDescrText']) { const t = cleanMarkup(it[k]); if (t && !otros.includes(t)) otros.push(t); }
    return otros;
  }
  return [...granted, ...imp, ...exp];
}

// La ficha completa, con los mismos bloques y en el mismo orden que el juego.
// Lo que no tenga el objeto se devuelve como lista vacía.
export function itemDetail(it) {
  if (!it || typeof it !== 'object') return null;
  const lines = (arr, fn) => {
    const out = [];
    for (const x of Array.isArray(arr) ? arr : []) {
      const t = fn(x);
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  };
  const { imp, exp, granted } = collectModGroups(it);
  const req = lines(it.requirements, reqText);
  const sockets = Array.isArray(it.sockets) ? it.sockets.length : 0;
  const descr = [];
  for (const k of ['descrText', 'secDescrText']) { const t = cleanMarkup(it[k]); if (t && !descr.includes(t)) descr.push(t); }
  return {
    properties: [...lines(it.properties, propText), ...lines(it.notableProperties, propText)],
    requirements: req.length ? [`Requiere: ${req.join(', ')}`] : [],
    sockets: sockets ? [`${sockets} ${sockets === 1 ? 'engarce' : 'engarces'}`] : [],
    itemLevel: Number(it.ilvl || it.itemLevel) || null,
    granted,
    implicits: imp,
    mods: exp,
    descr,
    flavour: lines(it.flavourText, cleanMarkup),
    corrupted: !!it.corrupted,
    unidentified: it.identified === false,
  };
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
  // La huella identifica al objeto entre lecturas (para ver si solo cambió de precio).
  // Se ordena antes de calcularla: así cambiar el ORDEN en que se pintan los modificadores
  // no hace que un objeto parezca otro distinto.
  const fp = crypto.createHash('sha1').update([name, base, it.rarity || '', ...[...mods].sort()].join('|')).digest('hex').slice(0, 16);
  return {
    key: String(entry.id),
    name: name || base || 'Objeto',
    base_type: base,
    rarity: it.rarity || null,
    icon: typeof it.icon === 'string' && /^https:\/\//.test(it.icon) ? it.icon : null,
    item_level: Number(it.ilvl || it.itemLevel) || null,
    corrupted: it.corrupted ? 1 : 0,
    detail: itemDetail(it),
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

// Solo para depurar: trae un anuncio de la tienda SIN normalizar, tal cual lo manda el
// mercado. Si se pasa `listingKey`, trae ESE objeto; si no, busca el primero que se vea
// incompleto (el que interesa mirar), y si todos están bien, el primero de la lista.
export async function debugRawShopItem(account, leagueName, cookie, listingKey = null) {
  const body = {
    query: { status: { option: 'any' }, filters: { trade_filters: { filters: { account: { input: account } } } } },
    sort: { price: 'asc' },
  };
  const s = await request('POST', `/search/${league(leagueName)}`, { body, cookie });
  const all = ((s && s.result) || []).filter(Boolean);
  if (!all.length) return null;
  // Si se pide un objeto concreto se trae solo ese; si no, se miran los 10 primeros
  // para poder elegir uno que esté incompleto.
  const ids = listingKey ? (all.includes(String(listingKey)) ? [String(listingKey)] : []) : all.slice(0, 10);
  if (!ids.length) return { noEsta: true };
  const data = await request('GET', `/fetch/${ids.join(',')}?query=${encodeURIComponent(s.id)}`, { cookie });
  const entries = ((data && data.result) || []).filter(Boolean);
  if (!entries.length) return null;
  if (entries.some(needsStatsDict)) await loadStats();
  // El que interesa mirar es el que se queda sin características propias.
  const roto = entries.find((e) => itemDetail(e.item) && !itemDetail(e.item).mods.length);
  const raw = roto || entries[0];
  const d = itemDetail(raw.item) || {};
  return {
    resumen: {
      objeto: `${(raw.item && raw.item.name) || ''} ${(raw.item && raw.item.baseType) || ''}`.trim(),
      rareza: (raw.item && raw.item.rarity) || '?',
      revisados: entries.length,
      incompletos: entries.filter((e) => { const x = itemDetail(e.item); return x && !x.mods.length; }).length,
      campos: inventoryOf(raw.item),
      propiedades: d.properties || [],
      implicitos: d.implicits || [],
      afijos: d.mods || [],
      diccionario: statsState(),
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
