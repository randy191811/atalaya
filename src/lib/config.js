// Configuración desde variables de entorno. Los secretos nunca se escriben en el código.
// Los datos (cuentas, créditos, claves) viven en DATA_DIR, FUERA de la carpeta que se sirve al navegador.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = process.env;
const bool = (v, d) => (v === undefined ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

const dataDir = path.resolve(env.DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

function loadSecret() {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 24) return env.SESSION_SECRET;
  const f = path.join(dataDir, 'session.secret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

export const config = {
  appName: 'Atalaya',
  port: Number(env.PORT || 3000),
  host: env.HOST || '127.0.0.1',
  dataDir,
  dbPath: path.resolve(env.DB_PATH || path.join(dataDir, 'atalaya.db')),
  sessionSecret: loadSecret(),
  publicOrigin: (env.PUBLIC_ORIGIN || '').replace(/\/$/, ''),
  nodeEnv: env.NODE_ENV || 'development',
  contactEmail: env.CONTACT_EMAIL || env.MARKET_CONTACT || '',

  // Mercado oficial (trade2). MARKET_BASE solo cambia en pruebas locales.
  marketEnabled: bool(env.MARKET_ENABLED, true),
  marketBase: (env.MARKET_BASE || 'https://www.pathofexile.com/api/trade2').replace(/\/$/, ''),
  marketContact: env.MARKET_CONTACT || '',
  marketMinGapMs: Number(env.MARKET_MIN_GAP_MS ?? 3000),
  learnRate: bool(env.MARKET_LEARN_RATE, true),
  backoffBaseSec: Number(env.MARKET_BACKOFF_BASE_SEC || 60),
  realm: 'poe2',
  defaultLeague: env.DEFAULT_LEAGUE || 'Standard',
  // El buscador normal (/search) usa los ID internos del juego para objetos de moneda,
  // pero el cambio rápido (/exchange) usa alias cortos en minúscula.
  currencyIds: {
    chaos: env.CUR_CHAOS || 'chaos',
    exalted: env.CUR_EXALTED || 'exalted',
    divine: env.CUR_DIVINE || 'divine',
  },
  cadence: {
    currency: Number(env.CURRENCY_MIN || 60),
    buyAlerts: Number(env.BUY_ALERTS_MIN || 60),
    reviews: Number(env.REVIEWS_MIN || 15),
  },
  reviewsPerRun: Number(env.REVIEWS_PER_RUN || 4),
  manualCooldownSec: 90,

  // IA: Claude Haiku por defecto, Gemini de respaldo. Las bases solo cambian en pruebas.
  ai: {
    claudeModel: env.CLAUDE_MODEL || 'claude-haiku-4-5',
    geminiModels: (env.GEMINI_MODELS || 'gemini-3.5-flash,gemini-3.6-flash,gemini-flash-latest').split(',').map((s) => s.trim()).filter(Boolean),
    anthropicBase: (env.ANTHROPIC_BASE || 'https://api.anthropic.com').replace(/\/$/, ''),
    geminiBase: (env.GEMINI_BASE || 'https://generativelanguage.googleapis.com').replace(/\/$/, ''),
    perUserPerMin: Number(env.AI_PER_USER_MIN || 6),
    globalPerDay: Number(env.AI_GLOBAL_DAY || 1500),
    maxImageBytes: 5 * 1024 * 1024,
  },

  // Cuentas
  signupMode: env.SIGNUP_MODE === 'invite' ? 'invite' : 'open',
  maxUsers: Number(env.MAX_USERS || 1000),
  // free = página gratis para todos (sin planes de pago a la vista). mock = planes con cobro SIMULADO.
  billingMode: env.BILLING_MODE === 'mock' ? 'mock' : 'free',
  // Límites de todos cuando la página es gratis (el tope de créditos protege tu gasto en IA).
  freePlan: {
    shops: Number(env.FREE_SHOPS || 1),
    intervalMin: Number(env.FREE_INTERVAL_MIN || 10),
    credits: Number(env.FREE_CREDITS || 30),
    wishes: Number(env.FREE_WISHES || 25),
  },
  admin: {
    name: env.ADMIN_NAME || '',
    email: (env.ADMIN_EMAIL || '').toLowerCase(),
    password: env.ADMIN_PASSWORD || '',
  },

  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || '',
  },
};

if (config.nodeEnv === 'production' && !config.publicOrigin) {
  console.warn('[config] PUBLIC_ORIGIN no está definido: la protección de origen será más débil.');
}
