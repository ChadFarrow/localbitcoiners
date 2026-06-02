# Local Bitcoiners — Claude Code Notes

This repo holds two related things:

- **Website** (root): the public localbitcoiners.com site — `index.html`,
  `boosts.html`, `assets/`, `functions/`, `transcripts/`, etc.
- **Bots** (`bots/`): automated Nostr publishing bots that monitor incoming
  Lightning payments via Alby Hub and publish kind-1 notes to Nostr.

## Working in this repo

When asked to make changes, look at the file paths in the request to figure
out which side you're on, and stay on that side unless explicitly told
otherwise. Website changes don't need to know about the bots, and bot
changes don't need to know about the website.

## Running & testing the site locally

The site is **static HTML** (`index.html`, `boosts.html`, `meetups.html`,
`stats.html`) that loads the prebuilt widget IIFE
`assets/widgets/login-widget.js`. That bundle is compiled from
`login-widget/src/` with Vite:

- **Rebuild the widget:** `cd login-widget && npm run build` — writes
  `assets/widgets/login-widget.js` and `nostr-tools.js`. Re-run after any edit
  under `login-widget/src/`, then hard-refresh. (`npm run dev` exists but there
  is no dev `index.html`, so it doesn't serve the full page.)

- **Episode pages are server-rendered, not static.** `/epNNN` (zero-padded,
  e.g. `/ep009`) is produced at request time by the Cloudflare Pages function
  `functions/_middleware.js`, which fetches the RSS feed, parses the `<item>`,
  and embeds episode data — including the episode `guid` and value splits —
  into the inline `#lb-ep-data` JSON that the episode boost button reads. A
  plain static server returns 404 for these URLs.

- **To run with the functions** (needed for `/epNNN` and the episode boost):
  `npx wrangler pages dev . --port 8788` → http://localhost:8788. For the
  static pages / show-level boost only, `python3 -m http.server` from the repo
  root is enough.

⚠️ **A boost on localhost is still real.** There is no localhost/preview guard
— completing a boost requires a real settled Lightning payment and publishes
an irreversible kind-1 note to live relays, exactly like production. There is
no safe "fake boost" path through the UI.

## Podcast GUIDs

GUIDs come from the Fountain RSS feed
(`https://feeds.fountain.fm/uv4pyDVtNAiiCCx5emOU`):

- **Feed GUID** — the channel `<podcast:guid>`
  (`56fbb1aa-da79-5e4b-bebc-3b934ab8914c`). It never changes, so it's hardcoded
  as `FEED_GUID` (`login-widget/src/lib/boostagram.js`) and `LB_FEED_GUID`
  (`bots/shared/boost_formatter.py`).
- **Episode GUID** — each `<item><guid>`, read live from the feed (website
  path: via `_middleware.js`; bots path: from the boost's payment metadata).

## ⚠️  Don't modify `bots/` without asking

The bots run on a single dedicated machine, sign with real Nostr keys, and
publish irreversible events to public relays. Reed is the only person who
runs and maintains them. **Always ask before making changes inside `bots/`,
even small ones** — including refactors, formatting passes, or "obvious"
fixes. The bots have subtle invariants that aren't always visible from the
code (sat-split divisors, episode-id key shapes, state-file conventions),
and a wrong publish can't be undone.

If you're working on the website and a change incidentally touches `bots/`,
stop and ask first.

## Bot infrastructure documentation

The detailed bot infrastructure notes live in `bots/CLAUDE.md` (gitignored,
machine-local only) and `bots/nostr bots/bots-config.md` (also gitignored).
The public `bots/README.md` covers what the bots do at a high level.
