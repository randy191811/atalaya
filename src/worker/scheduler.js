// Planificador dentro del propio proceso: cada 30 s decide qué toca. Todo sale por la cola serial del mercado.
import { db, now, getState, setState } from '../lib/db.js';
import { config } from '../lib/config.js';
import { planFor } from '../lib/plans.js';
import { isBlocked } from './queue.js';
import { checkShop, checkWishes, refreshCurrencies, isRunning } from './jobs.js';
import { reviewSome } from './reviews.js';

let timer = null;
let busy = false;

async function tick() {
  if (busy || !config.marketEnabled) return;
  busy = true;
  try {
    if (isBlocked()) return;
    const t = now();

    if (t - Number(getState('last:currency', 0)) >= config.cadence.currency * 60) {
      try { await refreshCurrencies(); } catch (e) { console.error('[divisas]', e.message); setState('last:currency', now()); }
      if (isBlocked()) return;
    }

    const shops = db.prepare(
      `SELECT s.id, u.role, u.plan, (SELECT MAX(taken_at) FROM snapshots WHERE shop_id = s.id) AS last
       FROM shops s JOIN users u ON u.id = s.user_id WHERE s.paused = 0`
    ).all();
    const due = shops
      .filter((s) => !isRunning(s.id) && t - (s.last || 0) >= planFor(s).intervalMin * 60)
      .sort((a, b) => (a.last || 0) - (b.last || 0));
    for (const s of due) {
      try { await checkShop(s.id); } catch (e) { console.error('[tienda]', s.id, e.message); }
      if (isBlocked()) return;
    }

    if (t - Number(getState('last:wishes', 0)) >= config.cadence.buyAlerts * 60) {
      try { await checkWishes(); } catch (e) { console.error('[deseos]', e.message); setState('last:wishes', now()); }
    }
    if (isBlocked()) return;
    // Revisor de precios: unos pocos anuncios cada cierto tiempo, nunca a costa de las lecturas de tienda.
    if (t - Number(getState('last:reviews', 0)) >= config.cadence.reviews * 60) {
      setState('last:reviews', now());
      try { await reviewSome(config.reviewsPerRun); } catch (e) { console.error('[revisor]', e.message); }
    }
  } finally {
    busy = false;
  }
}

export function startScheduler(everyMs = 30000) {
  if (timer) return;
  setTimeout(() => tick().catch((e) => console.error('[tic]', e.message)), 3000);
  timer = setInterval(() => tick().catch((e) => console.error('[tic]', e.message)), everyMs);
  timer.unref?.();
}
export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
export const runTick = tick;
