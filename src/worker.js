import { parseComment, floorFromApt, BLOCKS } from './parse.js';
import page from './app.html';

// Everything lives under /<SECRET>/. Any other path is a plain 404, so the
// site is invisible to crawlers and to anyone who does not have the link.
const SECURITY_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const STATE_KEY = 'state';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const [secret, ...rest] = url.pathname.split('/').filter(Boolean);
    if (!env.SECRET || !secret || !safeEqual(secret, env.SECRET)) return notFound();

    const route = rest.join('/');
    const method = request.method;
    try {
      if (route === '' && method === 'GET') {
        if (!url.pathname.endsWith('/')) return Response.redirect(`${url.origin}/${secret}/`, 301);
        return new Response(page, { headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' } });
      }
      if (route === 'api/state' && method === 'GET') return json(await load(env));
      if (route === 'api/apartments' && method === 'POST') return json(await addManual(env, await request.json()));
      if (route.startsWith('api/apartments/') && method === 'DELETE') {
        return json(await removeApartment(env, decodeURIComponent(route.slice('api/apartments/'.length))));
      }
      if (route === 'api/ingest' && method === 'POST') return json(await ingest(env, await request.json()));
    } catch (err) {
      return json({ error: err.message }, 400);
    }
    return notFound();
  },
};

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function notFound() {
  return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function load(env) {
  return (await env.DATA.get(STATE_KEY, 'json')) || { apartments: [], logs: [] };
}

async function save(env, state) {
  await env.DATA.put(STATE_KEY, JSON.stringify(state));
  return state;
}

const aptKey = (block, apt) => `${block}-${apt}`;

// Adds the apartment unless that block/apt is already listed; returns the log outcome.
function upsert(state, entry, logId) {
  const key = aptKey(entry.block, entry.apt);
  if (state.apartments.some((a) => a.key === key)) return 'duplicate';
  state.apartments.push({ key, ...entry, logId });
  return 'added';
}

async function addManual(env, body) {
  const block = String(body.block || '').toUpperCase();
  const apt = Number(body.apt);
  if (!BLOCKS.includes(block)) throw new Error('Unknown block');
  if (!Number.isInteger(apt) || apt < 1 || apt > 999) throw new Error('Invalid apartment number');
  const floorStated = body.floor !== '' && body.floor !== null && body.floor !== undefined;
  const floor = floorStated ? Number(body.floor) : floorFromApt(apt);
  if (!Number.isInteger(floor) || floor < 0 || floor > 30) throw new Error('Invalid floor');

  const state = await load(env);
  const entry = { block, floor, apt, floorStated };
  const logId = crypto.randomUUID();
  const outcome = upsert(state, entry, logId);
  state.logs.push({
    id: logId,
    source: 'manual',
    author: String(body.author || '').slice(0, 80) || null,
    text: `${block}, et ${floor}, ap ${apt}`,
    parsed: entry,
    outcome,
    ingestedAt: new Date().toISOString(),
  });
  return save(env, state);
}

async function removeApartment(env, key) {
  const state = await load(env);
  const apt = state.apartments.find((a) => a.key === key);
  if (!apt) throw new Error('Not found');
  state.apartments = state.apartments.filter((a) => a.key !== key);
  state.logs.push({
    id: crypto.randomUUID(),
    source: 'manual',
    text: `Removed ${apt.block}, et ${apt.floor}, ap ${apt.apt}`,
    parsed: null,
    outcome: 'removed',
    ingestedAt: new Date().toISOString(),
  });
  return save(env, state);
}

// Body: { comments: [{ id, author, postedAt, text }] } scraped from the Facebook thread.
// Comments already ingested (same Facebook id) are skipped, so re-running is safe.
async function ingest(env, body) {
  const state = await load(env);
  const seen = new Set(state.logs.map((l) => l.fbCommentId).filter(Boolean));
  let added = 0;
  for (const c of body.comments || []) {
    if (!c.id || seen.has(c.id)) continue;
    const parsed = parseComment(c.text);
    const logId = crypto.randomUUID();
    const outcome = parsed ? upsert(state, parsed, logId) : 'ignored';
    if (outcome === 'added') added++;
    state.logs.push({
      id: logId,
      source: 'facebook',
      fbCommentId: c.id,
      author: c.author || null,
      postedAt: c.postedAt || null,
      text: String(c.text || '').slice(0, 1000),
      parsed,
      outcome,
      ingestedAt: new Date().toISOString(),
    });
  }
  await save(env, state);
  return { added, total: state.apartments.length };
}
