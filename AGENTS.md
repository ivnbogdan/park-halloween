# Agent instructions: re-syncing the Facebook thread

This app lists the apartments at The Park that welcome trick-or-treaters on
**Saturday, 31 October, from 19:00** (moved from Sunday 1 November). Neighbours register by commenting on a Facebook group post.
Your usual job here is to pull new comments from that post into the app.

## Ground rules

- **No personal data.** Never collect, store, commit or print author names, profile links or
  avatars. Ingest only the comment id, an approximate time and the comment text. The server hashes
  the id and drops the text of comments that do not name an apartment.
- **The URL secret is not in this repo** and cannot be read back from Cloudflare. Ask the user for
  the full app link, `https://park-halloween.ivnbogdan.workers.dev/<SECRET>/`. Never commit it or
  write it into files in the repo.
- Do not commit scraped comments. Keep `comments.json` in a scratch/temp directory and delete it
  afterwards.

## Source

- Post: https://www.facebook.com/share/p/1EzqrFRrJ9/
  (redirects to `facebook.com/groups/theparkapartments/permalink/4687557761522414/`, the
  "The Park Official Group / Grupul Locatarilor" group).
- It is a **group** post. The Facebook Graph API cannot read group content (the Groups API was
  removed in 2024), so comments are read from the user's logged-in Chrome using **Claude in
  Chrome**.

## Step 1: open the post and load every comment

1. Open the post URL in a new tab. It opens as a dialog over the group feed. Scope everything
   to `document.querySelector('[role="dialog"]')`.
2. **Switch the sort to "All comments".** The default "Most relevant" hides comments. Click the
   "Most relevant" button under the post, then pick **"All comments"** ("Show all comments,
   including potential spam"). Do not use "Newest", which can also hide comments.
3. Load the rest: scroll the dialog's scroll container to the bottom several times, and click
   every "View N replies" / "View more comments" / "See more" button until none remain.
4. **Check the count.** (Since late Oct the counter may render as a comment icon plus a bare number,
   e.g. "57", not "57 comments"; scroll the dialog to the top and look for it next to the reactions.)
   The number of `[role="article"]` elements in the dialog must equal the
   "N comments" counter under the post. On the first sync that was 28 = 28. If they differ, keep
   expanding.

Snippet that worked (run with the javascript tool):

```js
const root = document.querySelector('[role="dialog"]');
const sc = [...root.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(d).overflowY));
const re = /^(View (all )?\d+ (more )?repl(y|ies)|View more (comments|replies)|View previous comments|See more|.* replied · \d+ repl(y|ies))$/i;
for (let i = 0; i < 15; i++) {
  if (sc) sc.scrollTop = sc.scrollHeight;
  await new Promise(r => setTimeout(r, 1500));
  const btns = [...root.querySelectorAll('[role="button"]')].filter(b => re.test(b.innerText.trim()));
  btns.forEach(b => b.click());
  if (!btns.length && i > 3) break;
  await new Promise(r => setTimeout(r, 1500));
}
({ articles: root.querySelectorAll('[role="article"]').length, counter: root.innerText.match(/\d+ comments?/g) })
```

## Step 2: extract comments without names

```js
const root = document.querySelector('[role="dialog"]');
window.__c = [...root.querySelectorAll('[role="article"]')].map(a => {
  const link = [...a.querySelectorAll('a[href*="comment_id"]')].map(x => x.href)[0] || '';
  const id = (link.match(/reply_comment_id=(\d+)/) || link.match(/comment_id=(\d+)/) || [])[1];
  const ago = ((a.getAttribute('aria-label') || '').match(/(\d+) (minute|hour|day)s? ago$/) || []);
  const text = [...a.querySelectorAll('div[dir="auto"]')].filter(d => d.closest('[role="article"]') === a).map(d => d.innerText).join(' ');
  // Keep text only when it can name an apartment; discussion (often starting with a name) is blanked.
  const norm = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const maybeApt = /\bt\s*[123p]\b|\bbloc|\bgalben/.test(norm) && /\d/.test(norm);
  return [id, ago[1] ? ago[1] + ago[2][0] : null, maybeApt ? text.slice(0, 200) : ''];   // no author
});
JSON.stringify(window.__c.filter(c => c[2]).length) + ' with text / ' + window.__c.length
```

The tool truncates large return values (around 1000 characters), so read `window.__c` in chunks,
for example `JSON.stringify(window.__c.slice(0, 12))`, then `slice(12, 24)`, and so on.
**Send every comment, including the blanked ones**: a full snapshot is how deleted comments
are detected (step 3). Check the kept texts for a leading person's name and strip it.

Notes:
- Replies to a comment are articles too. Include them, since a reply can name an apartment.
- A reply may start with the name of the person it answers, for example "Ana Pop de acord...".
  Those are never apartment entries, and the server drops their text. Still, do not copy names
  into chat or files. Replace a leading name with nothing if you need to quote one.
- "about an hour ago" does not match the time regex, so it becomes `null`. That's fine.

## Step 3: ingest

Write the array to a scratch file and push it:

```sh
node scripts/ingest.mjs "https://park-halloween.ivnbogdan.workers.dev/<SECRET>/" /path/to/comments.json --snapshot
# -> 200 {"added":N,"removed":["T2-99"],"total":M}
```

**Deleted comments must disappear from the app (user rule).** Pass `--snapshot` only when the
file holds every comment in the thread, that is, when the loaded article count equals Facebook's
"N comments" counter. The server then removes apartments whose comment no longer exists, unless
another comment still in the thread names the same apartment. Apartments added in the app are
never removed this way. If you could not load everything, leave out `--snapshot` (adds only) and
tell the user. As a safety net, the server refuses a snapshot that would drop more than half of
the known comments.

`comments.json` is `[[id, "7h" | null, text], ...]` or `[{ id, postedAt, text }]`. Re-sending
everything is safe: comments already ingested (same id) are skipped. Report to the user how many
apartments were added, and point out any comment that looks like an apartment but was not
parsed. Check the "☰ Jurnal" view in the app, or `GET <app>/api/state`.

## Parsing rules (src/parse.js, user-specified)

- **Four blocks:** `T1` (also "bloc 1"), `T2` ("bloc 2"), `T3` ("bloc 3") and `TP` (also
  called "bloc galben" / "blocul galben"). A comment without a block is not an entry.
- **Apartment:** usually the number after `ap` / `ap.` / `apartament`. Bare numbers also occur:
  `T2, et 9, 99` is ap 99, and `T2, 7, 73` is etaj 7, ap 73.
- **Floor (`et` / `etaj` / `parter`):** if the comment states it, use that. Otherwise deduce it
  from the apartment number: the tens digit is the floor. Ap 45 is floor 4, ap 78 is floor 7, and
  ap 4 is floor 0 (parter).
  - Exception: higher numbers don't follow the pattern (ap 125 is on floor 11, and in the thread
    someone wrote T3 et 13 ap 125). Those residents normally state the floor. If one doesn't,
    the deduction is only a guess, so mention it to the user.
  - The TP / bloc galben numbering does not follow the pattern either (ap 38 is on etaj 6). Trust
    the stated floor.
