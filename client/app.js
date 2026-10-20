/* Atalaya — aplicación. Sin librerías. Todo el texto que viene del servidor se escapa antes de pintarlo. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- utilidades
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n, d = 0) => Number(n).toLocaleString('es', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const CUR = { exalted: 'ex', divine: 'div', chaos: 'chaos' };
  const CUR_LONG = { exalted: 'exalted', divine: 'divine', chaos: 'chaos' };
  const curLabel = (c) => CUR[String(c || '').toLowerCase()] || esc(c || '');
  const price = (a, c) => (a == null ? 'sin precio' : `${nf(a, 2)} ${curLabel(c)}`);
  const exFmt = (ex, rates) => {
    if (ex == null) return '—';
    if (rates && ex >= rates.exPerDiv) return `${nf(ex / rates.exPerDiv, ex / rates.exPerDiv >= 10 ? 1 : 2)} div`;
    return `${nf(ex, ex >= 100 ? 0 : 1)} ex`;
  };
  const ago = (t) => {
    if (!t) return 'nunca';
    const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
    if (s < 60) return 'hace un momento';
    if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
    if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
    return `hace ${Math.floor(s / 86400)} d`;
  };
  const dateFmt = (t) => new Date(t * 1000).toLocaleDateString('es', { day: 'numeric', month: 'long' });
  const timeFmt = (t) => new Date(t * 1000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const safe = (fn) => { try { return fn(); } catch (e) { console.error(e); } };

  async function api(method, path, body) {
    const opt = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(path, opt); } catch { throw Object.assign(new Error('No hay conexión con el servidor. Revisa tu internet.'), { status: 0 }); }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw Object.assign(new Error(data.error || 'Algo salió mal. Inténtalo de nuevo.'), { status: res.status, data });
    return data;
  }

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'err' ? 7000 : 4500);
  }

  // ---------------------------------------------------------------- estado
  let me = null;
  let currentView = null;
  let pollTimer = null;
  let activeShop = null;
  let lastUnseen = 0;
  let lastUnseenKnown = false;

  function setCredits(n, animate) {
    if (me) me.credits = n;
    $('#credits-n').textContent = n == null ? '–' : nf(n);
    if (me && me.plan && me.plan.credits) $('#credits-pill').style.setProperty('--fill', String(Math.max(0, Math.min(1, n / me.plan.credits))));
    if (animate) { const p = $('#credits-pill'); p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }
  }

  async function loadMe() {
    me = await api('GET', '/api/yo');
    setCredits(me.credits);
    $$('[data-admin]').forEach((a) => a.classList.toggle('hidden', me.user.role !== 'admin'));
    $$('.top .demo-badge').forEach((b) => b.classList.toggle('hidden', me.billingMode !== 'mock'));
    const dot = $('[data-unseen]');
    dot.textContent = me.unseenSales;
    dot.classList.toggle('hidden', !me.unseenSales);
    if (me.unseenSales > lastUnseen && lastUnseenKnown) { toast('¡Vendiste algo!', 'ok'); celebrate(); }
    lastUnseenKnown = true;
    lastUnseen = me.unseenSales;
    return me;
  }

  // ---------------------------------------------------------------- router
  const TITLES = { tienda: 'Tienda', ventas: 'Ventas', tasador: 'Tasador', mercado: 'Mercado', deseos: 'Deseos', cuenta: 'Cuenta y plan', admin: 'Administrar' };
  const VIEWS = {};

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, qs] = h.split('?');
    return { name: name || 'tienda', q: new URLSearchParams(qs || '') };
  }

  async function route() {
    const { name, q } = parseHash();
    if (!me) {
      try { await loadMe(); } catch (e) {
        if (e.status === 401) return showAuth(name === 'registro' || /plan=/.test(location.hash) ? 'registro' : 'entrar');
        return showFatal(e.message);
      }
    }
    if (name === 'entrar' || name === 'registro') { location.hash = '#/tienda'; return; }
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    const v = VIEWS[name] ? name : 'tienda';
    currentView = v;
    $('#view-title').textContent = TITLES[v];
    document.title = `${TITLES[v]} · Atalaya`;
    $$('[data-v]').forEach((a) => (a.dataset.v === v ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    clearInterval(pollTimer);
    const view = $('#view');
    moveRail();
    view.innerHTML = '<div class="skel" aria-label="Cargando"><i class="s1"></i><i class="s2"></i><i class="s3"></i><i class="s3"></i></div>';
    try {
      await VIEWS[v](view, q);
      view.classList.remove('view-enter'); void view.offsetWidth; view.classList.add('view-enter');
      enhance(view);
    } catch (e) {
      if (e.status === 401) { me = null; return showAuth('entrar'); }
      view.innerHTML = `<div class="panel empty"><h3>No se pudo cargar</h3><p>${esc(e.message)}</p><button class="btn" data-retry>Reintentar</button></div>`;
      $('[data-retry]', view).onclick = route;
    }
  }

  function showFatal(msg) {
    document.body.innerHTML = `<div class="auth"><div class="panel auth-box"><h2>No se pudo abrir Atalaya</h2><p>${esc(msg)}</p><a class="btn" href="/app.html">Reintentar</a></div></div>`;
  }

  // ---------------------------------------------------------------- acceso
  function showAuth(which) {
    $('#app').classList.add('hidden');
    $('#auth').classList.remove('hidden');
    $('#login-form').classList.toggle('hidden', which !== 'entrar');
    $('#register-form').classList.toggle('hidden', which !== 'registro');
    document.title = which === 'registro' ? 'Crear cuenta · Atalaya' : 'Entrar · Atalaya';
    const inv = new URLSearchParams(location.hash.split('?')[1] || '').get('invitacion');
    if (inv) { $('#re-invite-wrap').classList.remove('hidden'); $('#re-invite').value = inv; }
  }

  function bindAuth() {
    const submit = (form, path) => form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try {
        await api('POST', path, Object.fromEntries(new FormData(form)));
        me = null;
        const back = sessionStorageGet('after-login');
        location.hash = back || '#/tienda';
        sessionStorageSet('after-login', '');
        route();
      } catch (e) {
        if (/invitación/i.test(e.message)) $('#re-invite-wrap').classList.remove('hidden');
        toast(e.message, 'err');
      } finally { btn.disabled = false; }
    });
    submit($('#login-form'), '/api/login');
    submit($('#register-form'), '/api/registro');
  }
  function sessionStorageGet(k) { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch {} }

  // ---------------------------------------------------------------- piezas
  const txtOf = (m) => (typeof m === 'string' ? m : m && typeof m === 'object' ? String(m.name || m.text || '') : m == null ? '' : String(m));

  // La ficha, con los mismos bloques y en el mismo orden que el juego: propiedades,
  // requisitos, nivel, implícitos, afijos, cómo se usa y texto de sabor.
  function tooltipHtml(it) {
    const r = esc(it.rarity || 'Normal');
    const twoLines = (it.rarity === 'Rare' || it.rarity === 'Unique') && it.base && it.base !== it.name;
    const title = twoLines ? `${esc(it.name)}<br>${esc(it.base)}` : esc(it.name || it.base || 'Objeto');
    const blocks = [];
    // En el juego la etiqueta de una propiedad va en gris y su valor resaltado
    // («Quality: +3%», «Spirit: 114»). Se separa por los primeros dos puntos.
    const propLine = (x) => {
      const i = x.indexOf(': ');
      return i > 0
        ? `<div class="tip-prop">${esc(x.slice(0, i + 1))} <b>${esc(x.slice(i + 2))}</b></div>`
        : `<div class="tip-prop">${esc(x)}</div>`;
    };
    // Los números van resaltados, como en el juego («Requiere: Level 31, 20 Str»).
    const metaLine = (x) => `<div class="tip-meta">${esc(x).replace(/(\d[\d.,]*)/g, '<b>$1</b>')}</div>`;
    const block = (arr, cls) => {
      const xs = (arr || []).map(txtOf).filter(Boolean);
      const fn = cls === 'tip-prop' ? propLine : cls === 'tip-meta' ? metaLine : (x) => `<div class="${cls}">${esc(x)}</div>`;
      const h = xs.map(fn).join('');
      if (h) blocks.push(h);
    };
    const d = it.detail;
    if (d) {
      block(d.properties, 'tip-prop');
      block([...(d.requirements || []), ...(d.sockets || [])], 'tip-meta');
      if (d.itemLevel) block([`Nivel de objeto: ${d.itemLevel}`], 'tip-meta');
      block(d.granted, 'tip-mod');
      block(d.implicits, 'tip-mod');
      block(d.mods, 'tip-mod');
      block(d.descr, 'tip-meta');
      block(d.flavour, 'tip-flavour');
      if (d.unidentified) blocks.push('<div class="tip-meta">Sin identificar</div>');
      if (d.corrupted) blocks.push('<div class="tip-corrupt">Corrompido</div>');
    } else {
      if (it.itemLevel) block([`Nivel de objeto: ${it.itemLevel}`], 'tip-meta');
      block(it.mods || it.stats, 'tip-mod');
      if (it.corrupted) blocks.push('<div class="tip-corrupt">Corrompido</div>');
    }
    const body = blocks.length ? blocks.join('<div class="tip-sep"></div>') : '<div class="tip-meta">El mercado no manda más datos de este objeto.</div>';
    // El icono es el oficial del juego (CDN de GGG), el mismo que sirve el mercado.
    const ico = it.icon ? `<div class="tip-ico"><img src="${esc(it.icon)}" alt="" loading="lazy"></div>` : '';
    return `<div class="tip materialize" data-r="${r}">${ico}<div class="tip-head"><div class="tip-name">${title}</div></div><div class="tip-body">${body}</div></div>`;
  }

  function lineChart(points, opts) {
    // points: [{x, y}] ; devuelve SVG
    const w = opts.w || 600, h = opts.h || 200, pad = opts.pad == null ? 28 : opts.pad;
    if (points.length < 2) return '';
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
    const sx = (x) => pad + ((x - xs[0]) / (xs[xs.length - 1] - xs[0] || 1)) * (w - pad - 8);
    const sy = (y) => 8 + (1 - (y - y0) / (y1 - y0)) * (h - 8 - (opts.axis ? 22 : 8));
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
    const gid = 'g' + Math.random().toString(36).slice(2, 8);
    let extra = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8c27a" stop-opacity=".32"/><stop offset="1" stop-color="#a78bfa" stop-opacity="0"/></linearGradient></defs>`;
    const baseY = opts.axis ? h - 22 : h;
    extra += `<path class="a" fill="url(#${gid})" d="${d}L${sx(xs[xs.length - 1]).toFixed(1)},${baseY}L${sx(xs[0]).toFixed(1)},${baseY}Z"/>`;
    if (opts.axis) {
      for (const v of [y0, (y0 + y1) / 2, y1]) extra += `<line class="grid" x1="${pad}" x2="${w - 8}" y1="${sy(v)}" y2="${sy(v)}"/><text x="0" y="${sy(v) + 4}">${nf(v, v < 10 ? 2 : 0)}</text>`;
      extra += `<text x="${pad}" y="${h - 4}">${esc(opts.from || '')}</text><text x="${w - 8}" y="${h - 4}" text-anchor="end">${esc(opts.to || '')}</text>`;
    }
    const lp = points[points.length - 1];
    return `<svg class="${opts.cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(opts.label || 'Gráfico')}">${extra}<path class="${opts.area ? 'l' : 'ln'}" d="${d}"/><circle class="end" cx="${sx(lp.x).toFixed(1)}" cy="${sy(lp.y).toFixed(1)}" r="3.5"/></svg>`;
  }

  const dlg = () => $('#dlg');
  function openDialog(html, onBind) {
    const d = dlg();
    d.innerHTML = html;
    $$('[data-close]', d).forEach((b) => (b.onclick = () => d.close()));
    if (onBind) onBind(d);
    if (!d.open) d.showModal();
  }

  // ---------------------------------------------------------------- efectos visuales
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const RUNES = `<svg class="runes" viewBox="0 0 100 100" aria-hidden="true"><g class="r1"><circle cx="50" cy="50" r="44" stroke-dasharray="4 7"/><path d="M50 4l4 8h-8zM96 50l-8 4v-8zM50 96l-4-8h8zM4 50l8-4v8z"/></g><g class="r2"><circle cx="50" cy="50" r="30" stroke-dasharray="18 6"/><path d="M50 26l20 34H30z"/></g><circle cx="50" cy="50" r="5"/></svg>`;

  function meterHtml(c) {
    const k = ['alta', 'media', 'baja'].includes(c) ? c : 'baja';
    return `<span class="meter" data-c="${k}" title="Confianza ${k}"><i></i><i></i><i></i> confianza ${k}</span>`;
  }

  function moveRail() {
    const ind = $('.rail-ind');
    const a = $('.rail a.nav[aria-current="page"]');
    if (!ind || !a) return;
    ind.style.transform = `translateY(${a.offsetTop}px)`;
    ind.classList.add('on');
  }

  function countUp(el) {
    const target = parseFloat(el.dataset.count);
    if (!isFinite(target) || reduced()) return;
    const start = performance.now();
    const dur = 850;
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = nf(target * e, 1);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function tilt(slot) {
    if (reduced() || !window.matchMedia('(hover: hover)').matches) return;
    slot.addEventListener('pointermove', (ev) => {
      const r = slot.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width;
      const y = (ev.clientY - r.top) / r.height;
      slot.style.setProperty('--ry', `${(x - 0.5) * 12}deg`);
      slot.style.setProperty('--rx', `${(0.5 - y) * 12}deg`);
      slot.style.setProperty('--mx', `${x * 100}%`);
      slot.style.setProperty('--my', `${y * 100}%`);
    });
    slot.addEventListener('pointerleave', () => { slot.style.setProperty('--rx', '0deg'); slot.style.setProperty('--ry', '0deg'); });
  }

  function enhance(root) {
    $$('[data-count]', root).forEach(countUp);
    $$('.slot', root).forEach(tilt);
  }

  function soundOn() { try { return localStorage.getItem('atalaya-sonido') !== 'no'; } catch { return true; } }
  function chime() {
    if (!soundOn()) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      [784, 1175, 1568].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        const t = ctx.currentTime + i * 0.09;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g).connect(ctx.destination);
        o.start(t); o.stop(t + 0.55);
      });
      setTimeout(() => ctx.close(), 1200);
    } catch {}
  }

  // Celebración de venta: destello de oro y chispas que salen del contador de créditos
  function celebrate() {
    chime();
    if (reduced()) return;
    const flash = document.createElement('div');
    flash.className = 'fx-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 1200);
    const from = ($('[data-unseen]:not(.hidden)') || $('#credits-pill')).getBoundingClientRect();
    const cx = from.left + from.width / 2;
    const cy = from.top + from.height / 2;
    for (let i = 0; i < 28; i++) {
      const s = document.createElement('i');
      s.className = 'fx-spark' + (i % 3 === 0 ? ' v' : '');
      const ang = Math.random() * Math.PI * 2;
      const dist = 80 + Math.random() * 180;
      s.style.left = `${cx}px`;
      s.style.top = `${cy}px`;
      s.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
      s.style.setProperty('--dy', `${Math.sin(ang) * dist + 40}px`);
      s.style.setProperty('--rot', `${Math.random() * 540}deg`);
      s.style.animationDelay = `${Math.random() * 0.12}s`;
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 1500);
    }
  }

  // ---------------------------------------------------------------- guía de primeros pasos
  function guideHidden() { try { return localStorage.getItem('atalaya-guia') === 'oculta'; } catch { return false; } }
  function guideHtml() {
    const steps = [
      { done: me.shopsCount > 0, t: 'Añade tu tienda', d: 'Tu cuenta de Path of Exile y la liga.', href: '#/tienda' },
      { done: me.push.enabled, t: 'Activa los avisos', d: 'Para enterarte de cada venta con la página cerrada.', href: '#/cuenta' },
      { done: me.appraisalsCount > 0, t: 'Prueba el tasador', d: 'Pega un objeto copiado del juego.', href: '#/tasador' },
    ];
    if (steps.every((s) => s.done) || guideHidden()) return '';
    const n = steps.filter((s) => s.done).length;
    return `<section class="panel guide"><div class="panel-head"><h2>Primeros pasos <span class="muted small">${n} de 3</span></h2><button class="btn small ghost" data-guide-off>Ocultar</button></div>
      <ol class="guide-steps">${steps.map((s) => `<li class="${s.done ? 'done' : ''}"><a href="${s.href}"><b>${esc(s.t)}</b><span>${esc(s.d)}</span></a></li>`).join('')}</ol></section>`;
  }
  function bindGuide(root) {
    const b = $('[data-guide-off]', root);
    if (b) b.onclick = () => { try { localStorage.setItem('atalaya-guia', 'oculta'); } catch {} b.closest('.guide').remove(); };
  }

  // ---------------------------------------------------------------- iconos por tipo de objeto (si el del juego no carga)
  const KINDS = [
    ['ring', /ring|anillo/i], ['amulet', /amulet|talism|amuleto/i], ['belt', /belt|sash|cintur/i],
    ['helm', /helm|circlet|mask|crown|visor|hood|cap|casco|tiara|capucha|corona|m[aá]scara/i],
    ['gloves', /glove|gauntlet|bracer|grip|mitt|guante/i], ['boots', /boot|greave|shoe|slipper|bota|calzado/i],
    ['shield', /shield|buckler|focus|escudo|broquel/i], ['bow', /bow|crossbow|arco|ballesta/i],
    ['weapon', /sword|axe|mace|gavel|hammer|staff|wand|sceptre|scepter|spear|dagger|claw|flail|quarterstaff|club|espada|hacha|maza|bast[oó]n|varita|cetro|lanza|daga/i],
    ['armour', /plate|vest|coat|robe|garb|armour|armor|jacket|mail|raiment|tunic|chest|armadura|t[uú]nica|abrigo|t[uú]nica/i],
    ['flask', /flask|frasco/i], ['jewel', /jewel|joya/i],
  ];
  function kindOf(base) {
    for (const [k, re] of KINDS) if (re.test(base || '')) return k;
    return 'generic';
  }
  const kindIcon = (base) => `<svg class="ico" aria-hidden="true"><use href="#k-${kindOf(base)}"/></svg>`;

  // ---------------------------------------------------------------- TIENDA
  const HEALTH = {
    ok: 'Al día', never: 'Esperando la primera lectura', limited: 'El mercado pidió una pausa; se reanuda solo',
    error: 'No se pudo leer en el último intento', verifying: 'Comprobando un cambio grande antes de creerlo',
    stale: 'Hace rato que no se lee', paused: 'En pausa: tu plan vigila menos tiendas',
  };
  const VERDICT = { caro: 'Caro', barato: 'Barato', en_precio: 'En precio', sin_datos: 'Sin datos' };
  let reviewFilter = 'todos';
  let settingsOpen = false;
  let lastSig = '';

  const sigOf = (data) => JSON.stringify(data.shops.map((s) => [s.id, s.health.state, s.health.lastOkAt, s.running, Math.round(s.valueEx), s.listings.map((l) => [l.id, l.price_amount, l.price_currency, l.review && l.review.verdict])]));

  VIEWS.tienda = async function (view) {
    const data = await api('GET', '/api/tiendas');
    lastSig = sigOf(data);
    renderTienda(view, data, true);
    // Se actualiza sola cada minuto: sin parpadeo y sin pisar lo que estés escribiendo en los ajustes.
    pollTimer = setInterval(async () => {
      if (currentView !== 'tienda' || document.hidden || dlg().open) return;
      try {
        await loadMe();
        const fresh = await api('GET', '/api/tiendas');
        const editing = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-settings]');
        const sig = sigOf(fresh);
        if (sig !== lastSig && !editing) { lastSig = sig; renderTienda(view, fresh, false); }
        else $$('[data-ago]', view).forEach((el) => (el.textContent = ago(Number(el.dataset.ago))));
      } catch {}
    }, 60000);
  };

  function renderTienda(view, data, first) {
    if (!data.shops.length) return renderNoShop(view);
    if (!activeShop || !data.shops.find((s) => s.id === activeShop)) activeShop = data.shops[0].id;
    const shop = data.shops.find((s) => s.id === activeShop);
    const rates = data.rates;
    const canAdd = data.shops.length < data.limit;
    const gone = new Set();
    if (!first) $$('[data-item]', view).forEach((b) => { if (!shop.listings.some((l) => String(l.id) === b.dataset.item)) gone.add(b.dataset.item); });

    const tabs = data.shops.length > 1 || canAdd
      ? `<div class="tabs">${data.shops.map((s) => `<button data-shop="${s.id}" aria-pressed="${s.id === shop.id}">${esc(s.account)} <span class="muted">${esc(s.league)}</span></button>`).join('')}
         <button data-add>Añadir tienda</button></div>` : '';

    const hist = shop.history.map((h) => ({ x: h.taken_at, y: h.total_ex / rates.exPerDiv }));
    const spark = hist.length > 1 ? lineChart(hist, { w: 300, h: 56, pad: 0, area: true, cls: 'spark', label: 'Valor de la tienda en 30 días' }) : '<p class="small muted m0">El gráfico de 30 días aparece tras unas cuantas lecturas.</p>';
    const cooldown = shop.cooldownUntil && shop.cooldownUntil > Date.now() / 1000;
    const counts = { caro: 0, en_precio: 0, barato: 0 };
    shop.listings.forEach((l) => { if (l.review && counts[l.review.verdict] != null) counts[l.review.verdict]++; });
    const reviewed = counts.caro + counts.en_precio + counts.barato;
    const checked = shop.listings.filter((l) => l.review).length;
    const list = shop.listings.filter((l) => reviewFilter === 'todos' || (l.review && l.review.verdict === reviewFilter));
    const valDiv = rates.exPerDiv ? shop.valueEx / rates.exPerDiv : null;

    view.innerHTML = `${tabs}${guideHtml()}
      <section class="panel">
        <div class="counter">
          <div>
            <div class="small muted">Valor de tu tienda</div>
            <div class="big"><span ${first ? `data-count="${valDiv != null ? valDiv.toFixed(1) : ''}"` : ''}>${valDiv != null ? nf(valDiv, 1) : '—'}</span> <small>divine</small></div>
            <div class="small muted">${shop.listings.length} ${shop.listings.length === 1 ? 'objeto' : 'objetos'} en venta${rates.estimated ? ' · tasas estimadas' : ''}</div>
          </div>
          <div>${spark}</div>
          <div>
            <div class="status" data-s="${esc(shop.health.state)}"><i></i>${esc(HEALTH[shop.health.state] || '')}</div>
            <div class="small muted">Última lectura: <span data-ago="${shop.health.lastOkAt || 0}">${ago(shop.health.lastOkAt)}</span> · cada ${data.intervalMin} min</div>
            <button class="btn small mt1" data-check ${cooldown || shop.paused ? 'disabled' : ''}>${shop.running ? 'Revisando…' : 'Revisar ahora'}</button>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>${esc(shop.account)} <span class="muted small">${esc(shop.league)}</span></h2>
          ${reviewed ? `<div class="tabs m0" role="group" aria-label="Filtrar por precio">
            <button data-rf="todos" aria-pressed="${reviewFilter === 'todos'}">Todos</button>
            <button data-rf="caro" aria-pressed="${reviewFilter === 'caro'}">Caros <span class="muted">${counts.caro}</span></button>
            <button data-rf="en_precio" aria-pressed="${reviewFilter === 'en_precio'}">En precio <span class="muted">${counts.en_precio}</span></button>
            <button data-rf="barato" aria-pressed="${reviewFilter === 'barato'}">Baratos <span class="muted">${counts.barato}</span></button></div>` : ''}
        </div>
        ${checked < shop.listings.length && shop.listings.length ? `<p class="small muted">El revisor de precios compara tus objetos con anuncios parecidos poco a poco (${checked} de ${shop.listings.length} revisados). Puedes comparar uno al momento desde su ficha.</p>` : ''}
        ${list.length ? `<div class="stash">${list.map((l) => `
          <button class="slot ${gone.size ? '' : ''}" data-r="${esc(l.rarity || '')}" data-item="${l.id}" data-base="${esc(l.base_type || '')}">
            <span class="age ${l.days >= 7 ? 'old' : ''}">${l.days ? l.days + ' d' : 'nuevo'}</span>
            ${l.review && (l.review.verdict === 'caro' || l.review.verdict === 'barato') ? `<span class="tag ${l.review.verdict}">${VERDICT[l.review.verdict]}</span>` : ''}
            ${l.icon ? `<img src="${esc(l.icon)}" alt="" loading="lazy">` : kindIcon(l.base_type)}
            <span class="nm">${esc(l.name)}</span><span class="pr num">${price(l.price_amount, l.price_currency)}</span>
          </button>`).join('')}</div>`
          : shop.listings.length ? `<div class="empty"><p>Ningún objeto en este filtro.</p></div>`
          : `<div class="empty"><h3>${shop.health.state === 'never' ? 'Aún no hay lectura' : 'No hay objetos en venta'}</h3><p>${shop.health.state === 'never' ? 'La primera lectura tarda unos minutos. Puedes pulsar «Revisar ahora».' : 'Si tienes objetos a la venta y no salen aquí, lo más común es que la cuenta o la liga no coincidan: compruébalas en «Ajustes de esta tienda». Si están bien, añade ahí tu código de sesión.'}</p></div>`}
      </section>
      <details class="panel" data-settings-wrap ${settingsOpen ? 'open' : ''}><summary><strong>Ajustes de esta tienda</strong></summary>
        <form data-settings class="mt1">
          <div class="row">
            <div class="field"><label for="st-acc">Tu cuenta de Path of Exile</label><input id="st-acc" name="account" value="${esc(shop.account)}" autocomplete="off" spellcheck="false" pattern="[^#]{2,30}#[0-9]{3,6}" required>
              <div class="small muted">Si la corriges, se vuelve a leer la tienda desde cero.</div></div>
            ${leagueField('st-league', shop.league)}
          </div>
          <div class="row">
            <div class="field"><label for="st-big">Avisar como «gran venta» desde</label><input id="st-big" name="bigAmount" type="number" min="0" step="any" value="${shop.bigSale ? esc(shop.bigSale.amount) : ''}" placeholder="Opcional"></div>
            <div class="field"><label for="st-bigc">Moneda</label><select id="st-bigc" name="bigCurrency">${['divine', 'exalted', 'chaos'].map((c) => `<option ${shop.bigSale && shop.bigSale.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label for="st-sess">Código de sesión de Path of Exile (opcional)</label>
            <input id="st-sess" name="session" autocomplete="off" placeholder="${shop.hasSession ? 'Guardado. Escribe uno nuevo para cambiarlo.' : '32 letras y números'}">
            <div class="small muted">Solo hace falta si tu tienda no aparece. Se guarda cifrado y nunca se vuelve a mostrar.</div></div>
          <div class="row"><button class="btn primary" type="submit">Guardar ajustes</button>
            ${shop.hasSession ? '<button class="btn ghost" type="button" data-nosess>Quitar el código de sesión</button>' : ''}
            <button class="btn ghost danger" type="button" data-del>Dejar de vigilar esta tienda</button></div>
        </form>
      </details>`;

    if (!first) enhance(view);
    bindGuide(view);
    ensureLeagues(); // rellena el desplegable de ligas de los ajustes ya pintados
    $('[data-settings-wrap]', view).addEventListener('toggle', (ev) => (settingsOpen = ev.target.open));
    $$('[data-shop]', view).forEach((b) => (b.onclick = () => { activeShop = Number(b.dataset.shop); reviewFilter = 'todos'; route(); }));
    $$('[data-rf]', view).forEach((b) => (b.onclick = () => { reviewFilter = b.dataset.rf; renderTienda(view, data, false); }));
    const add = $('[data-add]', view);
    if (add) add.onclick = () => canAdd ? addShopDialog() : me.billingMode !== 'mock' ? toast(`Por ahora cada cuenta vigila ${data.limit === 1 ? '1 tienda' : data.limit + ' tiendas'}.`, 'err') : upgradeDialog(`Tu plan ${me.plan.label} vigila ${data.limit === 1 ? '1 tienda' : data.limit + ' tiendas'}. Con Mercader vigilas hasta 3.`);
    $('[data-check]', view).onclick = async (ev) => {
      ev.target.disabled = true; ev.target.textContent = 'Revisando…';
      try {
        const r = await api('POST', `/api/tiendas/${shop.id}/revisar`);
        if (r.status === 'ok' && r.sales) { celebrate(); lastUnseen += r.sales; }
        toast(r.status === 'ok' ? (r.sales ? `Lectura hecha: ${r.sales} venta(s) nueva(s).` : 'Lectura hecha. Sin ventas nuevas.') : 'El mercado no respondió bien; se conservan tus últimos datos.', r.status === 'ok' ? 'ok' : 'err');
        await loadMe();
        const fresh = await api('GET', '/api/tiendas');
        lastSig = sigOf(fresh);
        renderTienda(view, fresh, false);
      } catch (e) { toast(e.message, 'err'); route(); }
    };
    $$('[data-item]', view).forEach((b) => (b.onclick = () => itemDialog(shop, shop.listings.find((l) => l.id === Number(b.dataset.item)), rates)));
    const f = $('[data-settings]', view);
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(f);
      const body = { account: fd.get('account'), league: fd.get('league') };
      if (fd.get('session')) body.session = fd.get('session');
      body.bigSale = fd.get('bigAmount') ? { amount: Number(fd.get('bigAmount')), currency: fd.get('bigCurrency') } : null;
      try { await api('PATCH', `/api/tiendas/${shop.id}`, body); toast('Ajustes guardados.', 'ok'); route(); } catch (e) { toast(e.message, 'err'); }
    };
    const ns = $('[data-nosess]', view);
    if (ns) ns.onclick = async () => { await api('PATCH', `/api/tiendas/${shop.id}`, { session: '' }); toast('Código de sesión borrado.', 'ok'); route(); };
    $('[data-del]', view).onclick = async () => {
      if (!confirm(`¿Dejar de vigilar ${shop.account}? Se borran sus anuncios e historial (tus ventas apuntadas se quedan).`)) return;
      try { await api('DELETE', `/api/tiendas/${shop.id}`); activeShop = null; toast('Tienda eliminada.', 'ok'); await loadMe(); route(); } catch (e) { toast(e.message, 'err'); }
    };
  }

  let LEAGUES = null;
  let LEAGUE_SUGGESTED = null;
  // Rellena el desplegable de ligas con las de verdad y deja seleccionada la de temporada.
  async function ensureLeagues(selectEl) {
    if (!LEAGUES) {
      try {
        const r = await api('GET', '/api/ligas');
        LEAGUES = r.leagues && r.leagues.length ? r.leagues : ['Standard', 'Hardcore'];
        LEAGUE_SUGGESTED = r.suggested || r.default || LEAGUES[0];
      } catch { LEAGUES = ['Standard', 'Hardcore']; LEAGUE_SUGGESTED = (me && me.defaultLeague) || 'Standard'; }
    }
    // El campo se pinta antes de que lleguen las ligas: se completan al llegar.
    $$('select[data-leagues]').forEach((sel) => {
      const keep = sel.dataset.value || sel.value;
      const opts = LEAGUES.includes(keep) || !keep ? LEAGUES : [keep, ...LEAGUES];
      sel.innerHTML = opts.map((l) => `<option value="${esc(l)}" ${l === (keep || LEAGUE_SUGGESTED) ? 'selected' : ''}>${esc(l)}</option>`).join('');
    });
    return LEAGUES;
  }

  // Lista de ligas real en lugar de un campo de texto libre: escribir mal la liga era
  // la causa más común de «mi tienda sale vacía».
  function leagueField(id, current) {
    const val = current || '';
    return `<div class="field"><label for="${id}">Liga</label>
      <select id="${id}" name="league" data-leagues data-value="${esc(val)}" required>
        ${val ? `<option value="${esc(val)}" selected>${esc(val)}</option>` : '<option value="">Cargando ligas…</option>'}
      </select>
      <div class="small muted">La liga en la que juegas. Se leen del propio juego.</div></div>`;
  }

  function shopForm(prefix) {
    setTimeout(ensureLeagues, 0);
    return `<div class="field"><label for="${prefix}-acc">Tu cuenta de Path of Exile</label>
      <input id="${prefix}-acc" name="account" required placeholder="Randy#1234" autocomplete="off" spellcheck="false" pattern="[^#]{2,30}#[0-9]{3,6}">
      <div class="small muted">Con el número que va detrás de la almohadilla. Lo ves en el juego arriba a la izquierda, o en cualquiera de tus anuncios del mercado.</div></div>
      ${leagueField(prefix + '-lg', '')}`;
  }

  function renderNoShop(view) {
    view.innerHTML = `${guideHtml()}<section class="panel"><div class="appraise">
      <div><h2>Dinos qué tienda vigilar</h2><p class="muted">Atalaya leerá tus anuncios cada ${me.plan.intervalMin} minutos y te avisará cuando se venda algo. No necesitamos tu contraseña.</p>
      <form data-new>${shopForm('ns')}<button class="btn primary" type="submit">Empezar a vigilar</button></form></div>
      <div class="empty"><svg width="96" height="96"><use href="#i-tower"/></svg><p>Tus objetos aparecerán aquí como en tu alijo, con lo que vale toda la tienda.</p></div>
    </div></section>`;
    $('[data-new]', view).onsubmit = (ev) => createShop(ev);
    bindGuide(view);
  }

  async function createShop(ev) {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    try {
      const r = await api('POST', '/api/tiendas', { account: fd.get('account'), league: fd.get('league') });
      activeShop = r.id;
      if (dlg().open) dlg().close();
      loadMe().catch(() => {});
      toast('Tienda añadida. La primera lectura empieza ahora.', 'ok');
      api('POST', `/api/tiendas/${r.id}/revisar`).catch(() => {}).finally(() => { if (currentView === 'tienda') route(); });
      route();
    } catch (e) {
      if (e.data && e.data.needPlan) return upgradeDialog(e.message);
      toast(e.message, 'err');
    }
  }

  function addShopDialog() {
    openDialog(`<h2>Añadir tienda</h2><form data-new>${shopForm('as')}<div class="row"><button class="btn primary" type="submit">Añadir</button><button class="btn ghost" type="button" data-close>Cancelar</button></div></form>`,
      (d) => ($('[data-new]', d).onsubmit = createShop));
  }

  // El mismo texto que saldría al copiar el objeto en el juego (Ctrl+C), para que la IA
  // vea también el daño, el crítico y los requisitos, no solo los afijos.
  function itemToText(l) {
    const d = l.detail || {};
    const out = [`Rarity: ${l.rarity || 'Rare'}`, l.name];
    if (l.base_type && l.base_type !== l.name) out.push(l.base_type);
    const part = (arr) => { const xs = (arr || []).map(txtOf).filter(Boolean); if (xs.length) out.push('--------', ...xs); };
    part(d.properties);
    part(d.requirements);
    if (l.item_level) out.push('--------', `Item Level: ${l.item_level}`);
    part(d.granted);
    part(d.implicits);
    part((d.mods && d.mods.length ? d.mods : l.stats) || []);
    if (l.corrupted) out.push('--------', 'Corrupted');
    return out.filter(Boolean).join('\n');
  }

  // Qué manda el mercado para un objeto, en claro y con el JSON debajo por si hay que
  // pasárselo a Claude. Se usa igual desde Administrar que desde la ficha de un objeto.
  function rawItemHtml(raw) {
    if (!raw) return '<p class="diag-bad">El mercado no devolvió ningún objeto de tu tienda.</p>';
    if (raw.noEsta) return '<p class="diag-bad">Ese objeto ya no está en los anuncios de tu tienda. Pulsa «Revisar ahora» y vuelve a probar.</p>';
    const s = raw.resumen || {};
    const fila = (arr, titulo, malSiVacio) => `<li class="${(arr || []).length ? 'ok' : (malSiVacio ? 'bad' : 'ok')}"><b>${titulo}: ${(arr || []).length}</b><span>${esc((arr || []).join(' · ') || 'ninguno')}</span></li>`;
    return `<ul class="diag">
        <li class="ok"><b>${esc(s.objeto || 'Objeto')} (${esc(s.rareza || '?')})</b><span>${s.revisados || 1} anuncios mirados, ${s.incompletos || 0} sin afijos</span></li>
        ${fila(s.propiedades, 'Propiedades')}
        ${fila(s.implicitos, 'Implícitos')}
        ${fila(s.afijos, 'Afijos', true)}
        <li class="ok"><b>Campos que manda el mercado</b><span>${esc((s.campos || []).join('  '))}</span></li>
        <li class="ok"><b>Diccionario de estadísticas</b><span>${esc(s.diccionario || '')}</span></li>
      </ul>
      <p class="small muted">Copia este texto y pégaselo a Claude para que lo ajuste.</p>
      <textarea readonly rows="12" style="width:100%;font-family:var(--mono,monospace);font-size:12px">${esc(JSON.stringify(raw.crudo, null, 2))}</textarea>`;
  }

  function reviewBlock(l, rates) {
    const r = l.review;
    if (!r) return `<p class="small muted m0">Aún no se ha comparado con el mercado.</p>`;
    if (r.verdict === 'sin_datos') return `<p class="small muted m0">Hay muy pocos anuncios parecidos para comparar (${r.count}). Revisado ${ago(r.checkedAt)}.</p>`;
    const msg = { caro: 'Está por encima de lo que piden los anuncios parecidos.', barato: 'Está por debajo del anuncio parecido más barato: quizá puedas pedir más.', en_precio: 'Está en línea con los anuncios parecidos.' }[r.verdict];
    return `<div class="review ${r.verdict}"><b>${VERDICT[r.verdict]}</b> ${msg}
      <div class="small muted">${r.count} anuncios parecidos · el más barato pide ${exFmt(r.minEx, rates)} · los 5 más baratos rondan ${exFmt(r.medianEx, rates)} · revisado ${ago(r.checkedAt)}</div>
      ${r.suggested ? `<div class="price-copy mt1"><input readonly value="~price ${r.suggested.amount} ${r.suggested.currency}" aria-label="Precio de mercado"><button class="btn small primary" data-copy>Copiar precio de mercado</button></div>` : ''}</div>`;
  }

  function itemDialog(shop, l, rates) {
    openDialog(`<div class="result">${tooltipHtml({ ...l, base: l.base_type, mods: l.stats, itemLevel: l.item_level })}
      <div class="verdict"><div class="small muted">Lo tienes a la venta por</div><div class="verdict-price">${price(l.price_amount, l.price_currency)}</div>
      <div class="small muted">${l.ex != null ? '≈ ' + exFmt(l.ex, rates) + ' · ' : ''}${l.days ? `lleva ${l.days} días` : 'puesto hoy'}${l.stash_tab ? ' · pestaña ' + esc(l.stash_tab) : ''}</div></div>
      <div data-review>${reviewBlock(l, rates)}</div>
      <div class="row"><button class="btn" data-compare>Comparar con el mercado ahora</button><button class="btn primary" data-appraise>Tasar con IA (${me.costs.texto} crédito)</button><button class="btn ghost" data-close>Cerrar</button></div>
      ${me.user.role === 'admin' ? '<details class="mt1"><summary class="small muted">Ver qué manda el mercado para este objeto</summary><div data-raw class="mt1"></div></details>' : ''}</div>`,
      (d) => {
        const det = $('[data-raw]', d);
        if (det) det.closest('details').addEventListener('toggle', async (ev) => {
          if (!ev.target.open || det.dataset.hecho) return;
          det.dataset.hecho = '1';
          det.innerHTML = `<div class="working">${RUNES}<strong>Leyendo el objeto del mercado…</strong></div>`;
          try { det.innerHTML = rawItemHtml((await api('GET', `/api/admin/depurar-objeto?listing=${l.id}`)).raw); }
          catch (e) { det.innerHTML = `<p class="diag-bad">${esc(e.message)}</p>`; det.dataset.hecho = ''; }
        });
        $('[data-appraise]', d).onclick = () => { sessionStorageSet('tasar-texto', itemToText(l)); d.close(); location.hash = '#/tasador'; };
        const bindCopy = () => { const c = $('[data-copy]', d); if (c) c.onclick = async () => { const inp = c.previousElementSibling; try { await navigator.clipboard.writeText(inp.value); toast('Copiado. Pégalo en la nota del objeto en el juego.', 'ok'); } catch { inp.select(); } }; };
        bindCopy();
        $('[data-compare]', d).onclick = async (ev) => {
          ev.target.disabled = true; ev.target.textContent = 'Comparando…';
          try {
            const r = await api('POST', `/api/tiendas/${shop.id}/objetos/${l.id}/comparar`);
            l.review = r.review;
            $('[data-review]', d).innerHTML = reviewBlock(l, rates);
            bindCopy();
            lastSig = '';
          } catch (e) { toast(e.message, 'err'); }
          ev.target.disabled = false; ev.target.textContent = 'Comparar con el mercado ahora';
        };
      });
  }

  // ---------------------------------------------------------------- VENTAS
  let salesShop = 'todas';

  function earningsChart(sales, rates) {
    const days = 30;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const t0 = start.getTime() / 1000 - (days - 1) * 86400;
    const buckets = Array.from({ length: days }, () => 0);
    for (const s of sales) {
      const i = Math.floor((s.detected_at - t0) / 86400);
      if (i >= 0 && i < days) buckets[i] += (s.ex || 0) / rates.exPerDiv;
    }
    const max = Math.max(...buckets, 0.0001);
    const w = 800, h = 170, gap = 4, bw = (w - 30) / days - gap;
    const bars = buckets.map((v, i) => {
      const bh = v > 0 ? Math.max(3, (v / max) * (h - 36)) : 2;
      const x = 30 + i * (bw + gap);
      return `<rect class="${v > 0 ? 'b' : 'b0'}" x="${x.toFixed(1)}" y="${(h - 20 - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2"><title>${dateFmt(t0 + i * 86400)}: ${nf(v, 2)} div</title></rect>`;
    }).join('');
    return `<svg class="chart bars" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Ganancias por día en 30 días">
      <defs><linearGradient id="gBar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6dca6"/><stop offset="1" stop-color="#c99a4c"/></linearGradient></defs>
      <line class="grid" x1="30" x2="${w}" y1="${h - 20}" y2="${h - 20}"/><text x="0" y="14">${nf(max, max < 10 ? 1 : 0)}</text><text x="0" y="${h - 22}">0</text>
      ${bars}<text x="30" y="${h - 4}">${dateFmt(t0)}</text><text x="${w}" y="${h - 4}" text-anchor="end">hoy</text></svg>`;
  }

  VIEWS.ventas = async function (view) {
    const data = await api('GET', '/api/ventas');
    const rates = data.rates;
    if (!data.sales.length) {
      view.innerHTML = `<div class="panel empty"><h3>Todavía no hay ventas apuntadas</h3><p>Cuando algo se venda, aparecerá aquí agrupado por día y te llegará un aviso.</p><a class="btn" href="#/tienda">Ver mi tienda</a></div>`;
      return;
    }
    if (salesShop !== 'todas' && !data.shops.some((s) => String(s.id) === salesShop)) salesShop = 'todas';
    const sales = data.sales.filter((s) => salesShop === 'todas' || String(s.shop_id) === salesShop);
    const now = Date.now() / 1000;
    const win = (d) => sales.filter((s) => s.detected_at > now - d * 86400);
    const sumEx = (a) => a.reduce((x, s) => x + (s.ex || 0), 0);
    const best = sales.filter((s) => s.ex != null).sort((a, b) => b.ex - a.ex)[0];
    const days = new Map();
    for (const s of sales) {
      const k = new Date(s.detected_at * 1000).toDateString();
      if (!days.has(k)) days.set(k, []);
      days.get(k).push(s);
    }
    const sold = sales.filter((s) => s.days_listed != null);
    const avgDays = sold.length ? sold.reduce((a, s) => a + s.days_listed, 0) / sold.length : null;
    view.innerHTML = `${data.shops.length > 1 ? `<div class="tabs" role="group" aria-label="Filtrar por tienda"><button data-ss="todas" aria-pressed="${salesShop === 'todas'}">Todas las tiendas</button>${data.shops.map((s) => `<button data-ss="${s.id}" aria-pressed="${salesShop === String(s.id)}">${esc(s.poe_account)} <span class="muted">${esc(s.league)}</span></button>`).join('')}</div>` : ''}
      <section class="panel stats">
        <div class="stat"><div class="v num">${exFmt(sumEx(win(7)), rates)}</div><div class="k">${win(7).length} ventas en 7 días</div></div>
        <div class="stat"><div class="v num">${exFmt(sumEx(win(30)), rates)}</div><div class="k">${win(30).length} ventas en 30 días</div></div>
        <div class="stat"><div class="v num">${best ? exFmt(best.ex, rates) : '—'}</div><div class="k">Mejor venta${best ? ': ' + esc(best.name) : ''}</div></div>
        <div class="stat"><div class="v num">${avgDays != null ? nf(avgDays, 1) + ' d' : '—'}</div><div class="k">Tiempo medio hasta vender</div></div>
      </section>
      <section class="panel"><h2>Ganancias por día <span class="muted small">en divine, últimos 30 días</span></h2>${earningsChart(sales, rates)}</section>
      <section class="panel">${sales.length ? [...days.values()].map((list) => `
        <div class="day"><h3><span>${dateFmt(list[0].detected_at)}</span><span class="num">${exFmt(sumEx(list), rates)}</span></h3>
        ${list.map((s) => `<div class="sale ${s.seen ? '' : 'new'}" data-r="${esc(s.rarity || '')}" data-base="${esc(s.base_type || '')}">
          ${s.icon ? `<img src="${esc(s.icon)}" alt="" loading="lazy">` : kindIcon(s.base_type)}
          <div><div class="nm">${esc(s.name)}</div><div class="small muted">${timeFmt(s.detected_at)} · ${esc(s.shop || '')}${s.days_listed != null ? (s.days_listed ? ` · se vendió en ${s.days_listed} d` : ' · se vendió el mismo día') : ''}</div></div>
          <div class="pr">${price(s.price_amount, s.price_currency)}</div></div>`).join('')}</div>`).join('') : '<div class="empty"><p>Sin ventas en esta tienda todavía.</p></div>'}
      </section>`;
    $$('[data-ss]', view).forEach((b) => (b.onclick = () => { salesShop = b.dataset.ss; VIEWS.ventas(view); }));
    if (data.sales.some((s) => !s.seen)) api('POST', '/api/ventas/vistas').then(() => loadMe()).catch(() => {});
  };

  // ---------------------------------------------------------------- TASADOR
  let tasadorMode = 'texto';
  let pendingImage = null;

  VIEWS.tasador = async function (view, q) {
    const prefill = sessionStorageGet('tasar-texto');
    sessionStorageSet('tasar-texto', '');
    if (prefill) tasadorMode = 'texto';
    view.innerHTML = `${!me.aiReady ? `<div class="panel"><strong>El tasador aún no está encendido.</strong> <span class="muted">Falta que el administrador guarde la clave de la IA${me.user.role === 'admin' ? ' en <a href="#/admin">Administrar</a>' : ''}.</span></div>` : ''}
      <section class="panel appraise">
        <div>
          <div class="tabs" role="group" aria-label="Cómo tasar">
            <button data-mode="texto" aria-pressed="${tasadorMode === 'texto'}">Pegar texto</button>
            <button data-mode="captura" aria-pressed="${tasadorMode === 'captura'}">Subir captura</button>
          </div>
          <div data-pane="texto" class="${tasadorMode === 'texto' ? '' : 'hidden'}">
            <label for="tx">En el juego, pasa el ratón por el objeto y pulsa Ctrl+C. Pégalo aquí:</label>
            <textarea id="tx" spellcheck="false" placeholder="Item Class: Rings&#10;Rarity: Rare&#10;Storm Loop&#10;Sapphire Ring&#10;--------&#10;…">${esc(prefill)}</textarea>
          </div>
          <div data-pane="captura" class="${tasadorMode === 'captura' ? '' : 'hidden'}">
            <label class="drop" for="file" data-drop>${pendingImage ? `<img src="${pendingImage.url}" alt="Tu captura">` : '<span><strong>Arrastra una captura aquí</strong><br>o pulsa para elegirla. PNG, JPG o WEBP, hasta 5 MB.<br>Recórtala al recuadro del objeto.</span>'}</label>
            <input id="file" type="file" accept="image/png,image/jpeg,image/webp" class="sr">
          </div>
          <div class="cost-line">
            <span class="small muted" data-cost></span>
            <button class="btn primary" data-go ${me.aiReady ? '' : 'disabled'}>Tasar</button>
          </div>
        </div>
        <div data-out><div class="empty"><h3>El resultado sale aquí</h3><p>Verás el objeto, un precio sugerido, el precio para venderlo rápido y los anuncios en los que se apoya.</p></div></div>
      </section>
      <section class="panel"><h2>Tus últimas tasaciones</h2><div data-history class="small muted">Cargando…</div></section>`;

    const paintCost = () => {
      const c = me.costs[tasadorMode];
      $('[data-cost]', view).textContent = `Cuesta ${c} crédito${c > 1 ? 's' : ''}. Te quedan ${nf(me.credits)}.`;
    };
    paintCost();
    $$('[data-mode]', view).forEach((b) => (b.onclick = () => {
      tasadorMode = b.dataset.mode;
      $$('[data-mode]', view).forEach((x) => x.setAttribute('aria-pressed', x === b));
      $$('[data-pane]', view).forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tasadorMode));
      paintCost();
    }));

    const drop = $('[data-drop]', view);
    const takeFile = async (file) => {
      if (!file) return;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('Sube una imagen PNG, JPG o WEBP.', 'err');
      if (file.size > 12 * 1024 * 1024) return toast('Esa imagen es demasiado grande.', 'err');
      try {
        pendingImage = await prepareImage(file);
        drop.innerHTML = `<img src="${pendingImage.url}" alt="Tu captura">`;
      } catch { toast('No pude leer esa imagen.', 'err'); }
    };
    $('#file', view).onchange = (ev) => takeFile(ev.target.files[0]);
    drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (ev) => { ev.preventDefault(); drop.classList.remove('over'); takeFile(ev.dataTransfer.files[0]); });
    view.onpaste = (ev) => {
      if (tasadorMode !== 'captura') return;
      const f = [...(ev.clipboardData && ev.clipboardData.files || [])][0];
      if (f) takeFile(f);
    };

    $('[data-go]', view).onclick = async (ev) => {
      const cost = me.costs[tasadorMode];
      if (me.credits < cost && me.billingMode !== 'mock') return toast(`Usaste tus tasaciones de este mes. Se recargan el ${dateFmt(me.renewsAt)}.`, 'err');
      if (me.credits < cost) return upgradeDialog(`Esta tasación cuesta ${cost} crédito${cost > 1 ? 's' : ''} y te quedan ${me.credits}.`);
      const body = { kind: tasadorMode };
      if (tasadorMode === 'texto') {
        body.text = $('#tx', view).value;
        if (body.text.trim().length < 10) return toast('Pega primero el texto del objeto.', 'err');
      } else {
        if (!pendingImage) return toast('Elige primero una captura.', 'err');
        body.image = { mime: pendingImage.mime, base64: pendingImage.base64 };
      }
      const btn = ev.target;
      btn.disabled = true;
      const out = $('[data-out]', view);
      out.innerHTML = `<div class="working">${RUNES}<strong>${tasadorMode === 'captura' ? 'Leyendo la captura y buscando anuncios parecidos…' : 'Buscando anuncios parecidos en el mercado…'}</strong><span class="small">Suele tardar entre 10 y 30 segundos.</span></div>`;
      try {
        const r = await api('POST', '/api/tasar', body);
        setCredits(r.credits, true);
        paintCost();
        out.innerHTML = resultHtml(r.item, r.result);
        bindResult(out);
        loadHistory(view);
      } catch (e) {
        if (e.data && typeof e.data.credits === 'number') setCredits(e.data.credits);
        if (e.data && e.data.needCredits) { out.innerHTML = ''; upgradeDialog(e.message); }
        else if (e.status === 402) out.innerHTML = `<div class="empty"><h3>Sin tasaciones este mes</h3><p>${esc(e.message)}</p></div>`;
        else out.innerHTML = `<div class="empty"><h3>No se pudo tasar</h3><p>${esc(e.message)}</p></div>`;
      } finally { btn.disabled = !me.aiReady; }
    };
    loadHistory(view);
  };

  function prepareImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        if (scale === 1 && file.size <= 4.5 * 1024 * 1024) {
          const fr = new FileReader();
          fr.onload = () => resolve({ url, mime: file.type, base64: String(fr.result).split(',')[1] });
          fr.onerror = reject;
          return fr.readAsDataURL(file);
        }
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL('image/png');
        resolve({ url: data, mime: 'image/png', base64: data.split(',')[1] });
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function resultHtml(item, r) {
    const m = r.mercado || {};
    const rates = r.tasas || {};
    const priceTag = `~price ${r.precio.cantidad} ${r.precio.moneda}`;
    const comps = (m.muestras || []).map((c) => `<tr><td>${price(c.price_amount, c.price_currency)}</td><td>${esc((c.mods || []).slice(0, 4).join(' · ') || c.name || '')}</td></tr>`).join('');
    const mktLine = m.estado === 'ok'
      ? (m.resumen ? `${m.total} anuncios en línea. El más barato pide ${exFmt(m.resumen.min, rates)} y la mitad está por debajo de ${exFmt(m.resumen.median, rates)}.` : 'No hay anuncios en línea de esta base ahora mismo.')
      : 'No se pudo consultar el mercado en este momento: la tasación se basa solo en la IA y tiene menos confianza.';
    return `<div class="result">
      ${tooltipHtml(item)}
      <div class="verdict">
        <div class="small muted">Precio sugerido</div>
        <div class="verdict-price">${nf(r.precio.cantidad, 2)} <small>${CUR_LONG[r.precio.moneda]}</small></div>
        <p class="small v-sub">${r.venta_rapida ? `Venta rápida: ${price(r.venta_rapida.cantidad, r.venta_rapida.moneda)}` : ''}${r.rango ? ` · rango ${nf(r.rango.min, 2)}–${nf(r.rango.max, 2)} ${curLabel(r.rango.moneda)}` : ''} </p><div>${meterHtml(r.confianza)}</div>
      </div>
      ${r.razones.length ? `<div><strong>Por qué</strong><ul>${r.razones.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${r.lo_que_vale.length ? `<div><strong>Lo que más vale de tu objeto</strong><ul>${r.lo_que_vale.map((x) => `<li class="tip-mod">${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${r.consejo ? `<p class="m0">${esc(r.consejo)}</p>` : ''}
      <div class="small muted">${esc(mktLine)}</div>
      ${comps ? `<table class="comps"><tbody>${comps}</tbody></table>` : ''}
      <div class="price-copy"><input readonly value="${esc(priceTag)}" aria-label="Nota de precio para el juego"><button class="btn small" data-copy>Copiar</button></div>
      <p class="small muted m0">Estimación orientativa. El precio final lo decides tú.</p>
    </div>`;
  }
  function bindResult(root) {
    const b = $('[data-copy]', root);
    if (b) b.onclick = async () => {
      const inp = b.previousElementSibling;
      try { await navigator.clipboard.writeText(inp.value); toast('Copiado. Pégalo en la nota del objeto en el juego.', 'ok'); } catch { inp.select(); }
    };
  }

  async function loadHistory(view) {
    const box = $('[data-history]', view);
    if (!box) return;
    try {
      const d = await api('GET', '/api/tasaciones');
      if (!d.appraisals.length) { box.textContent = 'Aún no has tasado nada.'; return; }
      box.classList.remove('muted');
      box.innerHTML = `<table class="list"><thead><tr><th>Objeto</th><th>Precio sugerido</th><th>Cuándo</th><th>Créditos</th></tr></thead><tbody>${d.appraisals.map((a) =>
        `<tr><td><a href="#" data-h="${a.id}">${esc(a.item_name || 'Objeto')}</a></td><td class="num">${price(a.result.precio.cantidad, a.result.precio.moneda)}</td><td>${ago(a.created_at)}</td><td>${a.cost}</td></tr>`).join('')}</tbody></table>`;
      $$('[data-h]', box).forEach((l) => (l.onclick = (ev) => {
        ev.preventDefault();
        const a = d.appraisals.find((x) => x.id === Number(l.dataset.h));
        const out = $('[data-out]', view);
        out.innerHTML = resultHtml(a.item || { name: a.item_name, rarity: 'Normal', mods: [] }, a.result);
        bindResult(out);
        out.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
    } catch { box.textContent = 'No se pudo cargar el historial.'; }
  }

  // ---------------------------------------------------------------- MERCADO
  VIEWS.mercado = async function (view) {
    const d = await api('GET', '/api/mercado');
    const r = d.rates;
    const pts = d.history.filter((h) => h.exPerDiv).map((h) => ({ x: h.t, y: h.exPerDiv }));
    const first = pts[0], last = pts[pts.length - 1];
    const change = pts.length > 1 ? ((last.y - first.y) / first.y) * 100 : null;
    view.innerHTML = `<section class="panel stats">
        <div class="stat"><div class="v num">${nf(r.exPerDiv)} ex</div><div class="k">por 1 divine${change != null ? ` · ${change >= 0 ? '+' : ''}${nf(change, 1)}% en 7 días` : ''}</div></div>
        <div class="stat"><div class="v num">${nf(r.exPerChaos, 1)} ex</div><div class="k">por 1 chaos</div></div>
        <div class="stat"><div class="v num">${esc(d.league)}</div><div class="k">${r.estimated ? 'Tasas estimadas hasta la primera lectura real' : 'Última lectura ' + ago(r.takenAt)}</div></div>
      </section>
      <section class="panel"><h2>El divine en los últimos 7 días</h2>
        ${pts.length > 1 ? lineChart(pts, { w: 800, h: 220, axis: true, cls: 'chart', from: dateFmt(first.x), to: dateFmt(last.x), label: 'Exalted por divine en 7 días' }) : '<p class="muted">El gráfico aparece cuando haya al menos dos lecturas (se toma una cada hora).</p>'}
      </section>
      <section class="panel row spread"><div><strong>¿Buscas algo concreto?</strong><div class="small muted">Crea un deseo y te avisamos cuando aparezca por debajo de tu precio.</div></div><a class="btn" href="#/deseos">Ir a mis deseos</a></section>`;
  };

  // ---------------------------------------------------------------- DESEOS
  VIEWS.deseos = async function (view) {
    const d = await api('GET', '/api/deseos');
    const watching = d.wishes.filter((w) => w.status === 'watching').length;
    view.innerHTML = `<section class="panel"><h2>Nuevo deseo</h2>
        <form data-wish class="row">
          <div class="field"><label for="w-name">Objeto (nombre exacto)</label><input id="w-name" name="name" required placeholder="Por ejemplo Headhunter"></div>
          <div class="field"><label for="w-max">Precio máximo</label><input id="w-max" name="amount" type="number" min="0" step="any" required></div>
          <div class="field"><label for="w-cur">Moneda</label><select id="w-cur" name="currency"><option>divine</option><option>exalted</option><option>chaos</option></select></div>
          <div class="field"><button class="btn primary" type="submit">Avisarme</button></div>
        </form><p class="small muted m0">${watching} de ${d.limit} deseos activos. Se revisan cada hora.</p></section>
      <section class="panel"><div class="panel-head"><h2>Tus deseos</h2><button class="btn small" data-recheck>Revisar ahora</button></div>
        ${d.wishes.length ? `<table class="list"><thead><tr><th>Objeto</th><th>Hasta</th><th>Estado</th><th></th></tr></thead><tbody>${d.wishes.map((w) => `<tr>
          <td>${esc(w.item_name)} <span class="small muted">${esc(w.league)}</span></td><td class="num">${price(w.max_amount, w.max_currency)}</td>
          <td>${w.status === 'found' ? `<span class="conf alta">Encontrado a ${price(w.found_amount, w.found_currency)}</span>` : `<span class="small muted">Buscando${w.last_checked_at ? ' · ' + ago(w.last_checked_at) : ''}</span>`}</td>
          <td><button class="btn small ghost" data-del="${w.id}">Quitar</button></td></tr>`).join('')}</tbody></table>`
          : '<div class="empty"><p>Aún no tienes deseos. Escribe arriba qué buscas y hasta cuánto pagarías.</p></div>'}</section>`;
    $('[data-wish]', view).onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try { await api('POST', '/api/deseos', { name: fd.get('name'), max: { amount: Number(fd.get('amount')), currency: fd.get('currency') } }); toast('Deseo guardado.', 'ok'); route(); }
      catch (e) { if (e.data && e.data.needPlan) upgradeDialog(e.message); else toast(e.message, 'err'); }
    };
    $$('[data-del]', view).forEach((b) => (b.onclick = async () => { await api('DELETE', `/api/deseos/${b.dataset.del}`); route(); }));
    $('[data-recheck]', view).onclick = async (ev) => {
      ev.target.disabled = true;
      try { const r = await api('POST', '/api/deseos/revisar'); toast(r.found ? `¡${r.found} encontrado(s)!` : 'Revisado. Nada por debajo de tu precio todavía.', 'ok'); route(); }
      catch (e) { toast(e.message, 'err'); ev.target.disabled = false; }
    };
  };

  // ---------------------------------------------------------------- CUENTA Y PLAN
  VIEWS.cuenta = async function (view, q) {
    const d = await api('GET', '/api/cuenta');
    Object.assign(me, d);
    setCredits(d.credits);
    const plans = d.plans;
    const active = d.sub && d.sub.status === 'active';
    view.innerHTML = `<section class="panel">
        <div class="panel-head"><h2>${d.billingMode === 'mock' ? `Tu plan: ${esc(d.plan.label)}` : d.plan.key === 'admin' ? 'Tu cuenta (administración)' : 'Atalaya es gratis por ahora'}</h2>${d.billingMode === 'mock' ? '<span class="demo-badge">MODO DEMO: los pagos son simulados, no se cobra nada</span>' : ''}</div>
        <div class="stats">
          <div class="stat"><div class="v num">${nf(d.credits)}</div><div class="k">créditos para el tasador (1 por texto, ${d.costs.captura} por captura)</div></div>
          <div class="stat"><div class="v num">${dateFmt(d.renewsAt)}</div><div class="k">se recargan a ${nf(d.plan.credits)}</div></div>
          <div class="stat"><div class="v num">${d.plan.shops}</div><div class="k">${d.plan.shops === 1 ? 'tienda' : 'tiendas'}, cada ${d.plan.intervalMin} min</div></div>
        </div>
      </section>
      ${d.user.role === 'admin' || d.billingMode !== 'mock' ? '' : `<section class="pricing">${plans.map((p) => `<div class="plan ${p.key === d.plan.key ? 'featured' : ''}">
          <h3>${esc(p.label)}</h3><div class="price">$${p.priceUsd} ${p.priceUsd ? '<small>al mes</small>' : ''}</div>
          <ul><li>${p.shops} ${p.shops === 1 ? 'tienda' : 'tiendas'}, cada ${p.intervalMin} min</li><li>${p.credits} créditos al mes</li><li>${p.wishes} deseos activos</li></ul>
          ${p.key === d.plan.key ? '<button class="btn" disabled>Tu plan actual</button>' : p.key === 'gratis' ? (active ? '<button class="btn ghost" data-cancel>Cancelar y volver a Gratis</button>' : '') : `<button class="btn primary" data-plan="${p.key}">Cambiar a ${esc(p.label)}</button>`}
        </div>`).join('')}</section>
        <p class="pricing-note">Un crédito es una tasación por texto; una captura cuesta ${d.costs.captura}. Los créditos se recargan cada mes y no se acumulan.</p>`}
      <section class="panel"><h2>Avisos en este dispositivo</h2><div data-push></div>
        <label class="switch mt1" for="snd"><input type="checkbox" id="snd" ${soundOn() ? 'checked' : ''}> Sonido al vender</label></section>
      <section class="panel"><h2>Movimientos de créditos</h2>
        <table class="list"><thead><tr><th>Cuándo</th><th>Qué</th><th>Cambio</th><th>Saldo</th></tr></thead><tbody>${d.ledger.map((l) => `<tr><td>${ago(l.created_at)}</td><td>${esc(l.reason)}</td><td class="num">${l.delta > 0 ? '+' : ''}${l.delta}</td><td class="num">${l.balance_after}</td></tr>`).join('')}</tbody></table>
        ${d.payments.length && d.billingMode === 'mock' ? `<h3 class="mt1">Pagos (simulados)</h3><table class="list"><tbody>${d.payments.map((p) => `<tr><td>${dateFmt(p.created_at)}</td><td>Plan ${esc(p.plan)}</td><td class="num">$${p.amount_usd}</td><td class="small muted">${esc(p.note)}</td></tr>`).join('')}</tbody></table>` : ''}
      </section>
      <section class="panel"><h2>Tu cuenta</h2><p class="muted">${esc(d.user.name)} · ${esc(d.user.email)}</p>
        <form data-pass class="row">
          <div class="field"><label for="p-cur">Contraseña actual</label><input id="p-cur" name="current" type="password" autocomplete="current-password" required></div>
          <div class="field"><label for="p-new">Nueva contraseña</label><input id="p-new" name="next" type="password" autocomplete="new-password" minlength="10" required></div>
          <div class="field"><button class="btn" type="submit">Cambiar contraseña</button></div>
        </form>
        <button class="btn ghost" data-logout>Cerrar sesión</button>
      </section>`;

    $$('[data-plan]', view).forEach((b) => (b.onclick = () => checkoutDialog(b.dataset.plan)));
    const c = $('[data-cancel]', view);
    if (c) c.onclick = async () => {
      if (!confirm('¿Cancelar tu suscripción? Vuelves al plan Gratis; conservas los créditos que te quedan hasta la próxima recarga.')) return;
      try { await api('POST', '/api/cancelar'); me = null; await loadMe(); toast('Suscripción cancelada. Estás en el plan Gratis.', 'ok'); route(); } catch (e) { toast(e.message, 'err'); }
    };
    $('[data-pass]', view).onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api('POST', '/api/clave', Object.fromEntries(new FormData(ev.target))); ev.target.reset(); toast('Contraseña cambiada. Se cerraron tus otras sesiones.', 'ok'); } catch (e) { toast(e.message, 'err'); }
    };
    $('[data-logout]', view).onclick = async () => { await api('POST', '/api/logout').catch(() => {}); me = null; location.hash = '#/entrar'; route(); };
    renderPush($('[data-push]', view));
    $('#snd', view).onchange = (ev) => { try { localStorage.setItem('atalaya-sonido', ev.target.checked ? 'si' : 'no'); } catch {} if (ev.target.checked) chime(); };
    const want = q.get('plan');
    if (want && want !== d.plan.key && d.plan.key !== 'admin' && d.billingMode === 'mock') { history.replaceState(null, '', '#/cuenta'); checkoutDialog(want); }
  };

  function checkoutDialog(key) {
    const p = me.plans.find((x) => x.key === key);
    if (!p || p.key === 'gratis') return;
    openDialog(`<h2>Plan ${esc(p.label)}: $${p.priceUsd} al mes</h2>
      <span class="demo-badge">MODO DEMO: esto es una simulación, no se cobra nada</span>
      <div class="fake-card" aria-hidden="true">4242 4242 4242 4242 · 12/30 · 123<br>Tarjeta de prueba ficticia: no escribas datos reales.</div>
      <p>Al confirmar tendrás ${p.shops === 1 ? '1 tienda' : p.shops + ' tiendas'} revisadas cada ${p.intervalMin} minutos y ${p.credits} créditos al mes.</p>
      <div class="row"><button class="btn primary" data-pay>Simular pago</button><button class="btn ghost" data-close>Cancelar</button></div>`,
      (d) => ($('[data-pay]', d).onclick = async (ev) => {
        ev.target.disabled = true;
        try {
          const r = await api('POST', '/api/checkout', { plan: key });
          me = null; await loadMe(); setCredits(r.credits, true);
          d.innerHTML = `<h2>Ya tienes el plan ${esc(p.label)}</h2><p>Tus créditos: <strong class="num">${nf(r.credits)}</strong>. Se recargan cada mes.</p><p class="small muted">Pago simulado: no se ha cobrado nada.</p><button class="btn primary" data-close>Seguir</button>`;
          $('[data-close]', d).onclick = () => { d.close(); route(); };
        } catch (e) { toast(e.message, 'err'); ev.target.disabled = false; }
      }));
  }

  function upgradeDialog(reason) {
    const opts = (me.plans || []).filter((p) => p.priceUsd > (me.plans.find((x) => x.key === me.plan.key) || { priceUsd: 0 }).priceUsd);
    if (!opts.length) return toast(reason, 'err');
    openDialog(`<h2>Necesitas más</h2><p>${esc(reason)}</p>
      <div class="stats">${opts.map((p) => `<div class="stat"><div class="v num">$${p.priceUsd}<small class="small muted"> /mes</small></div><div class="k"><strong>${esc(p.label)}</strong>: ${p.credits} créditos, ${p.shops} ${p.shops === 1 ? 'tienda' : 'tiendas'}</div><button class="btn primary small mt1" data-up="${p.key}">Elegir ${esc(p.label)}</button></div>`).join('')}</div>
      <p class="small muted mt1">MODO DEMO: el pago es simulado.</p><button class="btn ghost" data-close>Ahora no</button>`,
      (d) => $$('[data-up]', d).forEach((b) => (b.onclick = () => checkoutDialog(b.dataset.up))));
  }

  // ---------------------------------------------------------------- avisos push
  const b64ToBytes = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };

  async function renderPush(box) {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported) {
      const ios = /iphone|ipad/i.test(navigator.userAgent);
      box.innerHTML = `<p class="muted">${ios ? 'En iPhone primero añade Atalaya a la pantalla de inicio (Compartir → Añadir a pantalla de inicio) y ábrela desde ahí.' : 'Este navegador no admite avisos. Prueba con Chrome, Edge o Firefox.'}</p>`;
      return;
    }
    let sub = null;
    try { const reg = await navigator.serviceWorker.register('/sw.js'); sub = await reg.pushManager.getSubscription(); } catch {}
    box.innerHTML = sub
      ? `<p>Los avisos están activos en este dispositivo${me.push.devices > 1 ? ` (y en ${me.push.devices - 1} más)` : ''}.</p><div class="row"><button class="btn" data-test>Enviar un aviso de prueba</button><button class="btn ghost" data-off>Desactivar aquí</button></div>`
      : `<p class="muted">Recibe un aviso cada vez que vendas algo o aparezca un deseo.</p><button class="btn primary" data-on>Activar avisos</button>`;
    const on = $('[data-on]', box);
    if (on) on.onclick = async () => {
      try {
        if ((await Notification.requestPermission()) !== 'granted') return toast('El navegador no dio permiso. Puedes cambiarlo en los ajustes del sitio.', 'err');
        const reg = await navigator.serviceWorker.ready;
        const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(me.push.key) });
        await api('POST', '/api/push/suscribir', s.toJSON());
        me = null; await loadMe(); toast('Avisos activados.', 'ok'); renderPush(box);
      } catch (e) { toast(e.message || 'No se pudieron activar los avisos.', 'err'); }
    };
    const test = $('[data-test]', box);
    if (test) test.onclick = async () => { try { const r = await api('POST', '/api/push/prueba'); toast(r.delivered ? 'Aviso enviado.' : 'No se pudo entregar. Desactiva y vuelve a activar.', r.delivered ? 'ok' : 'err'); } catch (e) { toast(e.message, 'err'); } };
    const off = $('[data-off]', box);
    if (off) off.onclick = async () => { await api('POST', '/api/push/quitar', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); me = null; await loadMe(); renderPush(box); };
  }

  // ---------------------------------------------------------------- ADMIN
  VIEWS.admin = async function (view) {
    if (me.user.role !== 'admin') { location.hash = '#/tienda'; return; }
    const d = await api('GET', '/api/admin');
    view.innerHTML = `<section class="panel"><h2>Clave de la IA</h2>
        <p class="muted">Pega aquí tu clave de Anthropic (empieza por <code>sk-ant-</code>) y, si quieres un respaldo, la de Google Gemini. Se comprueba en el momento y se guarda cifrada en el servidor. Nunca se vuelve a mostrar entera.</p>
        <table class="list"><tbody>
          <tr><td>Claude (principal)</td><td>${d.keys.anthropic ? `<span class="conf alta">Guardada ${esc(d.keys.anthropic)}</span>` : '<span class="conf baja">Sin clave</span>'}</td><td>${d.keys.anthropic ? '<button class="btn small ghost" data-rm="anthropic">Quitar</button>' : ''}</td></tr>
          <tr><td>Gemini (respaldo)</td><td>${d.keys.gemini ? `<span class="conf alta">Guardada ${esc(d.keys.gemini)}</span>` : '<span class="conf media">Opcional</span>'}</td><td>${d.keys.gemini ? '<button class="btn small ghost" data-rm="gemini">Quitar</button>' : ''}</td></tr>
        </tbody></table>
        <form data-key class="row mt1"><div class="field"><label for="k">Nueva clave</label><input id="k" name="key" type="password" autocomplete="off" required></div><div class="field"><button class="btn primary" type="submit">Comprobar y guardar</button></div></form>
        <p class="small muted m0">Hoy: ${d.aiToday.n} tasaciones, ${d.aiToday.c} créditos gastados.</p></section>
      <section class="panel"><div class="panel-head"><h2>Conexión con el mercado oficial</h2><button class="btn primary small" data-diag>Probar conexión con el mercado</button></div>
        <p class="muted m0">${d.queue.blocked ? `En pausa hasta las ${timeFmt(d.queue.blockedUntil)} porque lo pidió el mercado.` : 'Funcionando.'} Una petición cada ${nf(d.queue.gapMs / 1000, 1)} s como mínimo. La prueba lee tu tienda, hace una búsqueda y pide las divisas; tarda unos 15–30 segundos.</p>
        <div data-diag-out></div></section>
      <section class="panel"><div class="panel-head"><h2>Informe para Claude</h2>
          <div class="row m0"><button class="btn small primary" data-informe>Generar y copiar informe</button><button class="btn small ghost" data-rawitem>Ver un objeto en crudo</button></div></div>
        <p class="muted m0">Lee tu tienda y resume, objeto por objeto, qué manda el mercado y qué se ha conseguido leer. Pulsa, espera unos segundos y pégaselo a Claude: con eso ve lo que ve el servidor.</p>
        <div data-rawitem-out></div></section>
      <section class="panel"><div class="panel-head"><h2>Usuarios (${d.users.length})</h2>${d.signupMode === 'invite' ? '<button class="btn small" data-inv>Crear invitación</button>' : ''}</div>
        <table class="list"><thead><tr><th>Nombre</th><th>Correo</th><th>Plan</th><th>Créditos</th><th>Tiendas</th></tr></thead><tbody>${d.users.map((x) => `<tr><td>${esc(x.name)}${x.role === 'admin' ? ' <span class="small muted">admin</span>' : ''}</td><td>${esc(x.email)}</td><td>${esc(x.plan)}</td><td class="num">${x.credits}</td><td class="num">${x.shops}</td></tr>`).join('')}</tbody></table></section>`;
    $('[data-key]', view).onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = $('button', ev.target);
      btn.disabled = true; btn.textContent = 'Comprobando…';
      try { const r = await api('POST', '/api/admin/clave-ia', { key: new FormData(ev.target).get('key') }); ev.target.reset(); toast(`Clave de ${r.provider === 'anthropic' ? 'Claude' : 'Gemini'} comprobada y guardada.`, 'ok'); me = null; await loadMe(); route(); }
      catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Comprobar y guardar'; }
    };
    $$('[data-rm]', view).forEach((b) => (b.onclick = async () => { if (!confirm('¿Quitar esta clave? El tasador dejará de usarla.')) return; await api('DELETE', `/api/admin/clave-ia/${b.dataset.rm}`); me = null; await loadMe(); route(); }));
    $('[data-diag]', view).onclick = async (ev) => {
      const out = $('[data-diag-out]', view);
      ev.target.disabled = true;
      out.innerHTML = `<div class="working">${RUNES}<strong>Probando el mercado real…</strong></div>`;
      try {
        const r = await api('POST', '/api/admin/diagnostico');
        out.innerHTML = `<ul class="diag">${r.steps.map((st) => `<li class="${st.ok ? 'ok' : 'bad'}"><b>${st.ok ? '✔' : '✖'} ${esc(st.name)}</b><span>${esc(st.detail)}</span></li>`).join('')}</ul>
          <p class="${r.ok ? 'diag-ok' : 'diag-bad'}">${r.ok ? 'Todo funciona con el mercado real.' : 'Algo no funciona. Lo que dice cada paso indica dónde mirar; si es un cambio del mercado, el ajuste va en src/worker/trade2.js.'}</p>`;
      } catch (e) { out.innerHTML = `<p class="diag-bad">${esc(e.message)}</p>`; }
      ev.target.disabled = false;
    };
    $('[data-informe]', view).onclick = async (ev) => {
      const out = $('[data-rawitem-out]', view);
      ev.target.disabled = true;
      out.innerHTML = `<div class="working">${RUNES}<strong>Leyendo tu tienda objeto por objeto…</strong><span class="small">Tarda entre 20 y 60 segundos: el mercado se consulta despacio a propósito.</span></div>`;
      try {
        const r = await api('GET', '/api/admin/informe');
        let copiado = false;
        try { await navigator.clipboard.writeText(r.texto); copiado = true; } catch {}
        out.innerHTML = `<p class="${copiado ? 'diag-ok' : 'small muted'}">${copiado ? 'Informe copiado: pégalo en el chat con Claude.' : 'Selecciona el texto y cópialo para pegárselo a Claude.'}</p>
          <textarea readonly rows="16" style="width:100%;font-family:var(--mono,monospace);font-size:12px">${esc(r.texto)}</textarea>`;
      } catch (e) { out.innerHTML = `<p class="diag-bad">${esc(e.message)}</p>`; }
      ev.target.disabled = false;
    };
    $('[data-rawitem]', view).onclick = async (ev) => {
      const out = $('[data-rawitem-out]', view);
      ev.target.disabled = true;
      out.innerHTML = `<div class="working">${RUNES}<strong>Leyendo un objeto…</strong></div>`;
      try {
        const r = await api('GET', '/api/admin/depurar-objeto');
        out.innerHTML = rawItemHtml(r.raw);
      } catch (e) { out.innerHTML = `<p class="diag-bad">${esc(e.message)}</p>`; }
      ev.target.disabled = false;
    };
    const inv = $('[data-inv]', view);
    if (inv) inv.onclick = async () => {
      const r = await api('POST', '/api/admin/invitacion');
      const link = `${location.origin}/app.html#/registro?invitacion=${r.token}`;
      openDialog(`<h2>Invitación creada</h2><p>Envía este enlace (vale 7 días, un solo uso):</p><div class="price-copy"><input readonly value="${esc(link)}"></div><button class="btn mt1" data-close>Listo</button>`);
    };
  };

  // ---------------------------------------------------------------- arranque
  function boot() {
    bindAuth();
    // Si un icono del juego no carga, se pone un hueco en su lugar (sin atributos en línea: lo prohíbe la política de seguridad).
    document.addEventListener('error', (ev) => {
      const t = ev.target;
      if (t && t.tagName === 'IMG' && t.closest('.slot, .sale')) {
        const host = t.closest('.slot, .sale');
        const tmp = document.createElement('span');
        tmp.innerHTML = kindIcon(host ? host.dataset.base : '');
        t.replaceWith(tmp.firstChild);
      }
    }, true);
    window.addEventListener('hashchange', () => safe(route));
    window.addEventListener('resize', () => safe(moveRail));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && me) safe(() => loadMe()); });
    const h = parseHash().name;
    if (h === 'cuenta' && /plan=/.test(location.hash)) sessionStorageSet('after-login', location.hash);
    route();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
