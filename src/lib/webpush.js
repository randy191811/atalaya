// Web Push sin librerías: VAPID (ES256) + cifrado de contenido aes128gcm (RFC 8188 / 8291).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';

const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

// ---- claves VAPID: por variables de entorno o creadas una vez en data/vapid.json
function loadVapid() {
  if (config.vapid.privateKey && config.vapid.publicKey) {
    return { d: config.vapid.privateKey, pub: config.vapid.publicKey };
  }
  const f = path.join(config.dataDir, 'vapid.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]));
  const out = { d: jwk.d, pub };
  fs.writeFileSync(f, JSON.stringify(out), { mode: 0o600 });
  return out;
}
const vapid = loadVapid();
export const vapidPublicKey = vapid.pub;

function vapidPrivateKeyObject() {
  const pub = fromB64u(vapid.pub);
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: vapid.d, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
}

export function vapidAuthHeader(endpoint) {
  const aud = new URL(endpoint).origin;
  const subject = config.vapid.subject || (config.marketContact ? `mailto:${config.marketContact}` : 'mailto:admin@example.com');
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const data = `${head}.${claims}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: vapidPrivateKeyObject(), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${vapid.pub}`;
}

const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

// Cifra `payload` para un navegador (p256dh = clave pública del navegador, auth = secreto de 16 bytes).
export function encryptPayload(payload, p256dhB64, authB64, fixed = {}) {
  const uaPub = fromB64u(p256dhB64);
  const authSecret = fromB64u(authB64);
  const ecdh = crypto.createECDH('prime256v1');
  if (fixed.asPrivate) ecdh.setPrivateKey(fromB64u(fixed.asPrivate));
  else ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPub);
  const ikm = hkdf(shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const salt = fixed.salt ? fromB64u(fixed.salt) : crypto.randomBytes(16);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}

// Solo para la autoprueba: descifra como lo haría el navegador.
export function decryptPayloadForTest(blob, uaEcdh, authB64) {
  const salt = blob.subarray(0, 16);
  const idlen = blob[20];
  const asPub = blob.subarray(21, 21 + idlen);
  const data = blob.subarray(21 + idlen);
  const uaPub = uaEcdh.getPublicKey();
  const shared = uaEcdh.computeSecret(asPub);
  const ikm = hkdf(shared, fromB64u(authB64), Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString('utf8');
}

export function selfTest() {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const msg = 'ping ✓ ' + crypto.randomBytes(4).toString('hex');
  const blob = encryptPayload(msg, b64u(ua.getPublicKey()), b64u(auth));
  return decryptPayloadForTest(blob, ua, b64u(auth)) === msg;
}

// Envía a una suscripción. Devuelve 'ok' | 'gone' | 'error'.
export async function sendPush(sub, payloadObj) {
  try {
    const body = encryptPayload(JSON.stringify(payloadObj), sub.p256dh, sub.auth);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthHeader(sub.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404 || res.status === 410) {
      db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      return 'gone';
    }
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}
