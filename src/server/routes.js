// API JSON. Cada ruta valida su entrada y solo toca datos de quien la pide.
import crypto from 'node:crypto';
import { db, now, tx, migrationCount } from '../lib/db.js';
import { config } from '../lib/config.js';
import {
  registerUser, login, createSession, cookieHeader, clearCookieHeader, userFromRequest, destroySession,
  tooMany, verifyPassword, hashPassword,
} from '../lib/auth.js';
import { encrypt, decrypt } from '../lib/secrets.js';
import { PLANS, COSTS, planFor, publicPlans, renewIfDue, setPlanCredits, creditsOf } from '../lib/plans.js';
import { getRates, toExalted, canon } from '../lib/money.js';
import { vapidPublicKey, selfTest } from '../lib/webpush.js';
import { hasAnyKey, keyStatus, detectProvider, validateKey, saveKey } from '../lib/ai.js';
import { appraise, TasadorError } from '../lib/tasador.js';
import { queueStatus, isBlocked } from '../worker/queue.js';
import { checkShop, checkWishes, isRunning, notifyUser, mainLeague } from '../worker/jobs.js';
import { reviewListing, verdictFrom } from '../worker/reviews.js';
import { runDiagnostic } from '../worker/diagnostico.js';
import { listLeagues, currentLeague, debugRawShopItem } from '../worker/trade2.js';
import { MarketError } from '../worker/queue.js';

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const bad = (m) => new HttpError(400, m);

async function readJson(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Lo que enviaste es demasiado grande.');
    chunks.push(c);
  }
  if (!size) return {};
  if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Formato no admitido.');
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw bad('Lo que enviaste no es válido.');
  }
}

export function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  const loop = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const xff = req.headers['x-forwarded-for'];
  return loop && xff ? String(xff).split(',')[0].trim() : remote;
}
const isSecure = () => config.publicOrigin.startsWith('https');

const needUser = (req) => {
  const u = userFromRequest(req);
  if (!u) throw new HttpError(401, 'Inicia sesión para continuar.');
  return u;
};
const CURRENCIES = ['exalted', 'divine', 'chaos'];
// El mercado identifica la cuenta como «Nombre#1234»: sin el número no devuelve nada nunca,
// así que se exige aquí en vez de dejar la tienda vacía para siempre sin explicación.
const accountRe = /^[\p{L}\p{N}_\-. ]{2,30}#\d{1,6}$/u;
const ACCOUNT_HELP = 'Escribe tu cuenta de Path of Exile con el número que va detrás de la almohadilla, tal como aparece en el mercado (por ejemplo Randy#1234).';
const sum = (a) => a.reduce((x, y) => x + y, 0);

// ---------- vistas
function meView(u) {
  renewIfDue(u.id);
  const plan = planFor(u);
  const c = creditsOf(u.id);
  const pf = db.prepare('SELECT push_enabled FROM notification_prefs WHERE user_id = ?').get(u.id);
  const devices = db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(u.id).n;
  const unseen = db.prepare('SELECT COUNT(*) n FROM sales WHERE user_id = ? AND seen = 0').get(u.id).n;
  return {
    user: { id: u.id, name: u.name, email: u.email, role: u.role },
    plan: { key: plan.key, label: plan.label, shops: plan.shops, intervalMin: plan.intervalMin, credits: plan.credits, wishes: plan.wishes },
    credits: c.credits,
    renewsAt: c.credits_renew_at,
    costs: COSTS,
    plans: publicPlans(),
    billingMode: config.billingMode,
    aiReady: hasAnyKey(),
    push: { enabled: !!(pf && pf.push_enabled), devices, key: vapidPublicKey },
    unseenSales: unseen,
    appraisalsCount: db.prepare('SELECT COUNT(*) n FROM appraisals WHERE user_id = ?').get(u.id).n,
    shopsCount: db.prepare('SELECT COUNT(*) n FROM shops WHERE user_id = ?').get(u.id).n,
    defaultLeague: config.defaultLeague,
  };
}

