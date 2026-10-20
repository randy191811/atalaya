// Pruebas pequeñas de las piezas de seguridad (sin red).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-unit-'));
const { encrypt, decrypt } = await import('../src/lib/secrets.js');
const { hashPassword, verifyPassword } = await import('../src/lib/auth.js');
const wp = await import('../src/lib/webpush.js');
const { toExalted, canon } = await import('../src/lib/money.js');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? '  PASS' : '  FAIL', m); };

const blob = encrypt('POESESSID-secreto-123');
ok(!blob.includes('secreto') && decrypt(blob) === 'POESESSID-secreto-123', 'cifrado AES-GCM ida y vuelta');
ok(decrypt(blob.slice(0, -2) + 'AA') === null, 'un valor cifrado alterado no se descifra');
const hsh = await hashPassword('mi-clave-larga-1');
ok(!hsh.includes('mi-clave') && (await verifyPassword('mi-clave-larga-1', hsh)) && !(await verifyPassword('otra', hsh)), 'contraseñas con scrypt');
ok(wp.selfTest(), 'Web Push: cifrado aes128gcm ida y vuelta');

// Vector oficial del RFC 8291, Apéndice A: garantiza compatibilidad real con los navegadores.
const vec = wp.encryptPayload('When I grow up, I want to be a watermelon',
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg',
  { asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' }).toString('base64url');
ok(vec === 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN', 'Web Push coincide con el vector de prueba oficial del RFC 8291');

// El JWT VAPID debe verificarse con la clave pública que se publica al navegador.
const hdr = wp.vapidAuthHeader('https://fcm.googleapis.com/fcm/send/abc');
const jwt = /t=([^,]+),/.exec(hdr)[1];
const [h, c, s] = jwt.split('.');
const pub = Buffer.from(wp.vapidPublicKey, 'base64url');
const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33, 65).toString('base64url') }, format: 'jwk' });
ok(crypto.verify('sha256', Buffer.from(h + '.' + c), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), 'firma VAPID (ES256) válida');
const claims = JSON.parse(Buffer.from(c, 'base64url'));
ok(claims.aud === 'https://fcm.googleapis.com' && claims.exp > Date.now() / 1000 && claims.exp - Date.now() / 1000 <= 24 * 3600, 'reclamos VAPID: audiencia y caducidad ≤ 24 h');
ok(pub.length === 65 && pub[0] === 4, 'clave pública VAPID de 65 bytes sin comprimir');

const rates = { exPerDiv: 600, exPerChaos: 2 };
ok(toExalted(2, 'divine', rates) === 1200 && toExalted(10, 'chaos', rates) === 20 && toExalted(5, 'exalted', rates) === 5 && toExalted(1, 'mirror', rates) === null, 'conversión de monedas');
ok(canon('CurrencyModValues') === 'divine' && canon('Exalted Orb') === 'exalted', 'alias de monedas');

const { parseItemText, validateAppraisal } = await import('../src/lib/tasador.js');
const { parseJson } = await import('../src/lib/ai.js');
const es = parseItemText('Clase de objeto: Anillos\nRareza: Único\nPiel de Kaom\nCinturón pesado\n--------\nNivel de objeto: 82\n--------\n+40 a la Fuerza');
ok(es && es.rarity === 'Unique' && es.name === 'Piel de Kaom' && es.base === 'Cinturón pesado' && es.itemLevel === 82 && es.mods[0] === '+40 a la Fuerza', 'lee objetos copiados del juego en español');
ok(parseItemText('hola') === null && parseItemText('texto cualquiera sin formato de objeto') === null, 'rechaza texto que no es un objeto');
ok(parseJson('```json\n{"a":1}\n```').a === 1 && parseJson('{"a":[1]} ]').a[0] === 1, 'JSON tolerante (bloques de código y corchete de más)');
ok(validateAppraisal({ precio: { cantidad: -1, moneda: 'divine' } }) === null && validateAppraisal({ precio: { cantidad: 2, moneda: 'mirror' } }) === null, 'una tasación sin precio válido se descarta');
ok(validateAppraisal({ precio: { cantidad: '3', moneda: 'Divine Orb' }, confianza: 'altísima' }).confianza === 'baja', 'normaliza moneda y confianza');

const { verdictFor } = await import('../src/worker/reviews.js');
ok(verdictFor(900, [300, 320, 340, 400, 500]).verdict === 'caro' && verdictFor(330, [300, 320, 340, 400]).verdict === 'en_precio' && verdictFor(200, [300, 320, 340]).verdict === 'barato' && verdictFor(300, [310, 320]).verdict === 'sin_datos', 'revisor de precios: caro / en precio / barato / sin datos');

console.log(`\nUNIT: ${pass} correctas, ${fail} fallidas`);
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
