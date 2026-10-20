// Planes, créditos y cobro SIMULADO. Un crédito = una tasación por texto; una captura cuesta 2.
import { db, now, tx } from './db.js';
import { config } from './config.js';

export const COSTS = { texto: 1, captura: 2 };

export const PLANS = {
  gratis: { label: 'Gratis', priceUsd: 0, shops: 1, intervalMin: 30, credits: 5, wishes: 5 },
  pro: { label: 'Pro', priceUsd: 5, shops: 1, intervalMin: 10, credits: 100, wishes: 25 },
  mercader: { label: 'Mercader', priceUsd: 12, shops: 3, intervalMin: 5, credits: 400, wishes: 60 },
};
const ADMIN = { label: 'Administrador', priceUsd: 0, shops: 5, intervalMin: 5, credits: 1000, wishes: 100 };
const MONTH = 30 * 86400;

const isFree = () => config.billingMode === 'free';
const FREE = () => ({ label: 'Gratis', priceUsd: 0, ...config.freePlan });

export function planFor(user) {
  if (user.role === 'admin') return { ...ADMIN, key: 'admin' };
  if (isFree()) return { ...FREE(), key: 'gratis' };
  const key = PLANS[user.plan] ? user.plan : 'gratis';
  return { ...PLANS[key], key };
}

export const publicPlans = () => (isFree() ? [{ key: 'gratis', ...FREE() }] : Object.entries(PLANS).map(([key, p]) => ({ key, ...p })));
export const welcomeCredits = () => planFor({ role: 'member', plan: 'gratis' }).credits;

function ledger(userId, delta, balance, reason) {
  db.prepare('INSERT INTO credit_ledger (user_id, delta, balance_after, reason, created_at) VALUES (?,?,?,?,?)').run(userId, delta, balance, reason, now());
}

// Recarga mensual: se llama al leer la cuenta. Igual que hará el aviso de pago real cuando exista.
export function renewIfDue(userId) {
  return tx(() => {
    const u = db.prepare('SELECT id, role, plan, credits, credits_renew_at FROM users WHERE id = ?').get(userId);
    if (!u || u.credits_renew_at > now()) return false;
    const plan = planFor(u);
    let next = u.credits_renew_at || now();
    while (next <= now()) next += MONTH;
    db.prepare('UPDATE users SET credits = ?, credits_renew_at = ? WHERE id = ?').run(plan.credits, next, u.id);
    ledger(u.id, plan.credits - u.credits, plan.credits, `Recarga mensual (${plan.label})`);
    return true;
  });
}

export function setPlanCredits(userId, planKey, reason) {
  const p = planKey === 'admin' ? ADMIN : PLANS[planKey];
  const u = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
  db.prepare('UPDATE users SET credits = ?, credits_renew_at = ? WHERE id = ?').run(p.credits, now() + MONTH, userId);
  ledger(userId, p.credits - (u ? u.credits : 0), p.credits, reason);
}

// Reserva ANTES de llamar a la IA. Devuelve false si no alcanza (no se toca nada).
export function reserveCredits(userId, cost, reason) {
  return tx(() => {
    const u = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
    if (!u || u.credits < cost) return false;
    const r = db.prepare('UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?').run(cost, userId, cost);
    if (r.changes !== 1) return false;
    ledger(userId, -cost, u.credits - cost, reason);
    return true;
  });
}

export function refundCredits(userId, cost, reason) {
  tx(() => {
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(cost, userId);
    const u = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
    ledger(userId, cost, u.credits, reason);
  });
}

export const creditsOf = (userId) => db.prepare('SELECT credits, credits_renew_at FROM users WHERE id = ?').get(userId);
