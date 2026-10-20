// Prueba de extremo a extremo contra un mercado FALSO y una IA FALSA locales. No toca nada real.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-e2e-'));
const APP = 3931, FAKE = 4031, AI = 4032;
const base = `http://127.0.0.1:${APP}`;
const fake = `http://127.0.0.1:${FAKE}`;
const ai = `http://127.0.0.1:${AI}`;
const GOOD_ANTHROPIC = 'sk-ant-api03-PRUEBA-buena-0000000000000000';

let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log(c ? '  PASS' : '  FAIL', msg); };
const section = (t) => console.log('\n' + t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
function spawnNode(args, env) {
  const p = spawn('node', ['--disable-warning=ExperimentalWarning', ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
  p.stderr.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write('[stderr] ' + d));
  procs.push(p);
  return p;
}
const appEnv = {
  DATA_DIR: DATA, PORT: String(APP), MARKET_BASE: fake, MARKET_MIN_GAP_MS: '0', MARKET_LEARN_RATE: '0', MARKET_BACKOFF_BASE_SEC: '1',
  ANTHROPIC_BASE: ai, GEMINI_BASE: ai, NO_WORKER: '1', MARKET_CONTACT: 'prueba@ejemplo.com', DEFAULT_LEAGUE: 'Standard',
  ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', BILLING_MODE: 'mock',
};

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie?.() || []) { const kv = c.split(';')[0]; if (kv.startsWith('sid=')) cookie = kv.slice(4) ? kv : ''; }
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  };
}
const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const get = (u) => fetch(u).then((r) => r.json());
const sql = (q, ...a) => { const d = new DatabaseSync(path.join(DATA, 'atalaya.db')); try { return d.prepare(q).all(...a); } finally { d.close(); } };
const sqlRun = (q, ...a) => { const d = new DatabaseSync(path.join(DATA, 'atalaya.db')); try { d.prepare(q).run(...a); } finally { d.close(); } };
async function waitUp(url) { for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).status < 500) return true; } catch {} await sleep(150); } return false; }
async function startApp() { const p = spawnNode(['src/server/index.js'], appEnv); await waitUp(base + '/api/health'); return p; }
const check = async (api, id) => { sqlRun('UPDATE shops SET last_manual_at = NULL'); return api('POST', `/api/tiendas/${id}/revisar`); };

function tinyPng() {
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 200, 180, 120]))), chunk('IEND', Buffer.alloc(0))]);
}

const ITEM_TEXT = `Item Class: Rings
Rarity: Rare
Storm Loop
Sapphire Ring
--------
Requires: Level 40
--------
Item Level: 79
--------
+18% to Cold Resistance (implicit)
--------
+72 to maximum Life
+38% to Fire Resistance
+41% to Lightning Resistance`;