function shopHealth(shop, intervalMin) {
  const last = db.prepare('SELECT * FROM snapshots WHERE shop_id = ? ORDER BY taken_at DESC, id DESC LIMIT 1').get(shop.id);
  const lastOk = db.prepare("SELECT taken_at FROM snapshots WHERE shop_id = ? AND status = 'ok' ORDER BY taken_at DESC LIMIT 1").get(shop.id);
  let state = 'ok';
  if (shop.paused) state = 'paused';
  else if (!last) state = 'never';
  else if (last.status === 'rate_limited') state = 'limited';
  else if (last.status === 'error') state = 'error';
  else if (last.status === 'no_data') state = 'verifying';
  else if (now() - last.taken_at > intervalMin * 60 * 3) state = 'stale';
  return { state, lastAt: last ? last.taken_at : null, lastOkAt: lastOk ? lastOk.taken_at : null, nextAt: last ? last.taken_at + intervalMin * 60 : null };
}

function shopView(shop, plan, rates) {
  const t = now();
  const reviews = new Map(db.prepare('SELECT * FROM listing_reviews WHERE shop_id = ?').all(shop.id).map((x) => [x.item_fp, x]));
  const listings = db.prepare('SELECT * FROM listings WHERE shop_id = ? ORDER BY first_seen_at DESC').all(shop.id).map((r) => {
    let stats = [];
    let detail = null;
    try { stats = JSON.parse(r.stats_json || '[]'); } catch {}
    try { detail = JSON.parse(r.detail_json || 'null'); } catch {}
    return {
      detail,
      review: reviewView(reviews.get(r.item_fp), rates, toExalted(r.price_amount, r.price_currency, rates)),
      id: r.id, name: r.name, base_type: r.base_type, rarity: r.rarity, icon: r.icon, stash_tab: r.stash_tab,
      price_amount: r.price_amount, price_currency: r.price_currency, ex: toExalted(r.price_amount, r.price_currency, rates),
      item_level: r.item_level || null, corrupted: !!r.corrupted,
      stats, days: Math.max(0, Math.floor((t - r.first_seen_at) / 86400)),
    };
  });
  const hist = db.prepare('SELECT taken_at, total_ex, item_count FROM shop_value_history WHERE shop_id = ? AND taken_at > ? ORDER BY taken_at').all(shop.id, t - 30 * 86400);
  return {
    id: shop.id, account: shop.poe_account, league: shop.league, paused: !!shop.paused,
    hasSession: !!shop.poe_session_enc,
    bigSale: shop.big_sale_amount > 0 ? { amount: shop.big_sale_amount, currency: shop.big_sale_currency } : null,
    health: shopHealth(shop, plan.intervalMin),
    running: isRunning(shop.id),
    cooldownUntil: shop.last_manual_at ? shop.last_manual_at + config.manualCooldownSec : null,
    listings,
    valueEx: sum(listings.map((l) => l.ex || 0)),
    history: hist,
  };
}

// Precio sugerido = mediana de los 5 anuncios parecidos más baratos, en divine si llega a 1, si no en exalted.
function suggestPrice(ex, rates) {
  if (!(ex > 0)) return null;
  if (ex >= rates.exPerDiv) return { amount: Math.round((ex / rates.exPerDiv) * 10) / 10, currency: 'divine' };
  return { amount: Math.max(1, Math.round(ex)), currency: 'exalted' };
}
// El veredicto se recalcula con el precio actual (si bajaste el precio, deja de salir «caro» al momento).
function reviewView(r, rates, ownEx) {
  if (!r) return null;
  let verdict = r.verdict;
  if (verdict !== 'sin_datos' && ownEx != null && r.comp_median_ex > 0) {
    verdict = verdictFrom(ownEx, r.comp_min_ex, r.comp_median_ex);
  }
  return { verdict, count: r.comp_count, minEx: r.comp_min_ex, medianEx: r.comp_median_ex, checkedAt: r.checked_at, suggested: verdict === 'caro' ? suggestPrice(r.comp_median_ex, rates) : null };
}

