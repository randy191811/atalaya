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
const { collectMods, normalizeEntry, spreadSample, itemDetail: itemDetailPre } = await import('../src/worker/trade2.js');
ok(collectMods({ explicitMods: ['+10 a la vida'] })[0] === '+10 a la vida', 'lee modificadores en texto plano');
ok(collectMods({ explicitMods: [{ name: '+10 a la vida' }, { text: 'Resistencia al fuego 30 %' }] }).length === 2, 'lee modificadores que llegan como objeto');
// EL FALLO REAL: así es como el mercado manda de verdad los implícitos y los afijos.
const comoElMercado = collectMods({
  implicitMods: [{ description: 'Grants Skill: Level 18 Trinity', flags: {} }],
  explicitMods: [
    { description: '+120 to maximum Life', flags: {} },
    { description: '35% increased Physical Damage', flags: { crafted: true } },
  ],
});
ok(comoElMercado.length === 3 && comoElMercado[0] === 'Grants Skill: Level 18 Trinity' && comoElMercado[1] === '+120 to maximum Life' && comoElMercado[2] === '35% increased Physical Damage',
  'lee los afijos tal como los manda el mercado: { description, flags }');
ok(collectMods({ logbookMods: [{ name: 'Expedición', faction: { id: 'f1' }, mods: ['+5% de botín', '+2 a la calidad'] }] }).length === 2,
  'los modificadores de bitácora vienen anidados y también se leen');
ok(collectMods({ hybrid: { explicitMods: [{ description: 'cara vaal' }] } })[0] === 'cara vaal', 'y la segunda cara de las gemas vaal');
const orden = collectMods({ explicitMods: ['explícito'], implicitMods: ['implícito'], runeMods: ['runa'], enchantMods: ['encantamiento'] });
ok(orden[0] === 'encantamiento' && orden[1] === 'implícito' && orden[2] === 'runa' && orden[3] === 'explícito', 'respeta el orden en que el juego los muestra');
ok(collectMods({ desecratedMods: ['mod nuevo del juego'] })[0] === 'mod nuevo del juego', 'lee cualquier campo que acabe en Mods, aunque sea nuevo');
ok(collectMods({ sanctumMods: ['inventado'] })[0] === 'inventado', 'un campo de modificadores desconocido también se lee');
const tableta = collectMods({ properties: [{ name: 'Nivel de monstruo', values: [['79', 0]] }], descrText: 'Usar en un mapa' });
ok(tableta.includes('Nivel de monstruo: 79') && tableta.includes('Usar en un mapa'), 'sin modificadores, usa propiedades y descripción (tabletas y monedas)');
ok(collectMods({ explicitMods: ['+5 a la vida'], properties: [{ name: 'Calidad', values: [['+20%', 0]] }] }).length === 1, 'si ya hay modificadores, no añade propiedades de relleno');
// ═══ TEST «TORMENT WEAVER»: nunca, jamás, los nombres internos de los afijos ═══
// extended.mods trae el nombre del afijo («Occultist's», «of the Sage»), su grado y sus
// magnitudes. Eso es metadato para los filtros de búsqueda, NO lo que ve el jugador.
const { inventoryOf, missingText, countExtended } = await import('../src/worker/trade2.js');
const varitaSinTexto = {
  name: 'Torment Weaver', baseType: 'Dueling Wand', rarity: 'Rare', ilvl: 81,
  implicitMods: [{ description: 'Grants Skill: Level 18 Spellslinger', flags: {} }],
  extended: { mods: { explicit: [
    { name: "Ruthless", tier: 'P1', magnitudes: [{ hash: 'explicit.stat_1', min: '120', max: '120' }] },
    { name: "Occultist's", tier: 'P2', magnitudes: [{ hash: 'explicit.stat_2', min: '34', max: '34' }] },
    { name: 'of the Sage', tier: 'S1', magnitudes: [{ hash: 'explicit.stat_3', min: '12', max: '12' }] },
  ] } },
};
const vst = itemDetailPre(varitaSinTexto);
const NOMBRES_AFIJO = ["Ruthless", "Occultist's", 'of the Sage', 'Blue', 'of Calamity', 'of Conflagration', 'Tyrannical'];
const textoVarita = JSON.stringify([...(vst.implicits || []), ...(vst.mods || []), ...(vst.crafted || []), ...(vst.fractured || [])]);
ok(!NOMBRES_AFIJO.some((n) => textoVarita.includes(n)), 'TEST TORMENT WEAVER: ningún nombre interno de afijo llega a la tarjeta');
ok(vst.mods.length === 0, 'sin texto de afijos, la sección azul se queda vacía (no se rellena)');
ok(vst.implicits.length === 1 && vst.implicits[0] === 'Grants Skill: Level 18 Spellslinger', 'lo que sí viene con texto se muestra igual');
ok(countExtended(varitaSinTexto) === 3 && vst.sinTexto === 3 && missingText(varitaSinTexto) === 3,
  'y se cuenta cuántos afijos quedaron sin texto, para avisar en gris fuera del bloque azul');

