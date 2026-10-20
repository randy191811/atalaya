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

const { verdictFor, verdictFrom } = await import('../src/worker/reviews.js');
ok(verdictFor(900, [300, 320, 340, 400, 500]).verdict === 'caro' && verdictFor(330, [300, 320, 340, 400]).verdict === 'en_precio' && verdictFor(200, [300, 320, 340]).verdict === 'barato' && verdictFor(300, [310, 320]).verdict === 'sin_datos', 'revisor de precios: caro / en precio / barato / sin datos');
ok(verdictFor(500, [100, 110, 120, 480, 500, 2000]).verdict === 'en_precio', 'la mediana sale de toda la muestra, no solo de los más baratos');
ok(verdictFrom(null, 10, 20) === 'sin_datos' && verdictFrom(100, 0, 0) === 'sin_datos', 'sin mediana no hay veredicto');

// Lectura de objetos del mercado: los modificadores deben leerse sea cual sea el campo que los traiga.
const { collectMods, normalizeEntry, spreadSample } = await import('../src/worker/trade2.js');
ok(collectMods({ explicitMods: ['+10 a la vida'] })[0] === '+10 a la vida', 'lee modificadores en texto plano');
ok(collectMods({ explicitMods: [{ name: '+10 a la vida' }, { text: 'Resistencia al fuego 30 %' }] }).length === 2, 'lee modificadores que llegan como objeto');
const orden = collectMods({ explicitMods: ['explícito'], implicitMods: ['implícito'], runeMods: ['runa'], enchantMods: ['encantamiento'] });
ok(orden[0] === 'encantamiento' && orden[1] === 'implícito' && orden[2] === 'runa' && orden[3] === 'explícito', 'respeta el orden en que el juego los muestra');
ok(collectMods({ desecratedMods: ['mod nuevo del juego'] })[0] === 'mod nuevo del juego', 'lee cualquier campo que acabe en Mods, aunque sea nuevo');
ok(collectMods({ sanctumMods: ['inventado'] })[0] === 'inventado', 'un campo de modificadores desconocido también se lee');
const tableta = collectMods({ properties: [{ name: 'Nivel de monstruo', values: [['79', 0]] }], descrText: 'Usar en un mapa' });
ok(tableta.includes('Nivel de monstruo: 79') && tableta.includes('Usar en un mapa'), 'sin modificadores, usa propiedades y descripción (tabletas y monedas)');
ok(collectMods({ explicitMods: ['+5 a la vida'], properties: [{ name: 'Calidad', values: [['+20%', 0]] }] }).length === 1, 'si ya hay modificadores, no añade propiedades de relleno');
ok(collectMods({ extended: { mods: { explicit: [{ name: 'del bloque extendido' }] } } })[0] === 'del bloque extendido', 'último recurso: el bloque extendido');

// El fallo real visto en la página: una varita rara con su implícito pero SIN el texto de
// sus afijos. Antes se daba la ficha por buena con una sola línea; ahora se reconstruyen.
const { setStatsDict, needsStatsDict, inventoryOf } = await import('../src/worker/trade2.js');
const varita = {
  name: 'Torment Weaver', baseType: 'Dueling Wand', rarity: 'Rare', ilvl: 81,
  implicitMods: ['Grants Skill: Level 18 Spellslinger'],
  extended: { mods: { explicit: [
    { name: 'Tyrannical', magnitudes: [{ hash: 'explicit.stat_1', min: '120', max: '120' }] },
    { name: 'of the Sorcerer', magnitudes: [{ hash: 'explicit.stat_2', min: '30', max: '38' }] },
  ] } },
};
setStatsDict(null);
ok(needsStatsDict({ item: varita }) === true, 'detecta que a un raro le falta el texto de sus afijos');
ok(needsStatsDict({ item: { explicitMods: ['+1'], extended: { mods: { explicit: [{}] } } } }) === false, 'si el texto ya viene, no se pide el diccionario');
const sinDicc = collectMods(varita);
ok(sinDicc.length === 3 && sinDicc[0] === 'Grants Skill: Level 18 Spellslinger' && sinDicc[1] === 'Tyrannical',
  'sin diccionario, al menos salen los nombres de los afijos en vez de una sola línea');
setStatsDict(new Map([['explicit.stat_1', '#% increased Spell Damage'], ['explicit.stat_2', '+# to maximum Mana']]));
const conDicc = collectMods(varita);
ok(conDicc.length === 3 && conDicc[0] === 'Grants Skill: Level 18 Spellslinger' && conDicc[1] === '120% increased Spell Damage' && conDicc[2] === '+30-38 to maximum Mana',
  'con el diccionario se escriben las características completas, implícito primero');
setStatsDict(null);
ok(inventoryOf(varita).includes('implicitMods[1]') && inventoryOf(varita).includes('extended.mods.explicit[2]'), 'el resumen dice qué campos manda el mercado');
const norm = normalizeEntry({ id: 'x1', item: { name: 'Objeto', baseType: 'Base', rarity: 'Unique', ilvl: 81, corrupted: true, explicitMods: ['+1 a todo'] }, listing: { price: { amount: 3, currency: 'divine' } } });
ok(norm.item_level === 81 && norm.corrupted === 1 && norm.stats[0] === '+1 a todo' && norm.price_amount === 3, 'normaliza nivel de objeto, corrupción, precio y modificadores');
ok(normalizeEntry({ id: 'x2', item: { name: 'A' } }).stats.length === 0 && normalizeEntry({ id: 'x3' }) === null, 'un objeto sin datos no revienta la lectura');
const diez = Array.from({ length: 100 }, (_, i) => 'id' + i);
const muestra = spreadSample(diez, 10);
const pos = muestra.map((x) => Number(x.slice(2)));
ok(muestra.length === 10 && pos[0] === 0 && pos[1] === 1 && pos[2] === 2 && pos.every((v, i) => i === 0 || v > pos[i - 1]) && pos[9] >= 80,
  'la muestra toma los más baratos y luego reparte por todo el rango hasta los caros');
ok(spreadSample(['a', 'b'], 10).length === 2, 'con pocos anuncios se toman todos');

// El mercado solo encuentra la cuenta si lleva el #número: se exige antes de guardarla.
const accRe = /^[\p{L}\p{N}_\-. ]{2,30}#\d{1,6}$/u;
ok(accRe.test('Randy#1234') && accRe.test('Mi Cuenta#99999') && !accRe.test('Randy') && !accRe.test('Randy#') && !accRe.test('#1234') && !accRe.test('Randy#12ab'), 'valida el nombre de cuenta con #número');

console.log(`\nUNIT: ${pass} correctas, ${fail} fallidas`);
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
