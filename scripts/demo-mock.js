/* Capa de DEMO: responde a /api/* dentro del navegador con datos inventados. No hay servidor, mercado ni IA reales. */
(function () {
  'use strict';
  const T = () => Math.floor(Date.now() / 1000);
  const D = 86400;
  const t0 = T();
  const rates = { exPerDiv: 312, exPerChaos: 1.6, estimated: false, takenAt: t0 - 1800 };
  const plan = { key: 'gratis', label: 'Gratis', shops: 1, intervalMin: 10, credits: 30, wishes: 25 };
  const state = {
    credits: 27,
    renewsAt: t0 + 23 * D,
    unseen: 1,
    pushOn: false,
    lastManual: 0,
    listings: [
      { id: 1, name: 'Storm Loop', base_type: 'Sapphire Ring', rarity: 'Rare', price_amount: 3, price_currency: 'divine', stats: ['+18% to Cold Resistance (implicit)', '+72 to maximum Life', '+38% to Fire Resistance', '+41% to Lightning Resistance', '+29 to Dexterity'], days: 2, stash_tab: 'Venta 1' },
      { id: 2, name: 'Headhunter', base_type: 'Heavy Belt', rarity: 'Unique', price_amount: 41, price_currency: 'divine', stats: ['+25 to Strength (implicit)', '+52 to maximum Life', '+40 to Dexterity', 'When you Kill a Rare monster, you gain its Modifiers for 20 seconds'], days: 9, stash_tab: 'Venta 1' },
      { id: 3, name: 'Doom Visor', base_type: 'Hubris Circlet', rarity: 'Rare', price_amount: 150, price_currency: 'exalted', stats: ['+92 to maximum Energy Shield', '+31% to Chaos Resistance', '+48 to Intelligence'], days: 1, stash_tab: 'Venta 1' },
      { id: 4, name: 'Vile Grip', base_type: 'Riveted Gloves', rarity: 'Magic', price_amount: 12, price_currency: 'exalted', stats: ['+18% increased Attack Speed'], days: 0, stash_tab: 'Venta 2' },
      { id: 5, name: "Kaom's Heart", base_type: 'Glorious Plate', rarity: 'Unique', price_amount: 9, price_currency: 'divine', stats: ['Has no Sockets', '+500 to maximum Life'], days: 4, stash_tab: 'Venta 1' },
      { id: 6, name: 'Grim Coil', base_type: 'Amethyst Ring', rarity: 'Rare', price_amount: 80, price_currency: 'chaos', stats: ['+13% to Chaos Resistance (implicit)', '+64 to maximum Life', '+22% to Cold Resistance'], days: 11, stash_tab: 'Venta 2' },
      { id: 7, name: 'Rune Hoop', base_type: 'Gold Ring', rarity: 'Rare', price_amount: 220, price_currency: 'exalted', stats: ['+12% increased Rarity of Items found (implicit)', '+55 to maximum Life', '+35% to Lightning Resistance'], days: 3, stash_tab: 'Venta 2' },
      { id: 8, name: 'Bramble Ward', base_type: 'Ironwood Buckler', rarity: 'Rare', price_amount: 2, price_currency: 'divine', stats: ['+180% increased Evasion Rating', '+70 to maximum Life'], days: 6, stash_tab: 'Venta 1' },
    ],
    sales: [
      { id: 101, name: 'Mjölner', base_type: 'Gavel', rarity: 'Unique', price_amount: 7, price_currency: 'divine', at: t0 - 1500, days: 3, seen: false },
      { id: 102, name: 'Dusk Spire', base_type: 'Gemini Bow', rarity: 'Rare', price_amount: 260, price_currency: 'exalted', at: t0 - 6 * 3600, days: 1, seen: true },
      { id: 103, name: 'Hale Coat', base_type: 'Full Plate', rarity: 'Rare', price_amount: 90, price_currency: 'exalted', at: t0 - D - 3000, days: 5, seen: true },
      { id: 104, name: 'Astramentis', base_type: 'Onyx Amulet', rarity: 'Unique', price_amount: 4, price_currency: 'divine', at: t0 - D - 9000, days: 2, seen: true },
      { id: 105, name: 'Swift Grasp', base_type: 'Suede Bracers', rarity: 'Magic', price_amount: 30, price_currency: 'chaos', at: t0 - 3 * D, days: 0, seen: true },
      { id: 106, name: 'Gloom Crown', base_type: 'Vaal Mask', rarity: 'Rare', price_amount: 1.5, price_currency: 'divine', at: t0 - 5 * D, days: 8, seen: true },
      { id: 107, name: 'Viper Fang', base_type: 'Spiked Spear', rarity: 'Rare', price_amount: 3, price_currency: 'divine', at: t0 - 9 * D, days: 2, seen: true },
      { id: 108, name: "Atziri's Step", base_type: 'Slink Boots', rarity: 'Unique', price_amount: 2, price_currency: 'divine', at: t0 - 12 * D, days: 4, seen: true },
      { id: 109, name: 'Storm Ward', base_type: 'Tower Shield', rarity: 'Rare', price_amount: 180, price_currency: 'exalted', at: t0 - 16 * D, days: 1, seen: true },
      { id: 110, name: 'Bone Idol', base_type: 'Jade Amulet', rarity: 'Rare', price_amount: 5.5, price_currency: 'divine', at: t0 - 21 * D, days: 6, seen: true },
      { id: 111, name: 'Ember Grasp', base_type: 'Stocky Mitts', rarity: 'Magic', price_amount: 40, price_currency: 'exalted', at: t0 - 25 * D, days: 0, seen: true },
    ],
    wishes: [
      { id: 1, item_name: 'Mageblood', league: 'Rise of the Abyssal', max_amount: 120, max_currency: 'divine', status: 'watching', last_checked_at: t0 - 1500, created_at: t0 - 3 * D },
      { id: 2, item_name: 'Astramentis', league: 'Rise of the Abyssal', max_amount: 3, max_currency: 'divine', status: 'found', found_amount: 2.6, found_currency: 'divine', found_at: t0 - 7200, created_at: t0 - 5 * D },
    ],
    appraisals: [],
    ledger: [
      { delta: -1, balance_after: 27, reason: 'Tasación por texto', created_at: t0 - 7200 },
      { delta: -2, balance_after: 28, reason: 'Tasación por captura', created_at: t0 - D },
      { delta: 30, balance_after: 30, reason: 'Recarga mensual (Gratis)', created_at: t0 - 7 * D },
    ],
  };
  const R = (verdict, minDiv, medDiv, count) => ({ verdict, count, minEx: minDiv * 312, medianEx: medDiv * 312, checkedAt: t0 - 2400, suggested: verdict === 'caro' ? (medDiv >= 1 ? { amount: medDiv, currency: 'divine' } : { amount: Math.round(medDiv * 312), currency: 'exalted' }) : null });
  const reviews = { 1: R('en_precio', 2.4, 2.9, 9), 2: R('caro', 33, 35, 7), 3: R('en_precio', 0.4, 0.5, 10), 6: R('barato', 0.6, 0.8, 6), 7: R('caro', 0.45, 0.55, 8), 8: R('en_precio', 1.7, 2.1, 9) };
  const toEx = (a, c) => (a == null ? null : c === 'divine' ? a * rates.exPerDiv : c === 'chaos' ? a * rates.exPerChaos : a);
  const value = () => state.listings.reduce((s, l) => s + (toEx(l.price_amount, l.price_currency) || 0), 0);
  const history = Array.from({ length: 30 }, (_, i) => ({ taken_at: t0 - (29 - i) * D, total_ex: value() * (0.78 + 0.22 * Math.sin(i / 4.5) * 0.5 + i * 0.008), item_count: 8 }));
  const divHist = Array.from({ length: 28 }, (_, i) => ({ t: t0 - (27 - i) * 6 * 3600, exPerDiv: 296 + i * 0.55 + Math.sin(i / 2.3) * 4, exPerChaos: 1.6 }));

  function me() {
    return {
      user: { id: 1, name: 'Randy', email: 'randy@ejemplo.com', role: 'member' },
      plan, credits: state.credits, renewsAt: state.renewsAt, costs: { texto: 1, captura: 2 },
      plans: [{ key: 'gratis', priceUsd: 0, ...plan }], billingMode: 'free', aiReady: true,
      push: { enabled: state.pushOn, devices: state.pushOn ? 1 : 0, key: 'BDemo' }, unseenSales: state.unseen, defaultLeague: 'Rise of the Abyssal',
      appraisalsCount: state.appraisals.length, shopsCount: 1,
    };
  }
  function shop() {
    return {
      id: 1, account: 'Randy#4821', league: 'Rise of the Abyssal', paused: false, hasSession: false, bigSale: { amount: 10, currency: 'divine' },
      health: { state: 'ok', lastAt: state.lastManual || t0 - 240, lastOkAt: state.lastManual || t0 - 240 }, running: false,
      cooldownUntil: state.lastManual ? state.lastManual + 90 : null,
      listings: state.listings.map((l) => ({ ...l, icon: null, ex: toEx(l.price_amount, l.price_currency), review: reviews[l.id] || null })),
      valueEx: value(), history: history.concat([{ taken_at: T(), total_ex: value(), item_count: state.listings.length }]),
    };
  }

  function parseItem(text) {
    const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    const r = (lines.find((l) => /^(Rarity|Rareza)\s*:/i.test(l)) || '').split(':')[1];
    const rarity = /uniq|únic|unic/i.test(r || '') ? 'Unique' : /mag/i.test(r || '') ? 'Magic' : /norm/i.test(r || '') ? 'Normal' : 'Rare';
    const head = lines.filter((l) => !/:/.test(l) && !/^-+$/.test(l));
    const sepIdx = lines.findIndex((l) => /^-{4,}$/.test(l));
    const mods = lines.slice(sepIdx + 1).filter((l) => /\d/.test(l) && !/^(Item Level|Nivel de objeto|Requires|Requiere)/i.test(l));
    const lvl = (lines.find((l) => /^(Item Level|Nivel de objeto)/i.test(l)) || '').replace(/\D/g, '');
    return { rarity, name: head[0] || 'Objeto', base: head[1] || head[0] || 'Objeto', itemLevel: lvl ? Number(lvl) : null, mods: mods.slice(0, 12) };
  }

  function appraise(item, kind) {
    const life = item.mods.find((m) => /maximum Life/i.test(m));
    const lifeN = life ? Number((life.match(/\d+/) || [0])[0]) : 0;
    const res = item.mods.filter((m) => /Resistance/i.test(m) && !/implicit/i.test(m)).length;
    let div = Math.max(0.3, Math.round((0.4 + lifeN / 40 + res * 0.6 + (item.rarity === 'Unique' ? 2.5 : 0)) * 10) / 10);
    const useDiv = div >= 1;
    const p = (v) => (useDiv ? { cantidad: Math.round(v * 10) / 10, moneda: 'divine' } : { cantidad: Math.round(v * rates.exPerDiv), moneda: 'exalted' });
    const comps = [0.8, 1.05, 1.3, 1.6, 2.2].map((f, i) => ({ price_amount: useDiv ? Math.round(div * f * 10) / 10 : Math.round(div * f * rates.exPerDiv), price_currency: useDiv ? 'divine' : 'exalted', ex: div * f * rates.exPerDiv, mods: item.mods.slice(i % 2, (i % 2) + 2), name: item.base }));
    const result = {
      nombre: item.name, precio: p(div), venta_rapida: p(div * 0.82), rango: { min: p(div * 0.85).cantidad, max: p(div * 1.3).cantidad, moneda: p(div).moneda },
      confianza: comps.length >= 5 ? 'media' : 'baja',
      razones: [
        `El anuncio más barato de esta base con mods parecidos pide ${comps[0].price_amount} ${comps[0].price_currency}.`,
        lifeN ? `Tu vida (+${lifeN}) está por encima de la mitad de los anuncios.` : 'Sin vida, el objeto vale sobre todo por sus otros mods.',
        res ? `${res} resistencia(s) en el mismo objeto suben el precio.` : 'Sin resistencias, compite con muchos anuncios baratos.',
      ],
      lo_que_vale: item.mods.filter((m) => /Life|Resistance|Speed|Energy/i.test(m)).slice(0, 3),
      consejo: 'Si en dos días no se vende, bájalo un 10 %.',
      mercado: { estado: 'ok', total: 23, resumen: { count: 5, min: comps[0].ex, median: comps[2].ex, max: comps[4].ex }, muestras: comps },
      tasas: { exPerDiv: rates.exPerDiv, estimated: false },
    };
    const cost = kind === 'captura' ? 2 : 1;
    state.credits -= cost;
    state.ledger.unshift({ delta: -cost, balance_after: state.credits, reason: `Tasación por ${kind}`, created_at: T() });
    state.appraisals.unshift({ id: state.appraisals.length + 1, kind, item_name: item.name, cost, created_at: T(), item, result });
    return { id: state.appraisals.length, item, result, cost, credits: state.credits };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  const err = (status, msg, extra) => reply(status, { error: msg, ...(extra || {}) });

  async function handle(method, path, body) {
    await sleep(120);
    if (path === '/api/yo') return reply(200, me());
    if (path === '/api/tiendas' && method === 'GET') return reply(200, { shops: [shop()], rates, limit: 1, intervalMin: 10, marketBlocked: false });
    if (path === '/api/tiendas' && method === 'POST') return err(402, 'Por ahora cada cuenta vigila 1 tienda.');
    if (/^\/api\/tiendas\/1\/revisar$/.test(path)) {
      if (state.lastManual && T() - state.lastManual < 90) return err(429, `Espera ${90 - (T() - state.lastManual)} s para volver a revisar.`);
      await sleep(900);
      state.lastManual = T();
      const sold = state.listings.find((l) => l.name === 'Vile Grip');
      if (sold) {
        state.listings = state.listings.filter((l) => l !== sold);
        state.sales.unshift({ id: 200, name: sold.name, base_type: sold.base_type, rarity: sold.rarity, price_amount: sold.price_amount, price_currency: sold.price_currency, at: T(), days: 0, seen: false });
        state.unseen += 1;
        return reply(200, { status: 'ok', count: state.listings.length, sales: 1, reprices: 0 });
      }
      return reply(200, { status: 'ok', count: state.listings.length, sales: 0, reprices: 0 });
    }
    if (/^\/api\/tiendas\/1\/objetos\/\d+\/comparar$/.test(path)) {
      await sleep(1200);
      const id = Number(path.split('/')[5]);
      if (!reviews[id]) reviews[id] = R('en_precio', 0.9, 1.1, 7);
      reviews[id].checkedAt = T();
      return reply(200, { review: reviews[id], count: reviews[id].count });
    }
    if (/^\/api\/tiendas\/1$/.test(path)) return err(400, 'En la demo los ajustes de la tienda no se guardan.');
    if (path === '/api/ventas' && method === 'GET') {
      const sales = state.sales.map((s) => ({ id: s.id, name: s.name, base_type: s.base_type, rarity: s.rarity, icon: null, shop: 'Randy#4821', shop_id: 1, price_amount: s.price_amount, price_currency: s.price_currency, ex: toEx(s.price_amount, s.price_currency), days_listed: s.days, detected_at: s.at, seen: s.seen }));
      const win = (d) => sales.filter((s) => s.detected_at > T() - d * D);
      const tot = (a) => ({ n: a.length, ex: a.reduce((x, s) => x + (s.ex || 0), 0) });
      return reply(200, { sales, rates, totals: { d7: tot(win(7)), d30: tot(win(30)) }, shops: [{ id: 1, poe_account: 'Randy#4821', league: 'Rise of the Abyssal' }] });
    }
    if (path === '/api/ventas/vistas') { state.sales.forEach((s) => (s.seen = true)); state.unseen = 0; return reply(200, { ok: true }); }
    if (path === '/api/mercado') return reply(200, { rates, history: divHist, league: 'Rise of the Abyssal', queue: { blocked: false } });
    if (path === '/api/deseos' && method === 'GET') return reply(200, { wishes: state.wishes, limit: 25 });
    if (path === '/api/deseos' && method === 'POST') {
      const amount = Number(body.max && body.max.amount);
      if (!body.name || String(body.name).trim().length < 3) return err(400, 'Escribe el nombre exacto del objeto (por ejemplo «Headhunter»).');
      if (!(amount > 0)) return err(400, 'Revisa el precio máximo: pon una cantidad y una moneda (exalted, divine o chaos).');
      state.wishes.unshift({ id: Date.now(), item_name: String(body.name).trim(), league: 'Rise of the Abyssal', max_amount: amount, max_currency: body.max.currency, status: 'watching', last_checked_at: null, created_at: T() });
      return reply(201, { ok: true });
    }
    if (/^\/api\/deseos\/\d+$/.test(path)) { const id = Number(path.split('/').pop()); state.wishes = state.wishes.filter((w) => w.id !== id); return reply(200, { ok: true }); }
    if (path === '/api/deseos/revisar') { await sleep(800); return reply(200, { checked: state.wishes.length, found: 0 }); }
    if (path === '/api/tasar') {
      const kind = body.kind === 'captura' ? 'captura' : 'texto';
      const cost = kind === 'captura' ? 2 : 1;
      if (state.credits < cost) return err(402, `Usaste tus tasaciones de este mes. Se recargan cada mes.`, { credits: state.credits });
      let item;
      if (kind === 'texto') {
        if (!/(Rarity|Rareza)\s*:/i.test(body.text || '')) return err(400, 'No reconozco ese texto. En el juego, pasa el ratón por el objeto, pulsa Ctrl+C y pégalo aquí.', { credits: state.credits });
        item = parseItem(body.text);
      } else {
        item = { rarity: 'Rare', name: 'Storm Loop', base: 'Sapphire Ring', itemLevel: 79, mods: ['+72 to maximum Life', '+38% to Fire Resistance', '+41% to Lightning Resistance'] };
      }
      await sleep(kind === 'captura' ? 2200 : 1500);
      return reply(200, appraise(item, kind));
    }
    if (path === '/api/tasaciones') return reply(200, { appraisals: state.appraisals });
    if (path === '/api/cuenta') return reply(200, { ...me(), sub: null, payments: [], ledger: state.ledger });
    if (path === '/api/clave') return err(400, 'En la demo no se cambian contraseñas.');
    if (path === '/api/logout') return err(400, 'Es una demo: no hay sesión que cerrar.');
    if (path.startsWith('/api/push')) return reply(200, { delivered: 0 });
    return err(404, 'En la demo esta acción no está disponible.');
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, opt) {
    const url = typeof input === 'string' ? input : input.url;
    if (!/^\/api\//.test(url)) return realFetch(input, opt);
    let body = {};
    try { body = opt && opt.body ? JSON.parse(opt.body) : {}; } catch {}
    return handle((opt && opt.method) || 'GET', url.split('?')[0], body);
  };
  // En la vista previa no existen las ventanas nativas de confirmación: en la demo se aceptan solas.
  window.confirm = () => true;
})();