// El mismo objeto CON el texto que manda el mercado: salen los mods, no los nombres.
const varitaConTexto = {
  ...varitaSinTexto,
  explicitMods: [
    { description: '+73 to maximum Mana', flags: {} },
    { description: '+28 to Intelligence', flags: {} },
    { description: 'Adds 15 to 28 Fire Damage to Spells', flags: {} },
  ],
};
const vct = itemDetailPre(varitaConTexto);
ok(vct.mods.join(' | ') === '+73 to maximum Mana | +28 to Intelligence | Adds 15 to 28 Fire Damage to Spells',
  'TEST TORMENT WEAVER: con explicitMods salen los mods reales con su valor rodado');
ok(!NOMBRES_AFIJO.some((n) => vct.mods.join(' ').includes(n)), 'y ni un nombre de afijo se cuela entre ellos');
ok(vct.sinTexto === 0, 'con el texto completo no hay aviso de nada que falte');
ok(!/\(\d+[–-]\d+\)/.test(vct.mods.join(' ')), 'un objeto concreto no muestra rangos: muestra su tirada');

// TEST DE VACÍO: un objeto sin explicitMods no tiene sección azul.
const vacio = itemDetailPre({ name: 'Base', baseType: 'Dueling Wand', rarity: 'Normal', properties: [{ name: 'Wand', values: [] }] });
ok(vacio.mods.length === 0 && vacio.implicits.length === 0 && vacio.crafted.length === 0 && vacio.sinTexto === 0,
  'TEST DE VACÍO: sin modificadores no hay sección de modificadores');
ok(vacio.properties.length === 1, 'pero sus propiedades sí se muestran');

// Cada grupo en su bloque, como el juego.
const grupos = itemDetailPre({
  enchantMods: ['Encantamiento'],
  implicitMods: [{ description: 'Implícito' }],
  explicitMods: [{ description: 'Afijo' }],
  craftedMods: ['Fabricado'],
  fracturedMods: ['Fracturado'],
});
ok(grupos.enchant[0] === 'Encantamiento' && grupos.implicits[0] === 'Implícito' && grupos.mods[0] === 'Afijo'
  && grupos.crafted[0] === 'Fabricado' && grupos.fractured[0] === 'Fracturado',
  'encantamientos, implícitos, afijos, fabricados y fracturados van cada uno en su bloque');

// Si el mercado NO manda el texto, se reescribe con el diccionario oficial del mercado.
// Eso no es inventar: es el mismo texto y los mismos números que usa la web del mercado.
const { setStatsDict, textFromExtended } = await import('../src/worker/trade2.js');
setStatsDict(new Map([
  ['explicit.stat_1', '#% increased Spell Damage'],
  ['explicit.stat_2', '+# to maximum Mana'],
  ['explicit.stat_4', 'Adds # to # Fire Damage to Spells'],
]));
const reescrita = itemDetailPre(varitaSinTexto);
ok(reescrita.mods.length === 2 && reescrita.mods[0] === '120% increased Spell Damage' && reescrita.mods[1] === '+34 to maximum Mana',
  'con el diccionario, los afijos se escriben con su texto real y su valor rodado');