- **Basement:** `et -1`, "subsol" or "demisol" → floor -1 (e.g. T3 ap 130 is on etaj -1, not 13).
- **Opt-outs:** a comment naming an apartment plus "nu vom mai fi acasă", "nu mai participăm",
  "ne retragem", "scoateți-ne" and similar (`isOptOut` in `src/parse.js`) removes that apartment,
  logged as "retras" (withdrawn). Read new comments yourself as well: if one is clearly an
  opt-out the regex misses, extend `isOptOut` (with a test) before ingesting.
- Apartments are unique per block (`T2-13` and `T1-13` are different). A repeat is logged as
  "duplicate" and not added again.
- Add new phrasings to `test/parse.test.js` and run `npm test` before deploying parser changes.

## App behaviour (for context)

- One tab per block, apartments grouped by floor. Mobile-first, Romanian UI.
- "+ Adaugă" (add) and "Editează" (delete) write to the server, so they apply for everyone.
  "Visited" marks are localStorage only, per phone.
- "☰ Jurnal" in the header shows the log: Facebook comments and entries added/removed in the app
  ("Din aplicație"), newest first, plus "Ultima sincronizare Facebook" = time of the last
  `api/ingest` call (`state.lastSync`). It updates even when a sync finds nothing new.
- Every path except `/<SECRET>/...` returns 404, with `noindex` and `no-referrer` headers.

## Deploying and admin

- Cloudflare Worker `park-halloween`, account subdomain `ivnbogdan`, data in KV namespace
  `DATA` under the key `state` (`{ apartments: [...], logs: [...] }`).
- `npx wrangler deploy` (the user logs in with `npx wrangler login`).
- Rotate the link: `npx wrangler secret put SECRET`. Old links stop working at once.
- Repo: github.com/ivnbogdan/park-halloween (private).
