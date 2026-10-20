// Conversión de precios a una unidad común (exalted). Las tasas vienen del mercado de divisas;
// antes de la primera lectura se usan los valores aproximados del dossier y se marca "estimado".
import { db } from './db.js';

const FALLBACK = { exPerDiv: 750, exPerChaos: 70 }; // dossier de migración, solo hasta la primera lectura real

export function getRates() {
  const r = db.prepare('SELECT * FROM currency_price_history ORDER BY taken_at DESC, id DESC LIMIT 1').get();
  const div = r && r.divine_per_exalted > 0 ? 1 / r.divine_per_exalted : null;
  const cha = r && r.chaos_per_exalted > 0 ? 1 / r.chaos_per_exalted : null;
  return {
    exPerDiv: div || FALLBACK.exPerDiv,
    exPerChaos: cha || FALLBACK.exPerChaos,
    estimated: !(div && cha),
    takenAt: r ? r.taken_at : null,
  };
}

const ALIAS = {
  exalted: 'exalted', ex: 'exalted', exalt: 'exalted', exaltedorb: 'exalted', currencyaddmodtorare: 'exalted',
  divine: 'divine', div: 'divine', divineorb: 'divine', currencymodvalues: 'divine',
  chaos: 'chaos', chaosorb: 'chaos', currencyrerollrare: 'chaos',
};
export const canon = (c) => ALIAS[String(c || '').toLowerCase().replace(/[^a-z]/g, '')] || null;

export function toExalted(amount, currency, rates) {
  const c = canon(currency);
  const a = Number(amount);
  if (!c || !isFinite(a)) return null;
  if (c === 'exalted') return a;
  if (c === 'divine') return a * rates.exPerDiv;
  if (c === 'chaos') return a * rates.exPerChaos;
  return null;
}

export const exToDivine = (ex, rates) => (ex == null ? null : ex / rates.exPerDiv);

// Texto legible: usa divine cuando vale >= 1 divine, si no exalted.
export function fmtEx(ex, rates) {
  if (ex == null) return '—';
  if (ex >= rates.exPerDiv) return `${(ex / rates.exPerDiv).toFixed(ex / rates.exPerDiv >= 10 ? 1 : 2)} div`;
  return `${ex >= 100 ? Math.round(ex) : ex.toFixed(1)} ex`;
}
