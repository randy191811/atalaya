// Cuentas: contraseñas con scrypt, sesiones en la base de datos, cookie httpOnly firmada.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db, now, tx } from './db.js';
import { config } from './config.js';
import { safeEqual } from './secrets.js';
import { welcomeCredits } from './plans.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 30;

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64url')}$${h.toString('base64url')}`;
}

export async function verifyPassword(pw, stored) {
  try {
    const [alg, n, salt, hash] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const h = await scrypt(pw, Buffer.from(salt, 'base64url'), 64, { N: Number(n), r: 8, p: 1 });
    return crypto.timingSafeEqual(h, Buffer.from(hash, 'base64url'));
  } catch {
    return false;
  }
}

const sign = (t) => crypto.createHmac('sha256', config.sessionSecret).update(t).digest('base64url');

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const t = now();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(token, userId, t + SESSION_DAYS * 86400, t);
  return token;
}

export const cookieValue = (token) => `${token}.${sign(token)}`;

export function cookieHeader(token, secure) {
  const attrs = [`sid=${cookieValue(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export const clearCookieHeader = (secure) => `sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// Devuelve el usuario de la sesión (y renueva la expiración si falta menos de la mitad).
export function userFromRequest(req) {
  const raw = parseCookies(req.headers.cookie).sid;
  if (!raw) return null;
  const [token, sig] = raw.split('.');
  if (!token || !sig || !safeEqual(sig, sign(token))) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s || s.expires_at < now()) return null;
  const u = db.prepare('SELECT id, name, email, role, plan, credits, credits_renew_at, created_at FROM users WHERE id = ?').get(s.user_id);
  if (!u) return null;
  if (s.expires_at - now() < (SESSION_DAYS * 86400) / 2) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(now() + SESSION_DAYS * 86400, token);
  }
  u.sessionToken = token;
  return u;
}

export const destroySession = (token) => db.prepare('DELETE FROM sessions WHERE token = ?').run(token);

const emailRe = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function registerUser({ name, email, password, inviteToken }) {
  name = String(name || '').trim().slice(0, 40);
  email = String(email || '').trim().toLowerCase();
  password = String(password || '');
  if (name.length < 2) return { error: 'Escribe tu nombre (mínimo 2 letras).' };
  if (!emailRe.test(email)) return { error: 'Ese correo no parece válido.' };
  if (password.length < 10) return { error: 'La contraseña necesita al menos 10 caracteres.' };

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const first = count === 0;
  if (!first && count >= config.maxUsers) return { error: 'El servicio está lleno por ahora. Vuelve a intentarlo más adelante.' };

  let invite = null;
  if (!first && config.signupMode === 'invite') {
    invite = db.prepare('SELECT * FROM invite_tokens WHERE token = ?').get(String(inviteToken || ''));
    if (!invite || invite.used_at || invite.expires_at < now()) return { error: 'La invitación no es válida o ya venció.' };
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return { error: 'Ya existe una cuenta con ese correo.' };

  const hash = await hashPassword(password);
  const id = tx(() => {
    const t = now();
    const r = db
      .prepare('INSERT INTO users (name, email, password_hash, role, plan, credits, credits_renew_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(name, email, hash, first ? 'admin' : 'member', 'gratis', first ? 1000 : welcomeCredits(), t + 30 * 86400, t);
    const uid = Number(r.lastInsertRowid);
    db.prepare('INSERT INTO credit_ledger (user_id, delta, balance_after, reason, created_at) VALUES (?,?,?,?,?)').run(uid, first ? 1000 : welcomeCredits(), first ? 1000 : welcomeCredits(), 'Créditos de bienvenida', t);
    db.prepare('INSERT INTO notification_prefs (user_id, push_enabled, updated_at) VALUES (?, 0, ?)').run(uid, t);
    if (invite) db.prepare('UPDATE invite_tokens SET used_by = ?, used_at = ? WHERE token = ?').run(uid, t, invite.token);
    return uid;
  });
  return { id };
}

export async function login(email, password) {
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  // Se compara siempre algo para no revelar si el correo existe por el tiempo de respuesta.
  const ok = await verifyPassword(String(password || ''), u ? u.password_hash : 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA$AAAA');
  return u && ok ? u : null;
}

// Cuenta de administración desde variables de entorno (opcional, no rota nada si ya existe).
export async function seedAdmin() {
  const a = config.admin;
  if (!a.email || a.password.length < 10) return false;
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(a.email)) return false;
  const hash = await hashPassword(a.password);
  const r = db
    .prepare("INSERT INTO users (name, email, password_hash, role, plan, credits, credits_renew_at, created_at) VALUES (?, ?, ?, 'admin', 'gratis', 1000, ?, ?)")
    .run(a.name || 'Admin', a.email, hash, now() + 30 * 86400, now());
  db.prepare('INSERT OR IGNORE INTO notification_prefs (user_id, push_enabled, updated_at) VALUES (?, 0, ?)').run(Number(r.lastInsertRowid), now());
  return true;
}

// Limitador sencillo en memoria para intentos de entrada/registro.
const hits = new Map();
export function tooMany(key, max, windowSec) {
  const t = Date.now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowSec * 1000);
  arr.push(t);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > windowSec * 1000) hits.delete(k);
  return arr.length > max;
}
