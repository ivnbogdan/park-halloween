# Halloween The Park

Mobile-first list of apartments that welcome trick-or-treaters, built from the comments on the
residents' Facebook group post. One tab per block (T1, T2, T3, TP / bloc galben), grouped by floor,
plus a log of every ingested comment and a form to add an apartment manually.

Runs as a Cloudflare Worker with the data in Workers KV (free tier).

## Access

Everything is served under `/<SECRET>/`. Any other path returns 404, and responses carry
`X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`. Whoever has the link can view and edit.
The secret is a Worker secret, never committed:

```sh
npx wrangler secret put SECRET   # rotate by setting a new value; old links stop working
```

## Develop / deploy

```sh
npm install
npm test           # comment parser tests
npx wrangler deploy
```

## Syncing new Facebook comments

The Facebook Groups API no longer exists, so comments are collected from the logged-in browser
(e.g. with Claude in Chrome) and pushed in:

```sh
node scripts/ingest.mjs "https://<worker-host>/<SECRET>/" comments.json
```

Comments already ingested (same Facebook comment id) are skipped. Parsing rules live in
`src/parse.js`: the block is required (T1/T2/T3/TP, "bloc 1", "blocul galben"), the floor is taken
from `et`/`etaj`/`parter` when stated, otherwise from the apartment number (ap 45 → etaj 4,
ap 4 → parter); those are shown as "etaj estimat".
