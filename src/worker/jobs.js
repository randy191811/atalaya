// Trabajos de fondo: leer tiendas, confirmar ventas, divisas y deseos.
// Regla de oro: si el mercado falla o limita, se conservan los últimos datos. Nunca ceros falsos.
import { db, now, tx, getState, setState } from '../lib/db.js';
import { config } from '../lib/config.js';
import { decrypt } from '../lib/secrets.js';
import { getRates, toExalted } from '../lib/money.js';
import { MarketError } from './queue.js';
import { searchShop, searchByName, exchangeRate } from './trade2.js';
import { sendPush } from '../lib/webpush.js';

const running = new Set();
export const isRunning = (shopId) => running.has(shopId);

export async function notifyUser(userId, { title, body, url = '/app.html#/ventas', tag }) {
  const prefs = db.prepare('SELECT push_enabled FROM notification_prefs WHERE user_id = ?').get(userId);
  if (!prefs || !prefs.push_enabled) return 0;
  let ok = 0;
  for (const s of db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId)) {
    if ((await sendPush(s, { title, body, url, tag })) === 'ok') ok++;
  }
  return ok;
}

const snapshot = (shopId, status, count) =>
  db.prepare('INSERT INTO snapshots (shop_id, taken_at, listing_count, status) VALUES (?, ?, ?, ?)').run(shopId, now(), count, status);
const errStatus = (e) => (e instanceof MarketError && (e.kind === 'rate_limited' || e.kind === 'blocked') ? 'rate_limited' : 'error');

export async function checkShop(shopId) {
  if (running.has(shopId)) return { status: 'busy' };
  running.add(shopId);
  try {
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
    if (!shop) return { status: 'no_shop' };
    const cookie = decrypt(shop.poe_session_enc) || undefined;
    const prevCount = db.prepare('SELECT COUNT(*) AS n FROM listings WHERE shop_id = ?').get(shopId).n;

    let res;
    try {
      res = await searchShop(shop.poe_account, shop.league, cookie);
    } catch (e) {
      const st = errStatus(e);
      snapshot(shopId, st, prevCount);
      return { status: st, retryAt: e.retryAt || null };
    }
    const items = res.items;

    // Un vaciado repentino no se cree a la primera: podría ser un fallo del mercado.
    // (Si ya hay objetos pendientes de confirmar, el vaciado ya se creyó una vez y se sigue con normalidad.)
    const pendingN = db.prepare('SELECT COUNT(*) n FROM sale_pending WHERE shop_id = ?').get(shopId).n;
    if (items.length === 0 && prevCount > 0 && pendingN === 0 && Number(getState(`zero:${shopId}`, 0)) < 1) {
      setState(`zero:${shopId}`, 1);
      snapshot(shopId, 'no_data', prevCount);
      return { status: 'no_data' };
    }
    setState(`zero:${shopId}`, 0);

    const rates = getRates();
    const t = now();
    const sold = [];
    let reprices = 0;

    tx(() => {
      const prev = db.prepare('SELECT * FROM listings WHERE shop_id = ?').all(shopId);
      const prevByKey = new Map(prev.map((r) => [r.listing_key, r]));
      const nowKeys = new Set(items.map((i) => i.key));
      const added = items.filter((i) => !prevByKey.has(i.key));
      const claimed = new Set();

      for (const m of prev.filter((r) => !nowKeys.has(r.listing_key))) {
        // ¿Cambio de precio? El mismo objeto reaparece con otra clave: se actualiza sin avisar.
        const match = added.find((a) => !claimed.has(a.key) && a.fp === m.item_fp);
        if (match) {
          claimed.add(match.key);
          db.prepare('UPDATE listings SET listing_key=?, price_amount=?, price_currency=?, last_seen_at=?, stash_tab=?, icon=COALESCE(?, icon), item_level=COALESCE(?, item_level), corrupted=? WHERE id=?')
            .run(match.key, match.price_amount, match.price_currency, t, match.stash_tab, match.icon, match.item_level, match.corrupted ? 1 : 0, m.id);
          db.prepare('DELETE FROM sale_pending WHERE shop_id=? AND listing_key=?').run(shopId, m.listing_key);
          reprices++;
          continue;
        }
        const pend = db.prepare('SELECT * FROM sale_pending WHERE shop_id=? AND listing_key=?').get(shopId, m.listing_key);
        if (!pend) {
          db.prepare('INSERT OR IGNORE INTO sale_pending (shop_id, listing_key, first_missing_at) VALUES (?,?,?)').run(shopId, m.listing_key, t);
          continue;
        }
        // Segunda lectura seguida sin el objeto: venta confirmada.
        const dup = m.item_fp && db.prepare('SELECT 1 FROM sales WHERE shop_id=? AND item_fp=? AND detected_at>?').get(shopId, m.item_fp, t - 6 * 3600);
        if (!dup) {
          const ex = toExalted(m.price_amount, m.price_currency, rates);
          const r = db.prepare(
            'INSERT INTO sales (shop_id, user_id, name, base_type, rarity, icon, price_amount, price_currency, ex_value, item_fp, listed_since, detected_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
          ).run(shopId, shop.user_id, m.name, m.base_type, m.rarity, m.icon, m.price_amount, m.price_currency, ex, m.item_fp, m.first_seen_at, t);
          sold.push({ id: Number(r.lastInsertRowid), name: m.name, amount: m.price_amount, currency: m.price_currency, ex });
        }
        db.prepare('DELETE FROM sale_pending WHERE id=?').run(pend.id);
        db.prepare('DELETE FROM listings WHERE id=?').run(m.id);
      }

      for (const i of items) {
        if (claimed.has(i.key)) continue;
        if (prevByKey.has(i.key)) {
          db.prepare('UPDATE listings SET name=?, base_type=?, rarity=?, icon=?, price_amount=?, price_currency=?, stats_json=?, item_fp=?, last_seen_at=?, stash_tab=?, item_level=?, corrupted=? WHERE shop_id=? AND listing_key=?')
            .run(i.name, i.base_type, i.rarity, i.icon, i.price_amount, i.price_currency, JSON.stringify(i.stats), i.fp, t, i.stash_tab, i.item_level, i.corrupted ? 1 : 0, shopId, i.key);
          db.prepare('DELETE FROM sale_pending WHERE shop_id=? AND listing_key=?').run(shopId, i.key);
        } else {
          db.prepare(
            'INSERT INTO listings (shop_id, user_id, listing_key, item_fp, name, base_type, rarity, icon, price_amount, price_currency, stats_json, stash_tab, item_level, corrupted, first_seen_at, last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
          ).run(shopId, shop.user_id, i.key, i.fp, i.name, i.base_type, i.rarity, i.icon, i.price_amount, i.price_currency, JSON.stringify(i.stats), i.stash_tab, i.item_level, i.corrupted ? 1 : 0, t, t);
        }
      }

      snapshot(shopId, 'ok', items.length);
      let total = 0;
      for (const i of items) total += toExalted(i.price_amount, i.price_currency, rates) || 0;
      db.prepare('INSERT INTO shop_value_history (shop_id, taken_at, total_ex, item_count) VALUES (?,?,?,?)').run(shopId, t, total, items.length);
      db.prepare('DELETE FROM shop_value_history WHERE shop_id = ? AND taken_at < ?').run(shopId, t - 45 * 86400);
    });

    // Avisos fuera de la transacción.
    const bigEx = shop.big_sale_amount > 0 ? toExalted(shop.big_sale_amount, shop.big_sale_currency, rates) : null;
    for (const s of sold) {
      const big = bigEx != null && s.ex != null && s.ex >= bigEx;
      await notifyUser(shop.user_id, {
        title: big ? '¡Gran venta!' : '¡Vendiste algo!',
        body: `${s.name} · ${s.amount != null ? `${s.amount} ${s.currency}` : 'sin precio'} (${shop.poe_account})`,
        tag: `sale-${s.id}`,
      });
    }
    return { status: 'ok', count: items.length, sales: sold.length, reprices };
  } finally {
    running.delete(shopId);
  }
}

