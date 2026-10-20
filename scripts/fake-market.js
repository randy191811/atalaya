// Mercado falso SOLO para pruebas locales (imita la forma de las respuestas descritas en el dossier).
// Se controla con /__set, /__market, /__rates, /__mode y se inspecciona con /__stats.
import http from 'node:http';

const PORT = Number(process.env.FAKE_PORT || 4010);
const state = {
  shops: {}, // account -> items[]
  market: {}, // name -> items[]
  rates: { exPerDiv: 640, exPerChaos: 0.02 * 50 }, // exalted por divine / por chaos
  mode: 'ok', // ok | 429 | 403 | empty
  retryAfter: 2,
  leagues: ['Standard', 'Hardcore', 'Rise of the Abyssal'],
  calls: [], // {t, method, path, cookie}
};

// `modsField` permite imitar que el mercado manda los modificadores en otro campo
// (implicitMods, runeMods, uno nuevo…) y comprobar que se leen igual.
const entry = (id, it) => {
  const item = {
    name: it.name,
    typeLine: it.base || it.name,
    baseType: it.base || it.name,
    rarity: it.rarity || 'Rare',
    icon: it.icon || 'https://web.poecdn.com/gen/image/fake.png',
  };
  if (it.ilvl) item.ilvl = it.ilvl;
  if (it.corrupted) item.corrupted = true;
  if (it.properties) item.properties = it.properties;
  if (it.extendedMods) item.extended = { mods: it.extendedMods };
  item[it.modsField || 'explicitMods'] = it.mods || [];
  return {
    id,
    listing: { price: it.price, account: { name: 'tester' }, stash: { name: it.stash || 'Tienda' }, indexed: new Date().toISOString() },
    item,
  };
};

function json(res, status, obj, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Rate-Limit-Ip': '8:10:60,15:60:120,60:300:1800',
    'X-Rate-Limit-Ip-State': '1:10:0,2:60:0,2:300:0',
    ...headers,
  });
  res.end(JSON.stringify(obj));
}
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : {})); });

const queries = new Map(); // searchId -> ids
const byId = new Map(); // id -> entry

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/__stats') return json(res, 200, { calls: state.calls, mode: state.mode });
    if (p === '/__reset') { state.calls = []; return json(res, 200, { ok: true }); }
    if (p === '/__mode') { const b = await body(req); state.mode = b.mode; if (b.retryAfter) state.retryAfter = b.retryAfter; return json(res, 200, { ok: true }); }
    if (p === '/__rates') { Object.assign(state.rates, await body(req)); return json(res, 200, state.rates); }
    if (p === '/__set') { const b = await body(req); state.shops[b.account] = b.items; return json(res, 200, { ok: true, n: b.items.length }); }
    if (p === '/__market') { const b = await body(req); state.market[b.name] = b.items; return json(res, 200, { ok: true }); }
    if (p === '/__leagues') { const b = await body(req); state.leagues = b.leagues; return json(res, 200, { ok: true }); }

    state.calls.push({ t: Date.now(), method: req.method, path: p, cookie: req.headers.cookie || null, ua: req.headers['user-agent'] });
    if (state.mode === '429') return json(res, 429, { error: 'rate' }, { 'Retry-After': String(state.retryAfter) });
    if (state.mode === '403') return json(res, 403, { error: 'blocked' });

    if (p === '/data/leagues' && req.method === 'GET') {
      if (state.mode === 'empty') return json(res, 200, { result: [] });
      return json(res, 200, { result: (state.leagues || ['Standard', 'Hardcore']).map((id) => ({ id, text: id })) });
    }
    let m;
    if ((m = p.match(/^\/search\/(.+)$/)) && req.method === 'POST') {
      const b = await body(req);
      const account = b.query && b.query.filters && b.query.filters.trade_filters && b.query.filters.trade_filters.filters.account;
      let list = [];
      if (account) list = state.mode === 'empty' ? [] : state.shops[account.input] || [];
      else if (b.query && b.query.name) list = state.market[b.query.name] || [];
      else if (b.query && b.query.type) list = state.market['type:' + b.query.type] || [];
      const sid = 'q' + (queries.size + 1);
      const ids = list.map((it) => {
        const id = it.id || 'id_' + Math.abs(hash(JSON.stringify(it)));
        byId.set(id, entry(id, it));
        return id;
      });
      queries.set(sid, ids);
      return json(res, 200, { id: sid, result: ids, total: ids.length });
    }
    if ((m = p.match(/^\/fetch\/(.+)$/)) && req.method === 'GET') {
      const ids = decodeURIComponent(m[1]).split(',');
      if (ids.length > 10) return json(res, 400, { error: 'max 10' });
      return json(res, 200, { result: ids.map((i) => byId.get(i) || null) });
    }
    if ((m = p.match(/^\/exchange\/(.+)$/)) && req.method === 'POST') {
      const b = await body(req);
      const want = b.query.want[0];
      const ratio = want === 'CurrencyModValues' || want === 'divine' ? state.rates.exPerDiv : state.rates.exPerChaos;
      const result = {};
      for (let i = 0; i < 6; i++) {
        const r = ratio * (1 + i * 0.01);
        result['o' + i] = { listing: { offers: [{ exchange: { currency: b.query.have[0], amount: Math.round(r * 100) / 100 * 10 }, item: { currency: want, amount: 10, stock: 50 } }] } };
      }
      return json(res, 200, { id: 'x1', result });
    }
    json(res, 404, { error: 'nope' });
  })
  .listen(PORT, '127.0.0.1', () => console.log('[fake-market] http://127.0.0.1:' + PORT));

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