function accountView(u) {
  const sub = db.prepare('SELECT plan, status, started_at, renews_at FROM subscriptions WHERE user_id = ?').get(u.id) || null;
  const payments = db.prepare('SELECT plan, amount_usd, created_at, note FROM mock_payments WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 8').all(u.id);
  const ledger = db.prepare('SELECT delta, balance_after, reason, created_at FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 15').all(u.id);
  return { sub, payments, ledger };
}

function enforceShopLimit(userId, plan) {
  const shops = db.prepare('SELECT id FROM shops WHERE user_id = ? ORDER BY id').all(userId);
  shops.forEach((s, i) => db.prepare('UPDATE shops SET paused = ? WHERE id = ?').run(i < plan.shops ? 0 : 1, s.id));
}

function ownShop(u, id) {
  const s = db.prepare('SELECT * FROM shops WHERE id = ? AND user_id = ?').get(Number(id), u.id);
  if (!s) throw new HttpError(404, 'No encuentro esa tienda.');
  return s;
}

function readMoney(o, label) {
  const amount = Number(o && o.amount);
  const currency = canon(o && o.currency);
  if (!(amount > 0) || amount > 1e6 || !CURRENCIES.includes(currency)) throw bad(`Revisa ${label}: pon una cantidad y una moneda (exalted, divine o chaos).`);
  return { amount, currency };
}