// ---- Deseos: «avísame cuando X aparezca por menos de Y»
export async function checkWishes(onlyUserId = null) {
  const rows = onlyUserId
    ? db.prepare("SELECT * FROM wishes WHERE status='watching' AND user_id=?").all(onlyUserId)
    : db.prepare("SELECT * FROM wishes WHERE status='watching' ORDER BY COALESCE(last_checked_at,0) LIMIT 40").all();
  const rates = getRates();
  let found = 0;
  for (const w of rows) {
    let res;
    try {
      res = await searchByName(w.item_name, w.league, 4);
    } catch (e) {
      if (e instanceof MarketError && (e.kind === 'rate_limited' || e.kind === 'blocked')) break;
      continue;
    }
    db.prepare('UPDATE wishes SET last_checked_at=? WHERE id=?').run(now(), w.id);
    const maxEx = toExalted(w.max_amount, w.max_currency, rates);
    let best = null;
    for (const it of res.items) {
      const ex = toExalted(it.price_amount, it.price_currency, rates);
      if (ex != null && (!best || ex < best.ex)) best = { ex, it };
    }
    if (best && maxEx != null && best.ex <= maxEx) {
      db.prepare("UPDATE wishes SET status='found', found_amount=?, found_currency=?, found_at=? WHERE id=?").run(best.it.price_amount, best.it.price_currency, now(), w.id);
      found++;
      await notifyUser(w.user_id, { title: '¡Apareció lo que buscabas!', body: `${w.item_name} a ${best.it.price_amount} ${best.it.price_currency}`, url: '/app.html#/deseos', tag: `wish-${w.id}` });
    }
  }
  setState('last:wishes', now());
  return { checked: rows.length, found };
}

// ---- Divisas (exalted por divine y por chaos), en la liga más usada
export function mainLeague() {
  const r = db.prepare('SELECT league, COUNT(*) n FROM shops GROUP BY league ORDER BY n DESC LIMIT 1').get();
  return r ? r.league : config.defaultLeague;
}

export async function refreshCurrencies() {
  const lg = mainLeague();
  const prev = db.prepare('SELECT * FROM currency_price_history ORDER BY taken_at DESC, id DESC LIMIT 1').get();
  let exPerDiv = null;
  let exPerChaos = null;
  try {
    exPerDiv = await exchangeRate(config.currencyIds.exalted, config.currencyIds.divine, lg);
    exPerChaos = await exchangeRate(config.currencyIds.exalted, config.currencyIds.chaos, lg);
  } catch (e) {
    if (!(e instanceof MarketError)) throw e;
  }
  setState('last:currency', now());
  // Si una de las dos tasas falla, se arrastra la última buena en lugar de guardar un hueco.
  const dpe = exPerDiv > 0 ? 1 / exPerDiv : (prev && prev.divine_per_exalted) || null;
  const cpe = exPerChaos > 0 ? 1 / exPerChaos : (prev && prev.chaos_per_exalted) || null;
  if (!(exPerDiv > 0) && !(exPerChaos > 0)) return { updated: false };
  db.prepare('INSERT INTO currency_price_history (taken_at, league, divine_per_exalted, chaos_per_exalted, source) VALUES (?,?,?,?,?)').run(now(), lg, dpe || null, cpe || null, 'exchange');
  return { updated: true };
}
