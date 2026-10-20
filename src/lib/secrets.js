// Cifrado de campos sensibles (p. ej. la sesión privada del jugador). AES-256-GCM.
// La sesión jamás se devuelve al cliente ni se escribe en logs.
import crypto from 'node:crypto';
import { config } from './config.js';

const key = crypto.createHash('sha256').update('field-key:' + config.sessionSecret).digest();

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'v1.' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}

export function decrypt(blob) {
  if (!blob || !blob.startsWith('v1.')) return null;
  try {
    const raw = Buffer.from(blob.slice(3), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
