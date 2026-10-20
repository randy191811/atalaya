// Revisor de precios: compara cada anuncio con los anuncios parecidos (misma base, o mismo único) que hay en línea.
// No usa IA ni créditos. Va despacio a propósito para no saturar el mercado.
import { db, now } from '../lib/db.js';
import { getRates, toExalted } from '../lib/money.js';
import { searchComparables } from './trade2.js';
import { MarketError } from './queue.js';

export const REVIEW_TTL = 12 * 3600; // un anuncio se vuelve a comparar como mucho cada 12 h

// Veredicto: caro si pide más de un 25 % sobre la mediana de los 5 más baratos; barato si pide menos del 85 % del más barato.
export function verdictFor(ownEx, compsEx) {
  const xs = compsEx.filter((x) => x > 0).sort((a, b) => a - b);
  if (ownEx == null || xs.length < 3) return { verdict: 'sin_datos', min: xs[0] ?? null, median: null };
  const top = xs.slice(0, 5);
  const median = top[Math.floor(top.length / 2)];
  const min = xs[0];
  let verdict = 'en_precio';
  if (ownEx > median * 1.25) verdict = 'caro';
  else if (ownEx < min * 0.85) verdict = 'barato';
  return { verdict, min, median };
}

export async function reviewListing(listing, league) {
  const rates = getRates();
  const res = await searchComparables({ name: listing.name, base: listing.base_type, rarity: listing.rarity }, league, 10);
  const comps = res.items.filter((i) => i.key !== listing.listing_key).map((i) => toExalted(i.price_amount, i.price_currency, rates)).filter((x) => x != null);
  const own = toExalted(listing.price_amount, listing.price_currency, rates);
  const v = verdictFor(own, comps);
  db.prepare(
    `INSERT INTO listing_reviews (shop_id, item_fp, checked_at, comp_count, comp_min_ex, comp_median_ex, own_ex, verdict) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(shop_id, item_fp) DO UPDATE SET checked_at=excluded.checked_at, comp_count=excluded.comp_count, comp_min_ex=excluded.comp_min_ex,
     comp_median_ex=excluded.comp_median_ex, own_ex=excluded.own_ex, verdict=excluded.verdict`
  ).run(listing.shop_id, listing.item_fp, now(), comps.length, v.min, v.median, own, v.verdict);
  return { ...v, count: comps.length, own };
}

// Trabajo de fondo: unos pocos anuncios por pasada, los que lleven más tiempo sin comparar.
export async function reviewSome(limit = 4) {
  const rows = db.prepare(
    `SELECT l.*, s.league FROM listings l JOIN shops s ON s.id = l.shop_id
     LEFT JOIN listing_reviews r ON r.shop_id = l.shop_id AND r.item_fp = l.item_fp
     WHERE s.paused = 0 AND l.item_fp IS NOT NULL AND (r.checked_at IS NULL OR r.checked_at < ?)
     ORDER BY COALESCE(r.checked_at, 0) ASC, l.first_seen_at ASC LIMIT ?`
  ).all(now() - REVIEW_TTL, limit);
  let done = 0;
  for (const l of rows) {
    try {
      await reviewListing(l, l.league);
      done++;
    } catch (e) {
      if (e instanceof MarketError && (e.kind === 'rate_limited' || e.kind === 'blocked')) break;
    }
  }
  return { done };
}