ok(!/\d+-\d+/.test(reescrita.mods.join(' ')), 'y sin rangos: un objeto concreto tiene su tirada, no un intervalo');
ok(reescrita.sinTexto === 1, 'y el que no está en el diccionario se cuenta, no se inventa');
ok(!NOMBRES_AFIJO.some((n) => JSON.stringify(reescrita.mods).includes(n)), 'ni aun así se cuela un nombre interno de afijo');
ok(textFromExtended({ name: 'x', magnitudes: [
  { hash: 'explicit.stat_4', min: '15', max: '15' }, { hash: 'explicit.stat_4', min: '28', max: '28' }] })[0] === 'Adds 15 to 28 Fire Damage to Spells',
  'un modificador con dos valores de la misma estadística se escribe entero («Adds 15 to 28…»)');
ok(textFromExtended({ name: 'desconocido', magnitudes: [{ hash: 'explicit.nada', min: '1', max: '1' }] }).length === 0,
  'una estadística que no está en el diccionario no produce NINGUNA línea');
// El texto que sí manda el mercado siempre gana sobre la reescritura.
ok(itemDetailPre(varitaConTexto).mods[0] === '+73 to maximum Mana', 'si viene explicitMods, se copia ese y no se reescribe nada');
setStatsDict(null);

// ═══ COMPARACIÓN LÍNEA POR LÍNEA: 3 objetos, cada línea contra su origen ═══
// Misma cantidad, mismo orden, mismo texto. Si una sola línea no coincide, falla.
const TRES = [
  { nombre: 'anillo raro', src: { name: 'Storm Loop', baseType: 'Sapphire Ring', rarity: 'Rare',
      implicitMods: [{ description: '+18% to Cold Resistance' }],
      explicitMods: [{ description: '+72 to maximum Life' }, { description: '+38% to Fire Resistance' }, { description: '+29 to Dexterity' }] } },
  { nombre: 'amuleto único', src: { name: 'Astramentis', baseType: 'Stellar Amulet', rarity: 'Unique',
      implicitMods: [{ description: '+6 to all Attributes' }],
      explicitMods: [{ description: '+86 to all Attributes' }, { description: '-4 Physical Damage taken from Attack Hits' }],
      flavourText: ['The stars are not for us.'] } },
  { nombre: 'maza con fabricado y fracturado', src: { name: 'Torment Burst', baseType: 'Structured Hammer', rarity: 'Rare',
      implicitMods: [{ description: '+15 to Strength' }],
      explicitMods: [{ description: '+120 to maximum Life' }],
      craftedMods: ['+25% to Quality'], fracturedMods: ['35% increased Physical Damage'] } },
];
let lineasOk = true;
for (const { nombre, src } of TRES) {
  const d = itemDetailPre(src);
  const esperado = {
    implicits: (src.implicitMods || []).map((m) => m.description),
    mods: (src.explicitMods || []).map((m) => m.description),
    crafted: src.craftedMods || [],
    fractured: src.fracturedMods || [],
    flavour: src.flavourText || [],
  };
  for (const [campo, want] of Object.entries(esperado)) {
    const got = d[campo] || [];
    const igual = got.length === want.length && want.every((x, i) => got[i] === x);
    if (!igual) { lineasOk = false; console.log(`     ${nombre} · ${campo}: esperado ${JSON.stringify(want)}, salió ${JSON.stringify(got)}`); }
  }
}
ok(lineasOk, 'COMPARACIÓN LÍNEA POR LÍNEA: 3 objetos, cada línea igual a su origen y en el mismo orden');

// La ficha completa: el mercado manda el texto con el marcado interno del juego.
const { cleanMarkup, propText, itemDetail } = await import('../src/worker/trade2.js');
ok(cleanMarkup('[Mace|One Hand Mace]') === 'One Hand Mace' && cleanMarkup('[Physical] Damage') === 'Physical Damage'
  && cleanMarkup('[Critical|Critical Hit] Chance') === 'Critical Hit Chance' && cleanMarkup('+10 a la vida') === '+10 a la vida',
  'quita el marcado interno del juego ([A|B] → B, [A] → A)');
ok(propText({ name: '[Physical] Damage', values: [['65-79', 0]] }) === 'Physical Damage: 65-79', 'propiedad normal: «Nombre: valor»');
ok(propText({ name: 'Str', values: [['98', 0]], displayMode: 1 }) === '98 Str', 'requisito con el valor delante');
ok(propText({ name: 'Calidad %0', values: [['+20%', 0]], displayMode: 3 }) === 'Calidad +20%', 'el valor va dentro del nombre');

