// El tasador: lee un objeto (texto copiado del juego o captura), busca comparables reales en el mercado
// y le pide a la IA un precio razonado. Los comparables los busca el servidor; la IA solo razona sobre ellos.
import { db, now } from './db.js';
import { config } from './config.js';
import { askJson } from './ai.js';
import { getRates, toExalted, canon } from './money.js';
import { COSTS, reserveCredits, refundCredits } from './plans.js';
import { searchComparables } from '../worker/trade2.js';
import { MarketError } from '../worker/queue.js';

const RARITY = {
  normal: 'Normal', magic: 'Magic', 'mágico': 'Magic', magico: 'Magic', rare: 'Rare', raro: 'Rare',
  unique: 'Unique', 'único': 'Unique', unico: 'Unique', currency: 'Currency', moneda: 'Currency', gem: 'Gem', gema: 'Gem',
};

// Formato de Ctrl+C del juego: bloques separados por "--------".
export function parseItemText(raw) {
  const text = String(raw || '').replace(/\r/g, '').trim();
  if (text.length < 8) return null;
  const blocks = text.split(/\n-{4,}\n?/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean));
  const head = blocks[0] || [];
  let itemClass = null;
  let rarity = null;
  const names = [];
  for (const l of head) {
    let m;
    if ((m = l.match(/^(?:Item Class|Clase de objeto)\s*:\s*(.+)$/i))) itemClass = m[1];
    else if ((m = l.match(/^(?:Rarity|Rareza)\s*:\s*(.+)$/i))) rarity = RARITY[m[1].toLowerCase()] || m[1];
    else names.push(l);
  }
  if (!rarity && !itemClass) return null; // no parece un objeto copiado del juego
  let name = names[0] || null;
  let base = names[1] || null;
  if (rarity !== 'Rare' && rarity !== 'Unique') { base = names[0] || null; name = names[0] || null; }
  let itemLevel = null;
  const mods = [];
  for (const b of blocks.slice(1)) {
    for (const l of b) {
      let m;
      if ((m = l.match(/^(?:Item Level|Nivel de objeto)\s*:\s*(\d+)/i))) itemLevel = Number(m[1]);
      else if (/^(Requires|Requiere|Requisitos|Level|Nivel|Str|Dex|Int|Fue|Des|Sockets|Engarces|Quality|Calidad|Note|Nota|Stack Size|Tamaño)\b/i.test(l)) continue;
      else if (/[0-9]/.test(l) || /\((implicit|rune|enchant|implícito)\)/i.test(l)) mods.push(l.slice(0, 160));
    }
  }
  return { itemClass, rarity, name, base, itemLevel, mods: mods.slice(0, 20), corrupted: /\n(Corrupted|Corrompido)\s*$/im.test(text) };
}

const fmtPrice = (a, c) => (a == null ? 'sin precio' : `${a} ${canon(c) || c}`);

async function getComparables(item, league) {
  if (!item || !item.base) return { status: 'skipped', list: [] };
  try {
    const r = await searchComparables(item, league, 10);
    const rates = getRates();
    const list = r.items
      .map((i) => ({ price_amount: i.price_amount, price_currency: i.price_currency, ex: toExalted(i.price_amount, i.price_currency, rates), mods: i.stats.slice(0, 8), name: i.name }))
      .filter((i) => i.ex != null)
      .sort((a, b) => a.ex - b.ex);
    return { status: 'ok', list, total: r.total };
  } catch (e) {
    return { status: e instanceof MarketError && e.kind === 'rate_limited' ? 'limited' : 'error', list: [] };
  }
}

function summarize(list) {
  if (!list.length) return null;
  const xs = list.map((l) => l.ex);
  return { count: xs.length, min: xs[0], median: xs[Math.floor(xs.length / 2)], max: xs[xs.length - 1] };
}

const SYSTEM = `Eres un tasador experto del mercado de Path of Exile 2. Hablas español neutro, claro y breve.
Respondes SIEMPRE con un único objeto JSON válido, sin texto adicional ni bloques de código.`;

const CURRENCIES = ['exalted', 'divine', 'chaos'];
function cleanMoney(o) {
  if (!o || typeof o !== 'object') return null;
  const amount = Number(o.cantidad);
  const cur = canon(o.moneda);
  if (!(amount > 0) || !CURRENCIES.includes(cur)) return null;
  return { cantidad: Math.round(amount * 100) / 100, moneda: cur };
}