let app;
try {
  spawnNode(['scripts/fake-market.js'], { FAKE_PORT: String(FAKE) });
  spawnNode(['scripts/fake-ai.js'], { FAKE_AI_PORT: String(AI) });
  await waitUp(fake + '/__stats');
  await waitUp(ai + '/__stats');
  app = await startApp();

  section('[1] Arranque y portada');
  const h = await (await fetch(base + '/api/health')).json();
  ok(h.ok && h.migrations === 3 && h.push === true && h.ai === false, 'servidor sano, IA sin clave todavía');
  const home = await fetch(base + '/');
  const html = await home.text();
  ok(home.status === 200 && /Tu tienda de Path of Exile 2/.test(html) && /Gratis, por ahora/.test(html), 'la portada se sirve con su contenido');
  ok(/script-src 'self'/.test(home.headers.get('content-security-policy')), 'cabeceras de seguridad presentes');
  ok((await fetch(base + '/privacidad')).status === 200 && (await fetch(base + '/terminos.html')).status === 200, 'páginas legales disponibles');
  ok((await fetch(base + '/../data/atalaya.db')).status === 404 && (await fetch(base + '/atalaya.db')).status === 404, 'la base de datos no se puede descargar');

  section('[2] Cuentas');
  const admin = client();
  const user = client();
  const other = client();
  ok((await admin('POST', '/api/registro', { name: 'Randy', email: 'randy@ejemplo.com', password: 'clave-larga-admin' })).status === 201, 'primer registro (administrador)');
  ok((await user('POST', '/api/registro', { name: 'Ana', email: 'ana@ejemplo.com', password: 'clave-larga-ana1' })).status === 201, 'registro de usuaria normal');
  await other('POST', '/api/registro', { name: 'Leo', email: 'leo@ejemplo.com', password: 'clave-larga-leo1' });
  let me = (await user('GET', '/api/yo')).json;
  ok(me.plan.key === 'gratis' && me.credits === 5 && me.user.role === 'member', 'plan gratis con 5 créditos de bienvenida');
  ok((await admin('GET', '/api/yo')).json.user.role === 'admin', 'el primero es administrador');
  ok((await user('POST', '/api/registro', { name: 'Ana', email: 'ana@ejemplo.com', password: 'clave-larga-ana1' })).status === 400, 'no se repite correo');
  ok((await client()('POST', '/api/login', { email: 'ana@ejemplo.com', password: 'mala-clave-xx' })).status === 401, 'contraseña incorrecta rechazada');
  const pw = sql('SELECT password_hash FROM users WHERE email = ?', 'ana@ejemplo.com')[0].password_hash;
  ok(pw.startsWith('scrypt$') && !pw.includes('clave-larga'), 'contraseñas guardadas con huella scrypt');
  ok((await client()('GET', '/api/yo')).status === 401, 'sin sesión no hay datos');

  section('[3] Clave de la IA (desde el navegador, nunca en el código)');
  ok((await user('POST', '/api/tasar', { kind: 'texto', text: ITEM_TEXT })).status === 503, 'sin clave el tasador avisa y no cobra');
  ok((await user('GET', '/api/yo')).json.credits === 5, 'créditos intactos');
  ok((await user('POST', '/api/admin/clave-ia', { key: GOOD_ANTHROPIC })).status === 403, 'solo el administrador puede guardar la clave');
  const badKey = await admin('POST', '/api/admin/clave-ia', { key: 'sk-ant-api03-MALA-0000000000000000000000' });
  ok(badKey.status === 400 && /no es válida/.test(badKey.json.error), 'una clave mala se rechaza tras comprobarla en vivo');
  const goodKey = await admin('POST', '/api/admin/clave-ia', { key: GOOD_ANTHROPIC });
  ok(goodKey.status === 200 && goodKey.json.provider === 'anthropic' && goodKey.json.keys.anthropic === '…0000', 'la clave buena se detecta como Anthropic y se guarda');
  const keyFile = fs.readFileSync(path.join(DATA, 'ai-keys.json'), 'utf8');
  ok(!keyFile.includes('PRUEBA') && keyFile.includes('v1.'), 'la clave se guarda cifrada en la carpeta de datos');
  ok(!JSON.stringify((await admin('GET', '/api/admin')).json).includes('PRUEBA'), 'la clave nunca vuelve entera al navegador');
  const gem = await admin('POST', '/api/admin/clave-ia', { key: 'AIzaPRUEBAbuena0000000000000000000' });
  ok(gem.status === 200 && gem.json.provider === 'gemini', 'clave de Gemini de respaldo detectada y guardada');
  const clientFiles = fs.readdirSync(path.join(ROOT, 'client')).filter((f) => fs.statSync(path.join(ROOT, 'client', f)).isFile()).map((f) => fs.readFileSync(path.join(ROOT, 'client', f)).toString('latin1')).join('');
  ok(!/sk-ant-api|AIza[0-9A-Za-z_-]{20,}|PRUEBA/.test(clientFiles), 'ningún archivo del navegador contiene claves');

  section('[4] Tasador por texto: comparables reales + IA + créditos');
  await post(fake + '/__market', { name: 'type:Sapphire Ring', items: [
    { id: 'c1', name: 'Doom Band', base: 'Sapphire Ring', price: { amount: 2.5, currency: 'divine' }, mods: ['+65 to maximum Life', '+30% to Fire Resistance'] },
    { id: 'c2', name: 'Grim Coil', base: 'Sapphire Ring', price: { amount: 4, currency: 'divine' }, mods: ['+80 to maximum Life'] },
    { id: 'c3', name: 'Rune Hoop', base: 'Sapphire Ring', price: { amount: 300, currency: 'exalted' }, mods: ['+20 to Dexterity'] },
  ] });
  await post(ai + '/__reset');
  const t1 = await user('POST', '/api/tasar', { kind: 'texto', text: ITEM_TEXT });
  ok(t1.status === 200 && t1.json.result.precio.cantidad === 3 && t1.json.result.precio.moneda === 'divine', 'devuelve un precio sugerido');
  ok(t1.json.result.venta_rapida.moneda === 'divine', 'normaliza la moneda («div» → divine)');
  ok(t1.json.credits === 4 && (await user('GET', '/api/yo')).json.credits === 4, 'cobra 1 crédito en el servidor');
  ok(t1.json.result.mercado.estado === 'ok' && t1.json.result.mercado.total === 3 && t1.json.result.mercado.resumen.count === 3, 'usa 3 anuncios comparables del mercado');
  const aiCalls = (await get(ai + '/__stats')).calls;
  ok(aiCalls.length === 1 && aiCalls[0].engine === 'claude' && aiCalls[0].model === 'claude-haiku-4-5', 'una sola llamada, a Claude Haiku');
  ok(/2\.5 divine/.test(aiCalls[0].prompt) && /Storm Loop/.test(aiCalls[0].prompt), 'la IA recibe el objeto y los precios reales de los comparables');
  ok(t1.json.item.name === 'Storm Loop' && t1.json.item.base === 'Sapphire Ring' && t1.json.item.itemLevel === 79 && t1.json.item.mods.includes('+72 to maximum Life'), 'el texto del juego se interpreta (nombre, base, nivel, mods)');
  ok((await user('POST', '/api/tasar', { kind: 'texto', text: 'hola qué tal esto no es un objeto' })).status === 400 && (await user('GET', '/api/yo')).json.credits === 4, 'texto que no es un objeto: aviso claro y no cobra');
  const hist = (await user('GET', '/api/tasaciones')).json.appraisals;
  ok(hist.length === 1 && hist[0].item && hist[0].item.name === 'Storm Loop', 'queda en el historial con el objeto');
  ok((await other('GET', '/api/tasaciones')).json.appraisals.length === 0, 'el historial es privado de cada cuenta');

  section('[5] Fallos de la IA: respaldo y devolución');
  await post(ai + '/__mode', { mode: 'garbage' });
  await post(ai + '/__reset');
  const t2 = await user('POST', '/api/tasar', { kind: 'texto', text: ITEM_TEXT });
  const calls2 = (await get(ai + '/__stats')).calls;
  ok(t2.status === 200 && calls2.some((c) => c.engine === 'gemini'), 'si Claude responde algo inválido, Gemini responde (y se corrige su corchete de más)');
  ok(t2.json.credits === 3, 'cobra solo una vez');
  await post(ai + '/__mode', { mode: 'fail' });
  const before = (await user('GET', '/api/yo')).json.credits;
  const t3 = await user('POST', '/api/tasar', { kind: 'texto', text: ITEM_TEXT });
  ok(t3.status === 503 && /No se te cobró/.test(t3.json.error), 'si las dos IA fallan: mensaje humano');
  ok((await user('GET', '/api/yo')).json.credits === before && t3.json.credits === before, 'y los créditos se devuelven');
  const led = sql("SELECT reason FROM credit_ledger WHERE user_id = 2 ORDER BY id DESC LIMIT 2").map((r) => r.reason);
  ok(/Devolución/.test(led[0]) && /Tasación/.test(led[1]), 'reserva y devolución quedan apuntadas');
  await post(ai + '/__mode', { mode: 'ok' });

  section('[6] Tasador por captura');
  const png = tinyPng().toString('base64');
  ok((await user('POST', '/api/tasar', { kind: 'captura', image: { mime: 'image/png', base64: Buffer.from('no soy imagen').toString('base64') } })).status === 400, 'un archivo que no es imagen se rechaza sin cobrar');
  await post(ai + '/__reset');
  const t4 = await user('POST', '/api/tasar', { kind: 'captura', image: { mime: 'image/png', base64: png } });
  const calls4 = (await get(ai + '/__stats')).calls;
  ok(t4.status === 200 && t4.json.cost === 2 && t4.json.credits === 1, 'la captura cuesta 2 créditos');
  ok(calls4.length === 2 && calls4[0].hasImage && !calls4[1].hasImage, 'primero lee la imagen, después tasa con texto');
  ok(t4.json.item.name === 'Storm Loop' && t4.json.item.rarity === 'Rare', 'el objeto leído de la captura se usa para buscar comparables');
  ok(!sql('SELECT item_json FROM appraisals ORDER BY id DESC LIMIT 1')[0].item_json.includes(png.slice(0, 20)), 'la captura no se guarda');

  section('[7] Sin créditos: bloqueo antes de gastar');
  await post(ai + '/__reset');
  const t5 = await user('POST', '/api/tasar', { kind: 'captura', image: { mime: 'image/png', base64: png } });
  ok(t5.status === 402 && t5.json.needCredits === true, 'faltan créditos → pide mejorar el plan');
  ok((await get(ai + '/__stats')).calls.length === 0, 'y no se llamó a la IA');
  ok((await user('GET', '/api/yo')).json.credits === 1, 'el saldo no se toca');

  section('[8] Pago simulado, recarga y cancelación');
  const co = await user('POST', '/api/checkout', { plan: 'pro' });
  ok(co.status === 200 && co.json.plan.key === 'pro' && co.json.credits === 100, 'Pro activado: 100 créditos');
  ok(sql('SELECT COUNT(*) n FROM mock_payments WHERE user_id = 2')[0].n === 1, 'pago simulado registrado');
  const cols = sql("SELECT name FROM pragma_table_info('mock_payments')").map((r) => r.name).join(',');
  ok(!/card|tarjeta|pan|cvv/i.test(cols), 'no existe ningún campo para datos de tarjeta');
  ok((await user('POST', '/api/checkout', { plan: 'pro' })).status === 400, 'no se puede pagar dos veces el mismo plan');
  sqlRun('UPDATE users SET credits = 7, credits_renew_at = ? WHERE id = 2', Math.floor(Date.now() / 1000) - 10);
  me = (await user('GET', '/api/yo')).json;
  ok(me.credits === 100 && me.renewsAt > Date.now() / 1000 + 29 * 86400, 'renovación mensual: los créditos vuelven a 100');
  const cancel = await user('POST', '/api/cancelar');
  ok(cancel.status === 200 && cancel.json.plan.key === 'gratis', 'cancelar vuelve al plan gratis');
  ok((await admin('POST', '/api/checkout', { plan: 'pro' })).status === 400, 'el administrador no necesita pagar');

  section('[9] Tiendas: lectura, venta en dos pasos, cambio de precio');
  const items = [
    { id: 'L1', name: 'Storm Loop', base: 'Sapphire Ring', price: { amount: 3, currency: 'divine' }, mods: ['+72 to maximum Life'] },
    { id: 'L2', name: 'Headhunter', base: 'Heavy Belt', rarity: 'Unique', price: { amount: 40, currency: 'divine' }, mods: ['+40 to Strength'] },
    { id: 'L3', name: 'Doom Visor', base: 'Hubris Circlet', price: { amount: 150, currency: 'exalted' }, mods: ['+90 to maximum Energy Shield'] },
  ];
  await post(fake + '/__set', { account: 'Ana#1234', items });
  const s1 = await user('POST', '/api/tiendas', { account: 'Ana#1234', league: 'Liga Prueba' });
  ok(s1.status === 201, 'tienda añadida');
  ok((await user('POST', '/api/tiendas', { account: 'Otra#1', league: 'Liga Prueba' })).status === 402, 'el plan gratis vigila 1 sola tienda');
  const shopId = s1.json.id;
  const c1 = await check(user, shopId);
  ok(c1.status === 200 && c1.json.status === 'ok' && c1.json.count === 3, 'primera lectura: 3 objetos');
  let shops = (await user('GET', '/api/tiendas')).json;
  ok(shops.shops[0].listings.length === 3 && shops.shops[0].valueEx > 0 && shops.shops[0].health.state === 'ok', 'la tienda muestra objetos, valor y estado');
  ok((await user('POST', `/api/tiendas/${shopId}/revisar`)).status === 429, 'revisar a mano tiene enfriamiento');
  await post(fake + '/__set', { account: 'Ana#1234', items: [items[0], { ...items[1], id: 'L2b', price: { amount: 35, currency: 'divine' } }] });
  await check(user, shopId);
  ok(sql('SELECT COUNT(*) n FROM sales')[0].n === 0, 'desaparece una vez: aún no es venta; el cambio de precio no es venta');
  ok(sql("SELECT price_amount FROM listings WHERE name = 'Headhunter'")[0].price_amount === 35, 'el precio nuevo se actualiza en silencio');
  await check(user, shopId);
  const sales = (await user('GET', '/api/ventas')).json;
  ok(sales.sales.length === 1 && sales.sales[0].name === 'Doom Visor' && sales.sales[0].price_amount === 150, 'segunda lectura sin el objeto: venta confirmada');
  ok((await user('GET', '/api/yo')).json.unseenSales === 1, 'la venta sale como nueva');
  await user('POST', '/api/ventas/vistas');
  ok((await user('GET', '/api/yo')).json.unseenSales === 0, 'y se marca como vista');
  ok((await other('GET', `/api/tiendas/${shopId}`)).status === 404 || (await other('PATCH', `/api/tiendas/${shopId}`, { league: 'x' })).status === 404, 'otra cuenta no puede tocar esta tienda');
  ok((await other('GET', '/api/ventas')).json.sales.length === 0, 'las ventas son privadas');
  const sess = await user('PATCH', `/api/tiendas/${shopId}`, { session: 'a'.repeat(32) });
  ok(sess.status === 200 && !(await user('GET', '/api/tiendas')).text.includes('aaaaaaaa'), 'el código de sesión se guarda y no vuelve al navegador');
  await check(user, shopId);
  ok(((await get(fake + '/__stats')).calls.at(-2).cookie || '').includes('POESESSID=' + 'a'.repeat(32)), 'el código de sesión solo viaja al mercado');

  await post(fake + '/__set', { account: 'Ana#1234', items: [] });
  ok((await check(user, shopId)).json.status === 'no_data', 'tienda vacía de golpe: no se cree a la primera');
  await check(user, shopId);
  await check(user, shopId);
  ok((await user('GET', '/api/ventas')).json.sales.length === 3, 'si de verdad se vendió todo, se confirma en las dos lecturas siguientes');

  section('[9b] Revisor de precios');
  await post(fake + '/__market', { name: 'type:Sapphire Ring', items: [
    { id: 'r1', name: 'A', base: 'Sapphire Ring', price: { amount: 1, currency: 'divine' } },
    { id: 'r2', name: 'B', base: 'Sapphire Ring', price: { amount: 1.2, currency: 'divine' } },
    { id: 'r3', name: 'C', base: 'Sapphire Ring', price: { amount: 1.5, currency: 'divine' } },
  ] });
  await post(fake + '/__set', { account: 'Ana#1234', items: [items[0]] });
  await check(user, shopId); await check(user, shopId);
  let st = (await user('GET', '/api/tiendas')).json.shops[0];
  const ring = st.listings.find((l) => l.name === 'Storm Loop');
  ok(ring && ring.review === null, 'sin comparar todavía, el objeto no lleva etiqueta');
  const cmp = await user('POST', `/api/tiendas/${shopId}/objetos/${ring.id}/comparar`);
  ok(cmp.status === 200 && cmp.json.review.verdict === 'caro' && cmp.json.review.count === 3, 'a 3 divine frente a anuncios de 1–1,5 divine: «caro»');
  ok(cmp.json.review.suggested && cmp.json.review.suggested.currency === 'divine' && cmp.json.review.suggested.amount > 1 && cmp.json.review.suggested.amount < 1.6, 'propone un precio de mercado copiable');
  st = (await user('GET', '/api/tiendas')).json.shops[0];
  ok(st.listings.find((l) => l.name === 'Storm Loop').review.verdict === 'caro', 'la etiqueta queda en la tienda');
  await post(fake + '/__set', { account: 'Ana#1234', items: [{ ...items[0], id: 'L1c', price: { amount: 1.1, currency: 'divine' } }] });
  await check(user, shopId);
  st = (await user('GET', '/api/tiendas')).json.shops[0];
  ok(st.listings[0].review.verdict === 'en_precio', 'al bajar el precio deja de salir «caro» sin volver a comparar');
  ok((await other('POST', `/api/tiendas/${shopId}/objetos/${ring.id}/comparar`)).status === 404, 'nadie más puede comparar tus objetos');

  section('[9c] Prueba de conexión con el mercado');
  ok((await user('POST', '/api/admin/diagnostico')).status === 403, 'solo el administrador puede lanzarla');
  const dg = await admin('POST', '/api/admin/diagnostico');
  ok(dg.status === 200 && dg.json.steps.length === 5, 'hace los 5 pasos (ligas, tienda, búsqueda, divine, chaos)');
  ok(dg.json.steps[0].ok === true && /ligas/.test(dg.json.steps[0].detail), 'lee las ligas reales del juego');
  ok(dg.json.steps[1].ok === false && /Añade primero tu tienda/.test(dg.json.steps[1].detail), 'sin tienda, lo explica en vez de fallar');
  ok(dg.json.steps.slice(2).every((x) => x.ok) && /1 divine ≈/.test(dg.json.steps[3].detail), 'búsqueda y divisas funcionan contra el mercado');

  section('[9d] Ligas de verdad, cuenta bien escrita y ficha completa del objeto');
  const lg = await user('GET', '/api/ligas');
  ok(lg.status === 200 && lg.json.leagues.includes('Rise of the Abyssal') && lg.json.suggested === 'Rise of the Abyssal',
    'las ligas se leen del juego y propone la de temporada (no Standard)');
  const malaCuenta = await other('POST', '/api/tiendas', { account: 'SinNumero', league: 'Liga Prueba' });
  ok(malaCuenta.status === 400 && /almohadilla/.test(malaCuenta.json.error), 'una cuenta sin #número se rechaza explicando por qué');
  ok((await user('PATCH', `/api/tiendas/${shopId}`, { account: 'otra mala' })).status === 400, 'tampoco se puede dejar mal al editarla');

  // Modificadores en un campo distinto del habitual + nivel de objeto + corrupción.
  await post(fake + '/__set', { account: 'Ana#1234', items: [
    { id: 'R1', name: 'Anillo Raro', base: 'Sapphire Ring', price: { amount: 5, currency: 'divine' }, modsField: 'runeMods', mods: ['+15% a la velocidad de ataque'], ilvl: 82, corrupted: true },
    { id: 'R2', name: 'Mythic Terraform', base: 'Expedition Tablet', rarity: 'Normal', price: { amount: 5, currency: 'divine' }, mods: [], properties: [{ name: 'Nivel de monstruo', values: [['79', 0]] }] },
  ] });
  await check(user, shopId);
  let det = (await user('GET', '/api/tiendas')).json.shops[0].listings;
  const anillo = det.find((l) => l.name === 'Anillo Raro');
  const tablet = det.find((l) => l.name === 'Mythic Terraform');
  ok(anillo && anillo.stats[0] === '+15% a la velocidad de ataque', 'lee los modificadores aunque vengan en otro campo del mercado');
  ok(anillo && anillo.item_level === 82 && anillo.corrupted === true, 'guarda el nivel de objeto y la corrupción');
  ok(tablet && tablet.stats.includes('Nivel de monstruo: 79'), 'un objeto sin modificadores muestra sus propiedades en vez de quedarse en blanco');

  // Corregir la cuenta: se vacían los anuncios viejos y se lee la nueva.
  await post(fake + '/__set', { account: 'Beto#4321', items: [{ id: 'B1', name: 'Objeto de Beto', base: 'Sapphire Ring', price: { amount: 1, currency: 'divine' } }] });
  ok((await user('PATCH', `/api/tiendas/${shopId}`, { account: 'Beto#4321' })).status === 200, 'se puede corregir el nombre de la cuenta');
  ok(sql('SELECT COUNT(*) n FROM listings WHERE shop_id = ?', shopId)[0].n === 0, 'al cambiar de cuenta se vacían los anuncios antiguos');
  await check(user, shopId);
  det = (await user('GET', '/api/tiendas')).json.shops[0];
  ok(det.account === 'Beto#4321' && det.listings.length === 1 && det.listings[0].name === 'Objeto de Beto', 'y se lee la tienda de la cuenta nueva');

  // El tasador busca comparables en la liga de la tienda, no en Standard.
  await post(fake + '/__reset');
  await user('POST', '/api/tasar', { kind: 'texto', text: ITEM_TEXT });
  const rutas = (await get(fake + '/__stats')).calls.map((c) => c.path);
  ok(rutas.some((p) => p === '/search/' + encodeURIComponent('Liga Prueba')) && !rutas.some((p) => p === '/search/Standard'),
    'el tasador busca en la liga de tu tienda, no en Standard');

  // Se deja la tienda como estaba para las secciones siguientes.
  await user('PATCH', `/api/tiendas/${shopId}`, { account: 'Ana#1234' });
  await post(fake + '/__set', { account: 'Ana#1234', items: [items[0]] });
  await check(user, shopId);

  section('[10] Plan Mercader: varias tiendas y bajada de plan');
  await user('POST', '/api/checkout', { plan: 'mercader' });
  ok((await user('POST', '/api/tiendas', { account: 'Ana#5678', league: 'Liga Prueba' })).status === 201 && (await user('POST', '/api/tiendas', { account: 'Ana#9', league: 'Hardcore' })).status === 201, 'Mercader vigila 3 tiendas');
  ok((await user('POST', '/api/tiendas', { account: 'Ana#10', league: 'Hardcore' })).status === 402, 'la cuarta pide más plan');
  await user('POST', '/api/cancelar');
  shops = (await user('GET', '/api/tiendas')).json.shops;
  ok(shops[0].paused === false && shops[1].paused && shops[2].paused, 'al bajar de plan, las tiendas de más quedan en pausa (no se borran)');

  section('[11] Mercado limitado: sin ceros falsos');
  await post(fake + '/__mode', { mode: '429', retryAfter: 1 });
  const c429 = await check(user, shopId);
  ok(c429.json.status === 'rate_limited', 'el límite del mercado se detecta');
  shops = (await user('GET', '/api/tiendas')).json.shops;
  ok(shops[0].health.state === 'limited', 'se conservan los últimos datos y se muestra «pausa»');
  await post(fake + '/__mode', { mode: 'ok' });
  await sleep(1300);
  ok((await check(user, shopId)).json.status === 'ok', 'tras la pausa se recupera sola');

  section('[12] Divisas y deseos');
  await post(fake + '/__rates', { exPerDiv: 500, exPerChaos: 1.5 });
  sqlRun("INSERT INTO currency_price_history (taken_at, league, divine_per_exalted, chaos_per_exalted, source) VALUES (?, 'Liga Prueba', ?, ?, 'test')", Math.floor(Date.now() / 1000) - 3600, 1 / 480, 1 / 1.4);
  sqlRun("INSERT INTO currency_price_history (taken_at, league, divine_per_exalted, chaos_per_exalted, source) VALUES (?, 'Liga Prueba', ?, ?, 'test')", Math.floor(Date.now() / 1000), 1 / 500, 1 / 1.5);
  const mk = (await user('GET', '/api/mercado')).json;
  ok(Math.round(mk.rates.exPerDiv) === 500 && mk.history.length === 2 && !mk.rates.estimated, 'el mercado muestra la tasa y el historial de 7 días');
  await post(fake + '/__market', { name: 'Mageblood', items: [{ id: 'm1', name: 'Mageblood', base: 'Heavy Belt', rarity: 'Unique', price: { amount: 80, currency: 'divine' } }] });
  ok((await user('POST', '/api/deseos', { name: 'Mageblood', max: { amount: 100, currency: 'divine' } })).status === 201, 'deseo creado');
  ok((await user('POST', '/api/deseos', { name: 'X', max: { amount: 0, currency: 'div' } })).status === 400, 'un deseo mal escrito se explica');
  const wr = await user('POST', '/api/deseos/revisar');
  ok(wr.json.found === 1 && (await user('GET', '/api/deseos')).json.wishes[0].status === 'found', 'aparece por debajo del precio → encontrado');

  section('[12b] Prueba de conexión con el mercado bloqueado');
  await post(fake + '/__mode', { mode: '403' });
  await sleep(50);
  const dg2 = await admin('POST', '/api/admin/diagnostico');
  ok(dg2.json.ok === false && dg2.json.steps.some((x) => /rechazó|pausa/.test(x.detail)), 'si el mercado bloquea, lo dice en lenguaje claro');
  await post(fake + '/__mode', { mode: 'ok' });
  await waitUp(base + '/api/health');

  section('[13] Los datos sobreviven a una reinstalación');
  app.kill();
  await sleep(400);
  app = await startApp();
  const again = client();
  ok((await again('POST', '/api/login', { email: 'ana@ejemplo.com', password: 'clave-larga-ana1' })).status === 200, 'tras reiniciar, la cuenta sigue entrando');
  me = (await again('GET', '/api/yo')).json;
  ok(me.plan.key === 'gratis' && me.aiReady === true, 'conserva plan y la clave de la IA');
  const cp = await again('POST', '/api/clave', { current: 'clave-larga-ana1', next: 'nueva-clave-ana-1' });
  ok(cp.status === 200 && (await user('GET', '/api/yo')).status === 401, 'cambiar la contraseña cierra las otras sesiones');
  await again('POST', '/api/logout');
  ok((await again('GET', '/api/yo')).status === 401, 'cerrar sesión funciona');

  section('[14] Modo gratis (BILLING_MODE sin poner)');
  app.kill();
  await sleep(400);
  appEnv.BILLING_MODE = '';
  app = await startApp();
  const fr = client();
  await fr('POST', '/api/registro', { name: 'Gratis', email: 'gratis@ejemplo.com', password: 'clave-larga-gratis' });
  me = (await fr('GET', '/api/yo')).json;
  ok(me.billingMode === 'free' && me.credits === 30 && me.plan.intervalMin === 10 && me.plans.length === 1, 'todos en el plan gratis: 30 créditos, revisión cada 10 min, sin planes de pago');
  ok((await fr('POST', '/api/checkout', { plan: 'pro' })).status === 400, 'no se puede pagar nada');
  sqlRun("UPDATE users SET credits = 0 WHERE email = 'gratis@ejemplo.com'");
  const fz = await fr('POST', '/api/tasar', { kind: 'texto', text: ITEM_TEXT });
  ok(fz.status === 402 && !fz.json.needCredits && /se recargan/i.test(fz.json.error), 'sin créditos: aviso de que se recargan cada mes (sin ofrecer pagos)');
} catch (e) {
  fail++;
  console.log('  FAIL error inesperado:', e && e.stack ? e.stack : e);
} finally {
  for (const p of procs) p.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(`\nRESULTADO: ${pass} correctas, ${fail} fallidas`);
  process.exit(fail ? 1 : 0);
}
