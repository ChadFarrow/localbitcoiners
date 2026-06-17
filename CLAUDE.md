# Local Bitcoiners — Claude Code Notes

This repo holds two related things:

- **Website** (root): the public localbitcoiners.com site — `index.html`,
  `boosts.html`, `assets/`, `functions/`, `transcripts/`, etc.
- **Bots** (`bots/`): automated Nostr publishing bots that monitor incoming
  Lightning payments via Alby Hub and publish kind-1 notes to Nostr.

## Working in this repo

Reed manages both the website and the bots from this directory. When asked
to make changes, look at the file paths in the request to figure out which
side you're on. Website changes don't need to know about the bots, and bot
changes don't need to know about the website — but you're free to work on
either side.

## ⚠️  Editing `bots/` is fine — but STOP before any publish or payment

You can freely edit bot code, configs, and refactors. The hard line is at
*execution that can't be undone*: the bots sign with real Nostr keys and
publish irreversible events to public relays, and they move real sats.

**Confirm with Reed before running anything that signs/publishes Nostr
events or sends payments** — that includes live bot runs, publish/send
commands, and the weekly leaderboard publish path. Code edits, dry runs,
and read-only inspection don't need a check-in.

Watch the subtle invariants that aren't always visible from the code
(sat-split divisors, episode-id key shapes, state-file conventions) — a
wrong publish can't be undone, so when a code change feeds the publish
path, double-check those before you let it run.

## How incoming boosts get classified (donor message, app name)

`bots/shared/boost_formatter.py` normalizes every incoming Lightning payment
into a unified note. Where the donor **message** and **app name** come from
depends on how the app paid:

- **keysend** (e.g. PodcastGuru, CurioCaster, Podcast Index's WebLN player):
  message and `app_name` come straight off the boostagram TLV record
  (`appName` / `message`).
- **BOLT11 to a Lightning address** (the `rss::payment::boost <url> <comment>`
  convention) is dispatched by URL host in `_classify_fountain_boost`:
  - `fountain.fm` → full message + sender via the Fountain comments API.
  - `castamatic.com/boost/<uuid>` → fetch the URL's JSON for message, sender,
    and episode (`_classify_castamatic_boost`); prefers the JSON `message`
    field, falling back to the inline LNURL comment.
  - `tardbox.com/boost/` → scrape the HTML boost page.
  - **any other host → generic fallback that hardcodes `app_name = "Fountain"`**
    and runs the Fountain API lookup (a no-op for non-Fountain apps). The inline
    comment message survives, but the app is mislabeled "via Fountain". Latent
    gap: no app currently hits it (PodcastGuru uses keysend, Castamatic uses a
    handled host), but a new app paying a Lightning address would be
    misattributed until it gets its own host branch.

When adding support for a new app's boosts, first determine whether it arrives
via keysend or BOLT11 — that decides whether you touch the boostagram path or
add a host branch in `_classify_fountain_boost`.

Verified end-to-end (donor message posts correctly) on 2026-06-17: Fountain,
Castamatic (after fix `2863201`), PodcastGuru, CurioCaster, and Podcast Index
(WebLN → keysend). The keysend apps all share one app-agnostic path, so new
keysend apps generally work with no changes; the only untested risk remains a
new app paying a Lightning address via BOLT11 (the "via Fountain" fallback).

## Bot infrastructure documentation

The detailed bot infrastructure notes live in `bots/CLAUDE.md` (gitignored,
machine-local only) and `bots/nostr bots/bots-config.md` (also gitignored).
The public `bots/README.md` covers what the bots do at a high level.
