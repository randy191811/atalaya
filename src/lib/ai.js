// Motores de IA, solo en el servidor: Claude Haiku por defecto y Gemini de respaldo.
// Las claves se guardan cifradas en DATA_DIR (fuera de la carpeta pública) o llegan por variable de entorno.
// Nunca se devuelven al navegador ni se escriben en los registros.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { encrypt, decrypt } from './secrets.js';

const KEYS_FILE = path.join(config.dataDir, 'ai-keys.json');

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function getKey(provider) {
  const envKey = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY;
  if (envKey && envKey.trim()) return envKey.trim();
  const blob = readStore()[provider];
  return blob ? decrypt(blob) || '' : '';
}

export const hasAnyKey = () => !!(getKey('anthropic') || getKey('gemini'));

export function keyStatus() {
  const mask = (k) => (k ? `…${k.slice(-4)}` : null);
  return { anthropic: mask(getKey('anthropic')), gemini: mask(getKey('gemini')) };
}

export function detectProvider(key) {
  return /^sk-ant-/.test(key) ? 'anthropic' : 'gemini';
}

export function saveKey(provider, key) {
  const store = readStore();
  if (key) store[provider] = encrypt(key);
  else delete store[provider];
  fs.writeFileSync(KEYS_FILE, JSON.stringify(store), { mode: 0o600 });
}

// Comprueba la clave en vivo con el proveedor. Devuelve { ok, message }.
export async function validateKey(provider, key) {
  try {
    if (provider === 'anthropic') {
      const r = await fetch(`${config.ai.anthropicBase}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: config.ai.claudeModel, max_tokens: 4, messages: [{ role: 'user', content: 'ok' }] }),
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) return { ok: true };
      if (r.status === 401 || r.status === 403) return { ok: false, message: 'Anthropic dice que esa clave no es válida.' };
      if (r.status === 400) return { ok: false, message: 'La clave es válida pero la cuenta no puede usar el modelo (¿falta saldo en Anthropic?).' };
      return { ok: false, message: `Anthropic no respondió bien (código ${r.status}). Prueba en un momento.` };
    }
    const r = await fetch(`${config.ai.geminiBase}/v1beta/models?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(20000) });
    if (r.ok) return { ok: true };
    return { ok: false, message: 'Google dice que esa clave no es válida.' };
  } catch {
    return { ok: false, message: 'No pude comunicarme con el proveedor desde el servidor.' };
  }
}

// ---- llamadas
async function callClaude(system, content, maxTokens) {
  const key = getKey('anthropic');
  if (!key) return { ok: false, err: 'sin clave anthropic' };
  try {
    const r = await fetch(`${config.ai.anthropicBase}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.ai.claudeModel, max_tokens: maxTokens, temperature: 0.2, system, messages: [{ role: 'user', content }] }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) return { ok: false, err: `claude http ${r.status}` };
    const d = await r.json();
    const text = (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    return text ? { ok: true, text, engine: 'claude' } : { ok: false, err: 'claude vacío' };
  } catch (e) {
    return { ok: false, err: 'claude red ' + e.name };
  }
}

async function callGemini(system, parts, maxTokens) {
  const key = getKey('gemini');
  if (!key) return { ok: false, err: 'sin clave gemini' };
  let lastErr = '';
  for (const model of config.ai.geminiModels) {
    try {
      const r = await fetch(`${config.ai.geminiBase}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.2, topP: 0.9, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) { lastErr = `${model} http ${r.status}`; continue; }
      const d = await r.json();
      const text = (((d.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || '').join('') || '';
      if (text) return { ok: true, text, engine: 'gemini' };
      lastErr = `${model} vacío`;
    } catch (e) {
      lastErr = `${model} red ${e.name}`;
    }
  }
  return { ok: false, err: lastErr };
}

// JSON tolerante: quita ``` y, si falla, recorta del primer { al último }.
export function parseJson(text) {
  const t = String(text || '').replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(t);
  } catch {}
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(t.slice(a, b + 1));
    } catch {}
  }
  return null;
}

// Pide JSON a la IA: Claude primero, Gemini si falla. `validate` decide si el resultado sirve.
// image: { mime, base64 } opcional.
export async function askJson({ system, prompt, image, maxTokens = 1500, validate }) {
  const claudeContent = image
    ? [{ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } }, { type: 'text', text: prompt }]
    : prompt;
  const geminiParts = image ? [{ text: prompt }, { inline_data: { mime_type: image.mime, data: image.base64 } }] : [{ text: prompt }];
  const errors = [];
  for (const call of [() => callClaude(system, claudeContent, maxTokens), () => callGemini(system, geminiParts, maxTokens)]) {
    const r = await call();
    if (!r.ok) { errors.push(r.err); continue; }
    const data = parseJson(r.text);
    const clean = data && validate ? validate(data) : data;
    if (clean) return { ok: true, data: clean, engine: r.engine };
    errors.push(`${r.engine} json inválido`);
  }
  console.error('[ia]', errors.join(' | '));
  return { ok: false };
}
