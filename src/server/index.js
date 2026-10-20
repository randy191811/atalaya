// Servidor HTTP: API + archivos del cliente. Sin dependencias externas.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../lib/config.js';
import { migrate } from '../lib/db.js';
import { seedAdmin } from '../lib/auth.js';
import { selfTest } from '../lib/webpush.js';
import { handleApi, HttpError } from './routes.js';
import { startScheduler, stopScheduler } from '../worker/scheduler.js';

const CLIENT = path.join(ROOT, 'client');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

const SEC_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function originOk(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const o = req.headers.origin;
  if (!o) return true; // clientes que no son navegador
  if (config.publicOrigin) return o === config.publicOrigin;
  try {
    return new URL(o).host === req.headers.host;
  } catch {
    return false;
  }
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  else if (!path.extname(rel)) rel = rel.replace(/\/$/, '') + '.html';
  const file = path.normalize(path.join(CLIENT, rel));
  if (!file.startsWith(CLIENT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { ...SEC_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('No encontrado');
  }
  const ext = path.extname(file).toLowerCase();
  const noCache = ext === '.html' || path.basename(file) === 'sw.js';
  res.writeHead(200, {
    ...SEC_HEADERS,
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600',
    ...(path.basename(file) === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

export function buildServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    if (!url.pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, SEC_HEADERS);
        return res.end();
      }
      try {
        return serveStatic(req, res, url.pathname);
      } catch {
        res.writeHead(400, SEC_HEADERS);
        return res.end();
      }
    }
    const extra = [];
    const send = (status, obj) => {
      const headers = { ...SEC_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
      if (extra.length) headers['Set-Cookie'] = extra;
      res.writeHead(status, headers);
      res.end(JSON.stringify(obj));
    };
    try {
      if (!originOk(req)) throw new HttpError(403, 'Petición rechazada por seguridad.');
      await handleApi(req, res, url, send, (c) => extra.push(c));
    } catch (e) {
      if (res.headersSent) return;
      if (e instanceof HttpError) {
        const headers = { ...SEC_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
        res.writeHead(e.status, headers);
        return res.end(JSON.stringify({ error: e.message, ...(e.extra || {}) }));
      }
      console.error('[api]', req.method, url.pathname, e && e.stack ? e.stack : e);
      res.writeHead(500, { ...SEC_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Algo salió mal de nuestro lado. Inténtalo de nuevo en un momento.' }));
    }
  });
}

async function main() {
  const r = migrate();
  console.log(`[db] migraciones: ${r.total} (${r.applied} nuevas)`);
  if (await seedAdmin()) console.log('[auth] cuenta de administración creada desde variables de entorno');
  if (!selfTest()) console.error('[push] AUTOPRUEBA DE CIFRADO FALLÓ: las notificaciones no funcionarán');
  const server = buildServer();
  server.listen(config.port, config.host, () => {
    console.log(`[http] escuchando en http://${config.host}:${config.port}`);
    if (process.env.NO_WORKER !== '1') {
      startScheduler(Number(process.env.TICK_MS || 30000));
      console.log(`[worker] activo (mercado ${config.marketEnabled ? 'encendido' : 'apagado'})`);
    }
  });
  const stop = () => {
    stopScheduler();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