const maza = {
  name: 'Torment Burst', baseType: 'Structured Hammer', rarity: 'Rare', ilvl: 67, corrupted: true,
  properties: [
    { name: '[Mace|One Hand Mace]', values: [] },
    { name: '[Physical] Damage', values: [['65-79', 1]] },
    { name: 'Attacks per Second', values: [['1.40', 0]] },
  ],
  requirements: [{ name: 'Level', values: [['45', 0]], displayMode: 0 }, { name: 'Str', values: [['98', 0]], displayMode: 1 }],
  implicitMods: ['+15 to Strength'],
  explicitMods: ['+120 to maximum Life', '35% increased Physical Damage'],
  flavourText: ['Lo que cae, cae entero.'],
};
const fichaMaza = itemDetail(maza);
ok(fichaMaza.properties.length === 3 && fichaMaza.properties[0] === 'One Hand Mace' && fichaMaza.properties[1] === 'Physical Damage: 65-79',
  'la ficha trae las propiedades (daño, ataques por segundo…) ya legibles');
ok(fichaMaza.requirements[0] === 'Requiere: Level 45, 98 Str', 'y los requisitos en una línea, como el juego');
ok(fichaMaza.implicits.length === 1 && fichaMaza.mods.length === 2 && fichaMaza.itemLevel === 67 && fichaMaza.corrupted === true,
  'implícitos y afijos van separados, con nivel de objeto y corrupción');
ok(fichaMaza.flavour[0] === 'Lo que cae, cae entero.', 'y el texto de sabor de los únicos');

const joya = { name: 'Rubí', baseType: 'Time-Lost Ruby', rarity: 'Rare', explicitMods: ['+12% a la vida'], descrText: 'Colócala en un engarce de joya asignado.' };
const fichaJoya = itemDetail(joya);
ok(fichaJoya.mods.length === 1 && fichaJoya.descr[0] === 'Colócala en un engarce de joya asignado.',
  'una joya muestra sus modificadores Y cómo se usa, no solo una de las dos cosas');
ok(itemDetail({ identified: false, baseType: 'Dueling Wand' }).unidentified === true, 'marca los objetos sin identificar');

// El cetro «Sol Bane» tal cual lo enseña el juego, bloque por bloque.
const cetro = itemDetail({
  name: 'Sol Bane', baseType: 'Stoic Sceptre', rarity: 'Rare',
  properties: [
    { name: 'Sceptre', values: [], displayMode: 0 },
    { name: 'Quality', values: [['+3%', 1]], displayMode: 0 },
    { name: 'Spirit', values: [['114', 0]], displayMode: 0 },
  ],
  requirements: [
    { name: 'Level', values: [['31', 0]], displayMode: 0 },
    { name: 'Str', values: [['20', 0]], displayMode: 1 },
    { name: 'Int', values: [['47', 0]], displayMode: 1 },
  ],
  grantedSkills: [{ name: 'Grants Skill', values: [['Level 9 Discipline', 0]], displayMode: 0 }],
  implicitMods: [{ description: '11% increased Spirit', flags: {} }],
  explicitMods: [
    { description: '+18 to maximum Mana', flags: {} },
    { description: '15% reduced Attribute Requirements', flags: {} },
    { description: '+14 to Strength', flags: {} },
    { description: 'Minions have 30% increased maximum Life', flags: {} },
  ],
});
ok(cetro.properties.join(' | ') === 'Sceptre | Quality: +3% | Spirit: 114', 'cetro: las propiedades salen igual que en el juego');
ok(cetro.requirements[0] === 'Requiere: Level 31, 20 Str, 47 Int', 'cetro: «Requiere: Level 31, 20 Str, 47 Int», sin dos puntos tras cada nombre');
ok(cetro.granted.length === 1 && cetro.granted[0] === 'Grants Skill: Level 9 Discipline', 'cetro: la habilidad concedida va en su propio bloque');
ok(cetro.implicits.length === 1 && cetro.implicits[0] === '11% increased Spirit', 'cetro: el implícito va separado de los afijos');
ok(cetro.mods.length === 4 && cetro.mods[0] === '+18 to maximum Mana' && cetro.mods[3] === 'Minions have 30% increased maximum Life',
  'cetro: los cuatro afijos, en su orden');
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
