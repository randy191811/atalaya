// IA falsa SOLO para pruebas locales: imita las respuestas de Anthropic (/v1/messages) y Gemini.
// Se controla con /__mode {mode: ok|fail|garbage} y se inspecciona con /__stats.
import http from 'node:http';

const PORT = Number(process.env.FAKE_AI_PORT || 4020);
const GOOD_ANTHROPIC = 'sk-ant-api03-PRUEBA-buena-0000000000000000';
const GOOD_GEMINI = 'AIzaPRUEBAbuena0000000000000000000';
const state = { mode: 'ok', calls: [] };

const appraisal = {
  nombre: 'Storm Loop', precio: { cantidad: 3, moneda: 'divine' }, venta_rapida: { cantidad: 2.4, moneda: 'div' },
  rango: { min: 2.5, max: 4, moneda: 'divine' }, confianza: 'media',
  razones: ['El más barato con vida y dos resistencias pide 2,5 div.', 'Tu anillo tiene más vida que la mitad de los anuncios.'],
  lo_que_vale: ['+72 to maximum Life', '+41% to Lightning Resistance'], consejo: 'Si en dos días no se vende, bájalo a 2,6 div.',
};
const read = { es_objeto: true, rareza: 'Rare', nombre: 'Storm Loop', base: 'Sapphire Ring', clase: 'Rings', nivel_objeto: 79, modificadores: ['+72 to maximum Life', '+38% to Fire Resistance'], corrupto: false };

const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : {})); });
const json = (res, st, o) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__mode') { state.mode = (await body(req)).mode; return json(res, 200, { ok: true }); }
  if (u.pathname === '/__stats') return json(res, 200, { calls: state.calls });
  if (u.pathname === '/__reset') { state.calls = []; return json(res, 200, {}); }

  if (u.pathname === '/v1/messages' && req.method === 'POST') {
    const b = await body(req);
    const key = req.headers['x-api-key'];
    if (key !== GOOD_ANTHROPIC) return json(res, 401, { error: { type: 'authentication_error' } });
    const content = b.messages[0].content;
    const text = typeof content === 'string' ? content : content.map((c) => c.text || '').join(' ');
    const hasImage = Array.isArray(content) && content.some((c) => c.type === 'image');
    state.calls.push({ engine: 'claude', model: b.model, hasImage, prompt: text.slice(0, 4000), max_tokens: b.max_tokens });
    if (b.max_tokens <= 4) return json(res, 200, { content: [{ type: 'text', text: 'ok' }] });
    if (state.mode === 'fail') return json(res, 529, { error: { type: 'overloaded_error' } });
    if (state.mode === 'garbage') return json(res, 200, { content: [{ type: 'text', text: 'no sé' }] });
    const out = /Transcribe el objeto/.test(text) ? read : appraisal;
    return json(res, 200, { content: [{ type: 'text', text: '```json\n' + JSON.stringify(out) + '\n```' }] });
  }
  if (u.pathname === '/v1beta/models' && req.method === 'GET') {
    return u.searchParams.get('key') === GOOD_GEMINI ? json(res, 200, { models: [] }) : json(res, 400, { error: 'API key not valid' });
  }
  if (/^\/v1beta\/models\/.+:generateContent$/.test(u.pathname)) {
    if (u.searchParams.get('key') !== GOOD_GEMINI) return json(res, 400, {});
    state.calls.push({ engine: 'gemini' });
    if (state.mode === 'fail') return json(res, 503, {});
    // imita el fallo conocido de Gemini: corchete duplicado al cerrar
    const t = JSON.stringify(appraisal).replace(/\]\}$/, ']]}');
    return json(res, 200, { candidates: [{ content: { parts: [{ text: t + ' ]' }] }, finishReason: 'STOP' }] });
  }
  json(res, 404, {});
}).listen(PORT, '127.0.0.1', () => console.log('[fake-ai] http://127.0.0.1:' + PORT));