// ---------- rutas
export async function handleApi(req, res, url, send, setCookie) {
  const path = url.pathname;
  const m = req.method;
  const ip = clientIp(req);
  let mm;

  if (path === '/api/health' && m === 'GET') {
    return send(200, { ok: true, migrations: migrationCount(), market: { blocked: isBlocked() }, push: selfTest(), ai: hasAnyKey() });
  }
  if (path === '/api/planes' && m === 'GET') return send(200, { plans: publicPlans(), costs: COSTS, billingMode: config.billingMode });

  if (path === '/api/registro' && m === 'POST') {
    if (tooMany(`reg:${ip}`, 8, 3600)) throw new HttpError(429, 'Demasiados intentos. Espera un rato.');
    const r = await registerUser(await readJson(req));
    if (r.error) throw bad(r.error);
    setCookie(cookieHeader(createSession(r.id), isSecure()));
    return send(201, { ok: true });
  }
  if (path === '/api/login' && m === 'POST') {
    if (tooMany(`login:${ip}`, 5, 900)) throw new HttpError(429, 'Demasiados intentos. Espera 15 minutos.');
    const b = await readJson(req);
    const u = await login(b.email, b.password);
    if (!u) throw new HttpError(401, 'Correo o contraseña incorrectos.');
    setCookie(cookieHeader(createSession(u.id), isSecure()));
    return send(200, { ok: true });
  }
  if (path === '/api/logout' && m === 'POST') {
    const u = userFromRequest(req);
    if (u) destroySession(u.sessionToken);
    setCookie(clearCookieHeader(isSecure()));
    return send(200, { ok: true });
  }
  // Aviso de la pasarela de pago. En modo demo no hace nada (se rellenará al pasar a cobros reales).
  if (path === '/api/webhook' && m === 'POST') return send(200, { ok: true, mode: config.billingMode });
  // Las ligas son información pública del juego: así el formulario ya las trae al entrar.
  if (path === '/api/ligas' && m === 'GET') {
    const leagues = await listLeagues();
    return send(200, { leagues, suggested: await currentLeague(), default: config.defaultLeague });
  }

  const u = needUser(req);

  if (path === '/api/yo' && m === 'GET') return send(200, meView(u));

  // ----- tiendas
  if (path === '/api/tiendas' && m === 'GET') {
    const plan = planFor(u);
    const rates = getRates();
    const shops = db.prepare('SELECT * FROM shops WHERE user_id = ? ORDER BY id').all(u.id).map((s) => shopView(s, plan, rates));
    return send(200, { shops, rates, limit: plan.shops, intervalMin: plan.intervalMin, marketBlocked: isBlocked() });
  }
  if (path === '/api/tiendas' && m === 'POST') {
    const plan = planFor(u);
    const n = db.prepare('SELECT COUNT(*) n FROM shops WHERE user_id = ?').get(u.id).n;
    if (n >= plan.shops) throw new HttpError(402, config.billingMode === 'free' ? `Por ahora cada cuenta vigila ${plan.shops === 1 ? '1 tienda' : plan.shops + ' tiendas'}.` : `Tu plan ${plan.label} vigila ${plan.shops === 1 ? '1 tienda' : plan.shops + ' tiendas'}. Mejora tu plan para añadir más.`, { needPlan: config.billingMode !== 'free' });
    const b = await readJson(req);
    const account = String(b.account || '').trim();
    const league = String(b.league || config.defaultLeague).trim().slice(0, 60);
    if (!accountRe.test(account)) throw bad(ACCOUNT_HELP);
    if (league.length < 2) throw bad('Elige la liga en la que juegas.');
    if (db.prepare('SELECT 1 FROM shops WHERE user_id = ? AND lower(poe_account) = lower(?) AND league = ?').get(u.id, account, league)) throw bad('Ya vigilas esa tienda en esa liga.');
    const r = db.prepare('INSERT INTO shops (user_id, poe_account, league, created_at) VALUES (?,?,?,?)').run(u.id, account, league, now());
    enforceShopLimit(u.id, plan);
    return send(201, { id: Number(r.lastInsertRowid) });
  }
  if ((mm = path.match(/^\/api\/tiendas\/(\d+)$/))) {
    const shop = ownShop(u, mm[1]);
    if (m === 'DELETE') {
      tx(() => {
        for (const tbl of ['listings', 'snapshots', 'sale_pending', 'shop_value_history', 'listing_reviews']) db.prepare(`DELETE FROM ${tbl} WHERE shop_id = ?`).run(shop.id);
        db.prepare('DELETE FROM shops WHERE id = ?').run(shop.id);
      });
      enforceShopLimit(u.id, planFor(u));
      return send(200, { ok: true });
    }
    if (m === 'PATCH') {
      const b = await readJson(req);
      // Cambiar la cuenta o la liga deja los anuncios anteriores sin sentido: se vacían
      // (las ventas ya apuntadas no se tocan) y la próxima lectura empieza de cero.
      const resetListings = () => {
        for (const tbl of ['listings', 'sale_pending']) db.prepare(`DELETE FROM ${tbl} WHERE shop_id = ?`).run(shop.id);
      };
      if (b.account !== undefined) {
        const acc = String(b.account).trim();
        if (!accountRe.test(acc)) throw bad(ACCOUNT_HELP);
        if (acc.toLowerCase() !== shop.poe_account.toLowerCase()) {
          if (db.prepare('SELECT 1 FROM shops WHERE user_id = ? AND id != ? AND lower(poe_account) = lower(?) AND league = ?').get(u.id, shop.id, acc, shop.league)) {
            throw bad('Ya vigilas esa cuenta en esta liga.');
          }
          tx(() => {
            db.prepare('UPDATE shops SET poe_account = ? WHERE id = ?').run(acc, shop.id);
            resetListings();
          });
        }
      }
      if (b.league !== undefined) {
        const lg = String(b.league).trim().slice(0, 60);
        if (lg.length < 2) throw bad('Escribe el nombre de la liga.');
        if (lg !== shop.league) tx(() => {
          db.prepare('UPDATE shops SET league = ? WHERE id = ?').run(lg, shop.id);
          resetListings();
        });
      }
      if (b.session !== undefined) {
        const s = String(b.session || '').trim();
        if (s && !/^[a-f0-9]{32}$/i.test(s)) throw bad('El código de sesión de Path of Exile tiene 32 letras y números (0-9, a-f).');
        db.prepare('UPDATE shops SET poe_session_enc = ? WHERE id = ?').run(s ? encrypt(s) : null, shop.id);
      }
      if (b.bigSale !== undefined) {
        if (b.bigSale === null) db.prepare('UPDATE shops SET big_sale_amount = NULL, big_sale_currency = NULL WHERE id = ?').run(shop.id);
        else {
          const v = readMoney(b.bigSale, 'el umbral de gran venta');
          db.prepare('UPDATE shops SET big_sale_amount = ?, big_sale_currency = ? WHERE id = ?').run(v.amount, v.currency, shop.id);
        }
      }
      return send(200, { ok: true });
    }
  }
  if ((mm = path.match(/^\/api\/tiendas\/(\d+)\/revisar$/)) && m === 'POST') {
    const shop = ownShop(u, mm[1]);
    if (shop.paused) throw bad('Esta tienda está en pausa porque tu plan vigila menos tiendas.');
    const t = now();
    if (shop.last_manual_at && t - shop.last_manual_at < config.manualCooldownSec) {
      throw new HttpError(429, `Espera ${config.manualCooldownSec - (t - shop.last_manual_at)} s para volver a revisar.`);
    }
    if (isBlocked()) throw new HttpError(429, 'El mercado oficial pidió una pausa. Se reanudará solo.');
    db.prepare('UPDATE shops SET last_manual_at = ? WHERE id = ?').run(t, shop.id);
    const r = await checkShop(shop.id);
    return send(200, r);
  }

  if ((mm = path.match(/^\/api\/tiendas\/(\d+)\/objetos\/(\d+)\/comparar$/)) && m === 'POST') {
    const shop = ownShop(u, mm[1]);
    const l = db.prepare('SELECT * FROM listings WHERE id = ? AND shop_id = ?').get(Number(mm[2]), shop.id);
    if (!l) throw new HttpError(404, 'Ese objeto ya no está en tu tienda.');
    if (tooMany(`cmp:${u.id}`, 12, 3600)) throw new HttpError(429, 'Ya comparaste muchos objetos esta hora. El revisor sigue solo en segundo plano.');
    if (isBlocked()) throw new HttpError(429, 'El mercado oficial pidió una pausa. Se reanudará solo.');
    try {
      const r = await reviewListing(l, shop.league);
      const row = db.prepare('SELECT * FROM listing_reviews WHERE shop_id = ? AND item_fp = ?').get(shop.id, l.item_fp);
      const rt = getRates();
      return send(200, { review: reviewView(row, rt, toExalted(l.price_amount, l.price_currency, rt)), count: r.count });
    } catch (e) {
      // Cada motivo se cuenta tal cual, en vez de esconderlo todo tras el mismo mensaje.
      if (e instanceof HttpError) throw e;
      if (e instanceof MarketError) {
        if (e.kind === 'rate_limited' || e.kind === 'blocked') throw new HttpError(429, 'El mercado oficial pidió una pausa. Se reanudará solo en unos minutos.');
        if (e.kind === 'network') throw new HttpError(503, 'No se pudo conectar con el mercado oficial. Prueba en un rato.');
        throw new HttpError(503, `El mercado no aceptó la consulta (${e.message}).`);
      }
      console.error('[comparar]', e && e.stack ? e.stack : e);
      throw new HttpError(503, 'No pude consultar el mercado ahora. Prueba en un rato.');
    }
  }

  // ----- ventas
  if (path === '/api/ventas' && m === 'GET') {
    const rates = getRates();
    const t = now();
    const rows = db.prepare(
      `SELECT v.*, s.poe_account FROM sales v LEFT JOIN shops s ON s.id = v.shop_id WHERE v.user_id = ? ORDER BY v.detected_at DESC LIMIT 300`
    ).all(u.id).map((r) => ({
      id: r.id, name: r.name, base_type: r.base_type, rarity: r.rarity, icon: r.icon, shop: r.poe_account, shop_id: r.shop_id,
      price_amount: r.price_amount, price_currency: r.price_currency, ex: toExalted(r.price_amount, r.price_currency, rates) ?? r.ex_value,
      days_listed: r.listed_since ? Math.max(0, Math.round((r.detected_at - r.listed_since) / 86400)) : null,
      detected_at: r.detected_at, seen: !!r.seen,
    }));
    const win = (d) => rows.filter((r) => r.detected_at > t - d * 86400);
    return send(200, {
      sales: rows, rates,
      shops: db.prepare('SELECT id, poe_account, league FROM shops WHERE user_id = ? ORDER BY id').all(u.id),
      totals: { d7: { n: win(7).length, ex: sum(win(7).map((r) => r.ex || 0)) }, d30: { n: win(30).length, ex: sum(win(30).map((r) => r.ex || 0)) } },
    });
  }
  if (path === '/api/ventas/vistas' && m === 'POST') {
    db.prepare('UPDATE sales SET seen = 1 WHERE user_id = ? AND seen = 0').run(u.id);
    return send(200, { ok: true });
  }

  // ----- mercado
  if (path === '/api/mercado' && m === 'GET') {
    const t = now();
    const hist = db.prepare('SELECT taken_at, divine_per_exalted, chaos_per_exalted FROM currency_price_history WHERE taken_at > ? ORDER BY taken_at').all(t - 7 * 86400)
      .map((r) => ({ t: r.taken_at, exPerDiv: r.divine_per_exalted > 0 ? 1 / r.divine_per_exalted : null, exPerChaos: r.chaos_per_exalted > 0 ? 1 / r.chaos_per_exalted : null }));
    return send(200, { rates: getRates(), history: hist, league: mainLeague(), queue: { blocked: isBlocked() } });
  }

  // ----- deseos
  if (path === '/api/deseos' && m === 'GET') {
    const rows = db.prepare('SELECT * FROM wishes WHERE user_id = ? ORDER BY status DESC, created_at DESC').all(u.id);
    return send(200, { wishes: rows, limit: planFor(u).wishes });
  }
  if (path === '/api/deseos' && m === 'POST') {
    const plan = planFor(u);
    const n = db.prepare("SELECT COUNT(*) n FROM wishes WHERE user_id = ? AND status = 'watching'").get(u.id).n;
    if (n >= plan.wishes) throw new HttpError(402, config.billingMode === 'free' ? `Puedes tener ${plan.wishes} deseos activos. Quita alguno para añadir otro.` : `Tu plan permite ${plan.wishes} deseos activos.`, { needPlan: config.billingMode !== 'free' });
    const b = await readJson(req);
    const name = String(b.name || '').trim().slice(0, 80);
    if (name.length < 3) throw bad('Escribe el nombre exacto del objeto (por ejemplo «Headhunter»).');
    const v = readMoney(b.max, 'el precio máximo');
    const lg = String(b.league || '').trim().slice(0, 60) || (db.prepare('SELECT league FROM shops WHERE user_id = ? ORDER BY id LIMIT 1').get(u.id) || {}).league || config.defaultLeague;
    const r = db.prepare('INSERT INTO wishes (user_id, item_name, league, max_amount, max_currency, created_at) VALUES (?,?,?,?,?,?)').run(u.id, name, lg, v.amount, v.currency, now());
    return send(201, { id: Number(r.lastInsertRowid) });
  }
  if ((mm = path.match(/^\/api\/deseos\/(\d+)$/)) && m === 'DELETE') {
    db.prepare('DELETE FROM wishes WHERE id = ? AND user_id = ?').run(Number(mm[1]), u.id);
    return send(200, { ok: true });
  }
  if (path === '/api/deseos/revisar' && m === 'POST') {
    if (tooMany(`wish:${u.id}`, 2, 600)) throw new HttpError(429, 'Ya revisaste hace poco. Prueba en unos minutos.');
    return send(200, await checkWishes(u.id));
  }

  // ----- tasador con IA
  if (path === '/api/tasar' && m === 'POST') {
    if (!hasAnyKey()) throw new HttpError(503, 'El tasador aún no está encendido: falta que el administrador guarde la clave de la IA.');
    const b = await readJson(req, 8 * 1024 * 1024);
    try {
      const r = await appraise(u, {
        kind: b.kind === 'captura' ? 'captura' : 'texto',
        text: typeof b.text === 'string' ? b.text.slice(0, 6000) : '',
        image: b.image && typeof b.image === 'object' ? { mime: String(b.image.mime || ''), base64: String(b.image.base64 || '') } : null,
        // Sin liga explícita se usa la de su tienda (lo hace el propio tasador).
        league: typeof b.league === 'string' && b.league.trim() ? b.league.trim().slice(0, 60) : null,
      });
      return send(200, { ...r, credits: creditsOf(u.id).credits });
    } catch (e) {
      if (e instanceof TasadorError) throw new HttpError(e.status, e.message, { ...(e.extra || {}), credits: creditsOf(u.id).credits });
      throw e;
    }
  }
  if (path === '/api/tasaciones' && m === 'GET') {
    const rows = db.prepare('SELECT id, kind, item_name, item_json, result_json, cost, created_at FROM appraisals WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(u.id)
      .map((r) => ({ id: r.id, kind: r.kind, item_name: r.item_name, cost: r.cost, created_at: r.created_at, item: JSON.parse(r.item_json || 'null'), result: JSON.parse(r.result_json) }));
    return send(200, { appraisals: rows });
  }

  // ----- cuenta y cobro SIMULADO (no se pide ni se guarda ningún dato de tarjeta)
  if (path === '/api/cuenta' && m === 'GET') return send(200, { ...meView(u), ...accountView(u) });
  if ((path === '/api/checkout' || path === '/api/cancelar') && m === 'POST' && config.billingMode === 'free') {
    throw bad('Atalaya es gratis por ahora: no hay planes de pago.');
  }
  if (path === '/api/checkout' && m === 'POST') {
    if (u.role === 'admin') throw bad('Tu cuenta de administración ya tiene todo incluido.');
    const b = await readJson(req);
    const key = String(b.plan || '');
    if (!PLANS[key] || key === 'gratis') throw bad('Elige el plan Pro o Mercader.');
    const cur = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(u.id);
    if (cur && cur.status === 'active' && cur.plan === key) throw bad(`Ya tienes el plan ${PLANS[key].label}.`);
    const t = now();
    tx(() => {
      db.prepare("INSERT INTO subscriptions (user_id, plan, status, started_at, renews_at, mock) VALUES (?, ?, 'active', ?, ?, 1) ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan, status='active', started_at=excluded.started_at, renews_at=excluded.renews_at")
        .run(u.id, key, t, t + 30 * 86400);
      db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(key, u.id);
      db.prepare('INSERT INTO mock_payments (user_id, plan, amount_usd, created_at, note) VALUES (?,?,?,?,?)').run(u.id, key, PLANS[key].priceUsd, t, 'Pago simulado (MODO DEMO)');
      setPlanCredits(u.id, key, `Plan ${PLANS[key].label} activado (simulado)`);
    });
    enforceShopLimit(u.id, planFor({ ...u, plan: key }));
    return send(200, { ...meView({ ...u, plan: key }), ...accountView(u) });
  }
  if (path === '/api/cancelar' && m === 'POST') {
    const cur = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(u.id);
    if (!cur || cur.status !== 'active') throw bad('No tienes una suscripción activa.');
    tx(() => {
      db.prepare("UPDATE subscriptions SET status = 'canceled', renews_at = NULL WHERE user_id = ?").run(u.id);
      db.prepare("UPDATE users SET plan = 'gratis' WHERE id = ?").run(u.id);
    });
    enforceShopLimit(u.id, planFor({ ...u, plan: 'gratis' }));
    return send(200, { ...meView({ ...u, plan: 'gratis' }), ...accountView(u) });
  }
  if (path === '/api/clave' && m === 'POST') {
    const b = await readJson(req);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.id);
    if (!(await verifyPassword(String(b.current || ''), row.password_hash))) throw bad('La contraseña actual no coincide.');
    if (String(b.next || '').length < 10) throw bad('La nueva contraseña necesita al menos 10 caracteres.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(String(b.next)), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(u.id, u.sessionToken);
    return send(200, { ok: true });
  }

  // ----- avisos en el móvil
  if (path === '/api/push/suscribir' && m === 'POST') {
    const b = await readJson(req);
    const ep = String(b.endpoint || '');
    const k = b.keys || {};
    if (!/^https:\/\//.test(ep) || ep.length > 1000 || !k.p256dh || !k.auth) throw bad('La suscripción no es válida.');
    tx(() => {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(ep);
      db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?)').run(u.id, ep, String(k.p256dh), String(k.auth), now());
      db.prepare('UPDATE notification_prefs SET push_enabled = 1, updated_at = ? WHERE user_id = ?').run(now(), u.id);
    });
    return send(201, { ok: true });
  }
  if (path === '/api/push/quitar' && m === 'POST') {
    const b = await readJson(req);
    if (b.endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(String(b.endpoint), u.id);
    if (!db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(u.id).n) {
      db.prepare('UPDATE notification_prefs SET push_enabled = 0, updated_at = ? WHERE user_id = ?').run(now(), u.id);
    }
    return send(200, { ok: true });
  }
  if (path === '/api/push/prueba' && m === 'POST') {
    if (tooMany(`pushtest:${u.id}`, 5, 600)) throw new HttpError(429, 'Demasiadas pruebas seguidas.');
    return send(200, { delivered: await notifyUser(u.id, { title: 'Atalaya', body: 'Si ves esto, los avisos funcionan.', url: '/app.html#/cuenta', tag: 'test' }) });
  }

  // ----- administración
  if (path.startsWith('/api/admin')) {
    if (u.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede hacer esto.');
    if (path === '/api/admin' && m === 'GET') {
      const users = db.prepare('SELECT u.id, u.name, u.email, u.role, u.plan, u.credits, u.created_at, (SELECT COUNT(*) FROM shops WHERE user_id = u.id) AS shops FROM users u ORDER BY u.id DESC LIMIT 200').all();
      const ai = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(cost),0) c FROM appraisals WHERE created_at > ?').get(now() - 86400);
      return send(200, { users, keys: keyStatus(), queue: queueStatus(), aiToday: ai, signupMode: config.signupMode });
    }
    if (path === '/api/admin/clave-ia' && m === 'POST') {
      if (tooMany(`aikey:${u.id}`, 10, 600)) throw new HttpError(429, 'Demasiados intentos seguidos.');
      const b = await readJson(req);
      const key = String(b.key || '').trim();
      if (key.length < 20 || key.length > 300 || /\s/.test(key)) throw bad('Eso no parece una clave. Cópiala entera, sin espacios.');
      const provider = detectProvider(key);
      const v = await validateKey(provider, key);
      if (!v.ok) throw bad(v.message);
      saveKey(provider, key);
      return send(200, { ok: true, provider, keys: keyStatus() });
    }
    if ((mm = path.match(/^\/api\/admin\/clave-ia\/(anthropic|gemini)$/)) && m === 'DELETE') {
      saveKey(mm[1], null);
      return send(200, { ok: true, keys: keyStatus() });
    }
    if (path === '/api/admin/diagnostico' && m === 'POST') {
      if (tooMany(`diag:${u.id}`, 4, 600)) throw new HttpError(429, 'Espera unos minutos entre pruebas para no saturar el mercado.');
      const shop = db.prepare('SELECT * FROM shops WHERE user_id = ? ORDER BY id LIMIT 1').get(u.id);
      return send(200, await runDiagnostic(shop));
    }
    if (path === '/api/admin/depurar-objeto' && m === 'GET') {
      if (tooMany(`depurar:${u.id}`, 6, 600)) throw new HttpError(429, 'Espera unos minutos.');
      const shop = db.prepare('SELECT * FROM shops WHERE user_id = ? ORDER BY id LIMIT 1').get(u.id);
      if (!shop) throw bad('Añade primero una tienda.');
      const raw = await debugRawShopItem(shop.poe_account, shop.league, decrypt(shop.poe_session_enc) || undefined);
      return send(200, { raw });
    }
    if (path === '/api/admin/invitacion' && m === 'POST') {
      const token = crypto.randomBytes(18).toString('base64url');
      db.prepare('INSERT INTO invite_tokens (token, created_by, expires_at, created_at) VALUES (?,?,?,?)').run(token, u.id, now() + 7 * 86400, now());
      return send(201, { token });
    }
  }

  throw new HttpError(404, 'No existe esa ruta.');
}