export function validateAppraisal(d) {
  const precio = cleanMoney(d.precio);
  const rapida = cleanMoney(d.venta_rapida);
  const rMin = Number(d.rango && d.rango.min);
  const rMax = Number(d.rango && d.rango.max);
  const rCur = canon(d.rango && d.rango.moneda);
  if (!precio) return null;
  const strs = (a, n) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 220)).slice(0, n) : []);
  return {
    nombre: typeof d.nombre === 'string' ? d.nombre.slice(0, 80) : null,
    precio,
    venta_rapida: rapida,
    rango: rMin > 0 && rMax >= rMin && CURRENCIES.includes(rCur) ? { min: rMin, max: rMax, moneda: rCur } : null,
    confianza: ['alta', 'media', 'baja'].includes(d.confianza) ? d.confianza : 'baja',
    razones: strs(d.razones, 4),
    lo_que_vale: strs(d.lo_que_vale, 5),
    consejo: typeof d.consejo === 'string' ? d.consejo.slice(0, 300) : '',
  };
}

function appraisalPrompt(item, rawText, comps, rates) {
  const compLines = comps.list.length
    ? comps.list.map((c, i) => `${i + 1}. ${fmtPrice(c.price_amount, c.price_currency)} (≈${Math.round(c.ex)} ex) · ${c.mods.join(' · ') || 'sin modificadores leídos'}`).join('\n')
    : comps.status === 'ok' ? 'No hay anuncios en línea de esta base ahora mismo.' : 'No se pudo consultar el mercado ahora; tasa con tu conocimiento y baja la confianza.';
  return `Objeto a tasar:
${rawText ? rawText.slice(0, 2500) : JSON.stringify(item)}

Tasas actuales: 1 divine ≈ ${Math.round(rates.exPerDiv)} exalted; 1 chaos ≈ ${Math.round(rates.exPerChaos)} exalted${rates.estimated ? ' (estimadas)' : ''}.

Anuncios comparables en línea (misma ${item && item.rarity === 'Unique' ? 'pieza única' : 'base'}, del más barato al más caro):
${compLines}

Compara los modificadores del objeto con los comparables y decide un precio de venta realista.
Devuelve EXACTAMENTE este JSON:
{
  "nombre": string,
  "precio": { "cantidad": number, "moneda": "exalted" | "divine" | "chaos" },
  "venta_rapida": { "cantidad": number, "moneda": "exalted" | "divine" | "chaos" },
  "rango": { "min": number, "max": number, "moneda": "exalted" | "divine" | "chaos" },
  "confianza": "alta" | "media" | "baja",
  "razones": [string, string, string],
  "lo_que_vale": [string],
  "consejo": string
}
Reglas:
- Usa divine si el precio es de 1 divine o más; si no, exalted. Punto decimal, sin símbolos.
- "venta_rapida" es el precio para venderlo en menos de un día.
- "lo_que_vale": los modificadores de ESTE objeto que más suben su precio (copiados tal cual, máximo 5).
- "razones": frases cortas que citen los comparables (por ejemplo «el más barato con vida similar pide 3 div»).
- Si hay pocos comparables o no se parecen, "confianza" baja. No inventes datos del mercado.
- "consejo": una frase práctica (cuándo bajar el precio, si conviene esperar, etc.).`;
}

const READ_PROMPT = `Esta imagen es una captura de un objeto de Path of Exile 2 (puede estar en inglés o en español).
Transcribe el objeto. Devuelve EXACTAMENTE este JSON:
{ "es_objeto": boolean, "rareza": "Normal" | "Magic" | "Rare" | "Unique" | "Currency" | "Gem" | null,
  "nombre": string | null, "base": string | null, "clase": string | null, "nivel_objeto": number | null,
  "modificadores": [string], "corrupto": boolean }
Reglas: copia los modificadores literalmente, uno por elemento. Para objetos raros, "nombre" es la primera línea
del título y "base" la segunda. Si la imagen no muestra un objeto del juego, "es_objeto": false. No inventes texto ilegible.`;

function validateRead(d) {
  if (!d || d.es_objeto === false) return { notItem: true };
  const mods = Array.isArray(d.modificadores) ? d.modificadores.filter((x) => typeof x === 'string').map((x) => x.slice(0, 160)).slice(0, 20) : [];
  const base = typeof d.base === 'string' && d.base.trim() ? d.base.trim().slice(0, 80) : null;
  const name = typeof d.nombre === 'string' && d.nombre.trim() ? d.nombre.trim().slice(0, 80) : base;
  if (!name && !base) return null;
  return { rarity: RARITY[String(d.rareza || '').toLowerCase()] || d.rareza || null, name, base: base || name, itemClass: d.clase || null, itemLevel: Number(d.nivel_objeto) || null, mods, corrupted: !!d.corrupto };
}

function itemAsText(it) {
  return [`Rarity: ${it.rarity || '?'}`, it.name, it.base !== it.name ? it.base : null, it.itemLevel ? `Item Level: ${it.itemLevel}` : null, '--------', ...it.mods, it.corrupted ? 'Corrupted' : null]
    .filter(Boolean).join('\n');
}

