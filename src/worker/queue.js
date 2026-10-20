// Cola única y serial hacia el mercado oficial, con disciplina de ritmo:
//  - una petición a la vez, con pausa adaptativa leída de las cabeceras X-Rate-Limit-*
//  - ante un 429: espera lo que pida Retry-After (hasta 1 h) y sigue creciendo si se repite
//  - nunca se reintenta a ciegas; el que llama conserva los últimos datos buenos
import { config } from '../lib/config.js';

export class MarketError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.kind = kind; // rate_limited | blocked | http | network | disabled
    Object.assign(this, extra);
  }
}

let chain = Promise.resolve();
let lastAt = 0;
let gapMs = config.marketMinGapMs;
let blockedUntil = 0;
let strikes = 0;
let lastRate = null;

export const queueStatus = () => ({
  gapMs,
  strikes,
  blockedUntil: blockedUntil > Date.now() ? Math.ceil(blockedUntil / 1000) : null,
  lastRate,
});
export const isBlocked = () => blockedUntil > Date.now();

export function resetForTests() {
  lastAt = 0;
  gapMs = config.marketMinGapMs;
  blockedUntil = 0;
  strikes = 0;
  lastRate = null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseRules(h) {
  return String(h || '')
    .split(',')
    .map((s) => s.trim().split(':').map(Number))
    .filter((a) => a.length >= 2 && a[0] > 0 && a[1] > 0);
}

function learnFromHeaders(headers) {
  const lim = headers.get('x-rate-limit-ip');
  if (!lim || !config.learnRate) return;
  const st = headers.get('x-rate-limit-ip-state');
  const rules = parseRules(lim);
  const states = parseRules(st);
  lastRate = { limits: lim, state: st || null };
  // ritmo sostenible = el más lento de todas las reglas, con 15 % de margen
  let g = config.marketMinGapMs;
  for (const [max, period] of rules) g = Math.max(g, ((period * 1000) / max) * 1.15);
  gapMs = Math.round(g);
  // si alguna regla está a un paso del tope, se hace una pausa completa de ese periodo
  rules.forEach(([max, period], i) => {
    const used = states[i] ? states[i][0] : 0;
    if (used >= max - 1) blockedUntil = Math.max(blockedUntil, Date.now() + period * 1000);
  });
}

async function run(method, path, { body, cookie } = {}) {
  if (!config.marketEnabled) throw new MarketError('disabled', 'El mercado está desactivado en este servidor.');
  if (blockedUntil > Date.now()) {
    throw new MarketError('rate_limited', 'Pausa por límite del mercado.', { retryAt: Math.ceil(blockedUntil / 1000) });
  }
  const wait = lastAt + gapMs - Date.now();
  if (wait > 0) await sleep(wait);

  const headers = {
    'User-Agent': `atalaya/1.0 (contact: ${config.marketContact || 'not-set'})`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = `POESESSID=${cookie}`;

  let res;
  try {
    res = await fetch(config.marketBase + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    lastAt = Date.now();
    throw new MarketError('network', 'No se pudo conectar con el mercado.');
  }
  lastAt = Date.now();
  learnFromHeaders(res.headers);

  if (res.status === 429) {
    strikes += 1;
    const ra = Number(res.headers.get('retry-after')) || 60;
    const secs = Math.min(3600, Math.max(ra, config.backoffBaseSec * 2 ** Math.max(0, Math.ceil(strikes) - 1)));
    blockedUntil = Date.now() + secs * 1000;
    throw new MarketError('rate_limited', 'El mercado pidió esperar.', { retryAt: Math.ceil(blockedUntil / 1000) });
  }
  if (res.status === 403) {
    blockedUntil = Date.now() + 15 * 60 * 1000;
    throw new MarketError('blocked', 'El mercado rechazó la petición (403).', { retryAt: Math.ceil(blockedUntil / 1000) });
  }
  if (!res.ok) throw new MarketError('http', `El mercado respondió ${res.status}.`, { status: res.status });
  strikes = Math.max(0, strikes - 0.25);
  try {
    return await res.json();
  } catch {
    throw new MarketError('http', 'Respuesta del mercado ilegible.', { status: res.status });
  }
}

export function request(method, path, opts) {
  const p = chain.then(() => run(method, path, opts));
  chain = p.catch(() => {});
  return p;
}
