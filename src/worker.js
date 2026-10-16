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

// Only a hash of the Facebook comment id is kept: enough to skip comments already
// ingested, without storing anything that points back to the person who wrote it.
async function hashId(id) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(id)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Body: { comments: [{ id, postedAt, text }], snapshot } scraped from the Facebook thread.
// No author names are stored, and comments without an apartment keep only their timestamp.
// snapshot: true means `comments` is the complete thread; apartments whose comment has since been
// deleted on Facebook are then removed (unless another comment or an in-app entry still claims them).
async function ingest(env, body) {
  const state = await load(env);
  const comments = (body.comments || []).filter((c) => c.id);
  const hashes = await Promise.all(comments.map((c) => hashId(c.id)));
  const seen = new Set(state.logs.map((l) => l.fbHash).filter(Boolean));
  const removed = body.snapshot ? removeDeleted(state, new Set(hashes)) : [];
  let added = 0;
  for (const [i, c] of comments.entries()) {
    const fbHash = hashes[i];
    if (seen.has(fbHash)) continue;
    seen.add(fbHash);
    const parsed = parseComment(c.text);
    const logId = crypto.randomUUID();
    const outcome = parsed ? upsert(state, parsed, logId) : 'ignored';
    if (outcome === 'added') added++;
    state.logs.push({
      id: logId,
      source: 'facebook',
      fbHash,
      postedAt: c.postedAt || null,
      text: parsed ? String(c.text || '').slice(0, 300) : null,
      parsed,
      outcome,
      ingestedAt: new Date().toISOString(),
    });
  }
  // Recorded on every sync, even when nothing new was found, so the app can show its freshness.
  state.lastSync = {
    at: new Date().toISOString(), comments: comments.length, added, removed: removed.length, snapshot: !!body.snapshot,
  };
  await save(env, state);
  return { added, removed, total: state.apartments.length };
}

function removeDeleted(state, present) {
  const fbLogs = state.logs.filter((l) => l.fbHash && !l.deletedAt);
  const gone = fbLogs.filter((l) => !present.has(l.fbHash));
  // A partial scrape would look like mass deletion; refuse rather than wipe the list.
  if (gone.length > Math.max(3, fbLogs.length / 2)) {
    throw new Error(`Snapshot is missing ${gone.length} of ${fbLogs.length} known comments; not removing anything`);
  }
  const now = new Date().toISOString();
  gone.forEach((l) => { l.deletedAt = now; });
  const goneIds = new Set(gone.map((l) => l.id));
  // Keys still claimed by a comment that is present in the thread.
  const claimed = new Set(fbLogs.filter((l) => present.has(l.fbHash) && l.parsed)
    .map((l) => aptKey(l.parsed.block, l.parsed.apt)));
  const removed = state.apartments.filter((a) => goneIds.has(a.logId) && !claimed.has(a.key));
  state.apartments = state.apartments.filter((a) => !removed.includes(a));
  for (const a of removed) {
    state.logs.push({
      id: crypto.randomUUID(),
      source: 'facebook',
      text: `Comentariu șters pe Facebook: ${a.block}, et ${a.floor}, ap ${a.apt}`,
      parsed: null,
      outcome: 'removed',
      ingestedAt: now,
    });
  }
  return removed.map((a) => a.key);
}