// Límite de ritmo por usuario (memoria) y tope diario global (base de datos).
const recent = new Map();
function rateLimited(userId) {
  const t = Date.now();
  const arr = (recent.get(userId) || []).filter((x) => t - x < 60000);
  if (arr.length >= config.ai.perUserPerMin) return 'Vas muy rápido. Espera unos segundos y vuelve a intentarlo.';
  arr.push(t);
  recent.set(userId, arr);
  const day = db.prepare('SELECT COUNT(*) n FROM appraisals WHERE created_at > ?').get(now() - 86400).n;
  if (day >= config.ai.globalPerDay) return 'El tasador llegó a su límite de hoy. Vuelve a intentarlo mañana.';
  return null;
}

export class TasadorError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Orden del cobro: comprobar → reservar créditos → trabajar → guardar; si falla, se devuelven.
export async function appraise(user, { kind, text, image, league }) {
  const cost = COSTS[kind];
  if (!cost) throw new TasadorError(400, 'Tipo de tasación desconocido.');
  let item = null;
  if (kind === 'texto') {
    item = parseItemText(text);
    if (!item) throw new TasadorError(400, 'No reconozco ese texto. En el juego, pasa el ratón por el objeto, pulsa Ctrl+C y pégalo aquí.');
  } else {
    if (!image || !/^image\/(png|jpeg|webp)$/.test(image.mime) || !image.base64) throw new TasadorError(400, 'Sube una imagen PNG, JPG o WEBP.');
    const bytes = Buffer.from(image.base64, 'base64');
    if (bytes.length > config.ai.maxImageBytes) throw new TasadorError(400, 'La imagen pesa más de 5 MB. Recórtala al objeto y vuelve a probar.');
    if (!looksLikeImage(bytes, image.mime)) throw new TasadorError(400, 'Ese archivo no parece una imagen válida.');
  }
  const limited = rateLimited(user.id);
  if (limited) throw new TasadorError(429, limited);
  if (!reserveCredits(user.id, cost, `Tasación por ${kind}`)) {
    const free = config.billingMode === 'free';
    throw new TasadorError(402, free ? `Usaste tus tasaciones de este mes (esta cuesta ${cost} crédito${cost > 1 ? 's' : ''}). Se recargan cada mes.` : `Te faltan créditos: esta tasación cuesta ${cost}.`, { needCredits: !free, cost });
  }
  try {
    let engineRead = null;
    if (kind === 'captura') {
      const r = await askJson({ system: SYSTEM, prompt: READ_PROMPT, image, maxTokens: 900, validate: validateRead });
      if (!r.ok) throw new TasadorError(503, 'Ahora mismo no puedo leer la captura. No se te cobró nada; inténtalo en un momento.');
      if (r.data.notItem) throw new TasadorError(400, 'En esa imagen no veo un objeto del juego. No se te cobró nada.');
      item = r.data;
      engineRead = r.engine;
    }
    const comps = await getComparables(item, league || config.defaultLeague);
    const rates = getRates();
    const rawText = kind === 'texto' ? String(text) : itemAsText(item);
    const r = await askJson({ system: SYSTEM, prompt: appraisalPrompt(item, rawText, comps, rates), maxTokens: 1200, validate: validateAppraisal });
    if (!r.ok) throw new TasadorError(503, 'Ahora mismo no puedo tasar. No se te cobró nada; inténtalo en un momento.');
    const result = {
      ...r.data,
      nombre: r.data.nombre || item.name || item.base,
      mercado: { estado: comps.status, resumen: summarize(comps.list), total: comps.total || 0, muestras: comps.list.slice(0, 5) },
      tasas: { exPerDiv: rates.exPerDiv, estimated: rates.estimated },
    };
    const ins = db.prepare('INSERT INTO appraisals (user_id, kind, item_name, item_json, result_json, cost, engine, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(user.id, kind, result.nombre, JSON.stringify(item), JSON.stringify(result), cost, [engineRead, r.engine].filter(Boolean).join('+'), now());
    return { id: Number(ins.lastInsertRowid), item, result, cost };
  } catch (e) {
    refundCredits(user.id, cost, 'Devolución: la tasación no se pudo completar');
    if (e instanceof TasadorError) throw e;
    console.error('[tasador]', e && e.stack ? e.stack : e);
    throw new TasadorError(503, 'Algo falló al tasar. No se te cobró nada; inténtalo en un momento.');
  }
}

function looksLikeImage(b, mime) {
  if (mime === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8;
  if (mime === 'image/webp') return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
  return false;
}
