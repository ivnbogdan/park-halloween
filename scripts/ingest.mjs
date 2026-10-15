// Pushes comments scraped from the Facebook thread into the app.
// Usage: node scripts/ingest.mjs <app-url-with-secret> <comments.json>
// comments.json: [{ id, author, postedAt, text }] or [[id, author, "7h", text], ...]
// Already-ingested comment ids are skipped by the server, so re-running is safe.
import { readFileSync } from 'node:fs';

const [appUrl, file] = process.argv.slice(2);
if (!appUrl || !file) {
  console.error('Usage: node scripts/ingest.mjs <app-url-with-secret> <comments.json>');
  process.exit(1);
}

const UNIT_MS = { m: 60e3, h: 3600e3, d: 86400e3 };
const agoToIso = (ago) => {
  const m = /^(\d+)\s*([mhd])$/.exec(ago || '');
  return m ? new Date(Date.now() - Number(m[1]) * UNIT_MS[m[2]]).toISOString() : null;
};

const comments = JSON.parse(readFileSync(file, 'utf8')).map((c) =>
  Array.isArray(c) ? { id: c[0], author: c[1], postedAt: agoToIso(c[2]), text: c[3] } : c,
);

const res = await fetch(new URL('api/ingest', appUrl.endsWith('/') ? appUrl : appUrl + '/'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ comments }),
});
console.log(res.status, await res.text());
