#!/usr/bin/env python3
"""Local Bitcoiners leaderboards — merged bot.

Runs the three leaderboard publishes in series. Each section keeps its own
state file alongside this script:

    state_episodesats.json   — per-episode all-time sats aggregate
    state_boostleaders.json  — per-booster set of distinct episodes boosted
    state_topboosts.json     — flat list of every identified boost

Order matches the prior run-leaderboards.sh:
    1. episodesats     — top episodes by all-time sats
    2. boost-leaders   — listeners ranked by number of shows boosted
    3. top-boosts      — single largest boosts of all time
"""

import sys
import json
import re
import time
import requests
from pathlib import Path
from pynostr.key import PrivateKey

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared"))
from nostr_utils import (
    load_config, publish_to_nostr, hex_to_npub, npub_to_hex, get_lud16,
    build_zap_splits_for_note, write_dry_run_event, scrape_fountain_episode,
    event_id_to_nevent, record_published_leaderboard,
)
from boost_formatter import (
    classify_lb_tx, make_cache, persist_cache,
    build_note_from_tx, load_published_events, save_published_events,
    record_published_event, load_donation_events,
)

# --- Shared config ---
CREDENTIALS_FILE = Path.home() / ".config/nostr-bots/credentials.env"
SCRIPT_DIR       = Path(__file__).resolve().parent

DRY_RUN = False


# --- Shared helpers ---
def fetch_page(config, limit, offset):
    url     = config["ALBY_HUB_URL"]
    token   = config["ALBY_TOKEN"]
    headers = {"Authorization": f"Bearer {token}"}
    resp    = requests.get(
        f"{url}/api/transactions?limit={limit}&offset={offset}",
        headers=headers, timeout=30
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("transactions", []), data.get("totalCount", 0)


def get_episode_number(title):
    """Extract zero-padded episode number from title."""
    if not title:
        return None
    if title.startswith("001."):
        return "001"
    m = re.search(r'Ep\.\s*(\d+)', title)
    if m:
        return m.group(1).zfill(3)
    return None


# ============================================================================
# 1/3  episodesats — top episodes by all-time sats
# ============================================================================

EPS_STATE_FILE  = SCRIPT_DIR / "state_episodesats.json"
EPS_FETCH_START = "2026-02-02T05:00:00Z"
EPS_SHOW_BUCKET = "__show__"
EPS_SHOW_TITLE  = "Local Bitcoiners (Show Boosts)"
EPS_TOP_N       = 5

# Host npubs — always tagged in per-episode reply notes.
EPS_HOST_NPUBS = [
    "npub1xgyjasdztryl9sg6nfdm2wcj0j3qjs03sq7a0an32pg0lr5l6yaqxhgu7s",
    "npub1f5pre6wl6ad87vr4hr5wppqq30sh58m4p33mthnjreh03qadcajs7gwt3z",
]

# In-process lud16 cache — we look up the same hosts/author across 6 notes per run.
_eps_lud16_cache = {}
def _eps_cached_lud16(hex_pk):
    if hex_pk not in _eps_lud16_cache:
        _eps_lud16_cache[hex_pk] = get_lud16(hex_pk)
    return _eps_lud16_cache[hex_pk]


def eps_load_state():
    if EPS_STATE_FILE.exists():
        return json.loads(EPS_STATE_FILE.read_text())
    return {"last_processed": None, "episodes": {}}


def eps_save_state(state):
    EPS_STATE_FILE.write_text(json.dumps(state, indent=2))


def eps_normalize_title(title):
    return re.sub(r'^Local Bitcoiners\s*[•·]\s*', '', title or '').strip()


def eps_episode_bucket(info):
    """Resolve an Alby tx's BoostInfo into the (episode_id, episode_title)
    bucket key used by per-episode aggregation. Preserves the exact pre-refactor
    keying so existing aggregated state keeps adding correctly:

      - fountain_stream show-level → SHOW_BUCKET / SHOW_TITLE
      - keysend → text-derived id (sanitized lowercase title, ≤40 chars), so
                  keysend boosts never merge with Fountain BOLT11 boosts on
                  the same episode (matches prior inline behavior)
      - fountain_boost / fountain_stream / website → Fountain internal ep_id
                  with normalized title; website boosts merge into the same
                  bucket as fountain boosts via the classifier's RSS guid map

    Returns (None, None) if the tx is unbucketable (e.g. fountain_stream with
    neither episode nor show URL — already filtered by the classifier, but
    defensive)."""
    if info["source"] == "fountain_stream" and info["show_level"]:
        return EPS_SHOW_BUCKET, EPS_SHOW_TITLE

    # Show-level Fountain BOLT11 boosts (URL `/show/...` instead of
    # `/episode/...`) — sats accumulate into SHOW_BUCKET so they're tracked,
    # but eps_rank_episodes excludes SHOW_BUCKET so they stay off the
    # per-episode leaderboard.
    if info["source"] == "fountain_boost" and info.get("show_level"):
        return EPS_SHOW_BUCKET, EPS_SHOW_TITLE

    # Show-level website boosts (description `LocalBitcoinersShow`) follow
    # the same path — accumulate into SHOW_BUCKET, excluded from the
    # per-episode top-5.
    if info["source"] == "website" and info.get("show_level"):
        return EPS_SHOW_BUCKET, EPS_SHOW_TITLE

    # General LB donations aren't tied to any episode — handled by the
    # donations bot, which publishes its own real-time receipt note.
    if info["source"] == "lb_donation":
        return None, None

    if info["source"] == "keysend":
        # Defer livestream / unresolvable keysends. Without episode_id we'd
        # bucket by sanitized title (e.g. "live_____bowl_after_bowl_____")
        # which adds sats to a phantom episode that never matches a Fountain
        # one. Skip; backfill will re-process post-show.
        if not info.get("episode_id"):
            return None, None
        boostagram = info.get("boostagram") or {}
        ep_title   = eps_normalize_title(boostagram.get("episode", "Unknown Episode"))
        ep_id      = re.sub(r'[^a-z0-9]', '_', ep_title.lower())[:40]
        return ep_id, ep_title

    ep_id    = info.get("episode_id")
    ep_title = eps_normalize_title(info.get("episode_title") or "")
    if not ep_title:
        ep_title = ep_id
    return ep_id, ep_title


def eps_title_without_number(title):
    """Strip the episode-number marker from an episode title so the title
    reads cleanly when the number is already shown elsewhere."""
    # Trailing " | Ep. XXX"
    t = re.sub(r'\s*\|\s*Ep\.\s*\d+\s*$', '', title)
    # Leading "001. " (first-episode convention)
    t = re.sub(r'^\d{3}\.\s*', '', t)
    return t.strip()


def eps_rank_episodes(episodes):
    """Return top-N (ep_id, ep_dict) tuples by sats, excluding show boosts."""
    return sorted(
        [(eid, ep) for eid, ep in episodes.items() if eid != EPS_SHOW_BUCKET],
        key=lambda x: -x[1]["total_sats"]
    )[:EPS_TOP_N]


def eps_format_note(ranked, guest_cache, default_npub):
    """Format the leaderboard note with guest npub tags."""
    medals = ["🥇", "🥈", "🥉"]
    lines  = ["⚡ Local Bitcoiners Episode Boost Leaderboard!", ""]

    for i, (ep_id, ep) in enumerate(ranked):
        medal  = medals[i] if i < 3 else "▪️"
        ep_num = get_episode_number(ep["title"])
        ep_label = f"Ep. {ep_num}" if ep_num else ep["title"]
        sats   = f"{ep['total_sats']:,}"

        guests = guest_cache.get(ep_id, [])
        if not guests:
            guests = [default_npub]

        guest_str = " & ".join(f"nostr:{npub}" for npub in guests)
        lines.append(f"{medal} {ep_label} with {guest_str} - {sats} sats")

    lines.append("")
    lines.append("#LocalBitcoiners #V4V #valuechain")
    lines.append("")
    lines.append("🎧 https://fountain.fm/show/Q48WBr6nT3mrbwMZ8ydY")
    return "\n".join(lines)


def eps_format_episode_reply(rank, ep_id, ep, guests):
    """Build a mini-advertisement reply note for a ranked episode.
    Unlike the main leaderboard note, no default-guest fallback — we simply
    omit the 'Featuring' line when an episode has no guests."""
    medals = ["🥇", "🥈", "🥉", "4th:", "5th:"]
    medal  = medals[rank] if rank < len(medals) else f"{rank + 1}th:"
    ep_num = get_episode_number(ep["title"])
    ep_label = f"Ep. {ep_num}" if ep_num else ep["title"]
    sats   = f"{ep['total_sats']:,}"
    title  = eps_title_without_number(ep["title"])
    ep_url = f"https://fountain.fm/episode/{ep_id}"

    lines = [f"{medal} {ep_label} - {sats} sats", "", title, ""]
    lines.append("Hosted by " + " & ".join(f"nostr:{n}" for n in EPS_HOST_NPUBS))
    if guests:
        lines.append("Featuring " + " & ".join(f"nostr:{n}" for n in guests))
    lines.append("")
    lines.append(f"🎧 {ep_url}")
    return "\n".join(lines)


def eps_resolve_guests(episodes, guest_cache):
    """Scrape guest npubs for episodes not already in guest_cache. Skips the
    show bucket and synthetic non-Fountain episode ids (keysend_*, lb_website_*)
    since those don't map to a Fountain episode page."""
    for ep_id in episodes:
        if ep_id == EPS_SHOW_BUCKET or ep_id in guest_cache:
            continue
        if ep_id.startswith("keysend_") or ep_id.startswith("lb_website_"):
            guest_cache[ep_id] = []
            continue
        ep_url = f"https://fountain.fm/episode/{ep_id}"
        _, guests = scrape_fountain_episode(ep_url)
        guest_cache[ep_id] = guests
        print(f"  [guests] {ep_id}: {len(guests)} guest(s)")
        time.sleep(0.3)


def eps_build_note_tags(note_text, nsec):
    """Build p-tags, t-tags, and zap split tags for the note.
    LB account always gets a zap split share. Guests get equal shares,
    LB gets the remainder so splits total 100."""
    pk         = PrivateKey.from_nsec(nsec)
    author_hex = pk.public_key.hex()
    tags       = []

    # p-tags for all mentioned npubs
    mentioned = re.findall(r'nostr:(npub1[a-z0-9]+)', note_text)
    seen_hex  = set()
    for npub in mentioned:
        hex_pk = npub_to_hex(npub)
        if hex_pk not in seen_hex:
            tags.append(["p", hex_pk])
            seen_hex.add(hex_pk)
    # ensure author is in p-tags
    if author_hex not in seen_hex:
        tags.append(["p", author_hex])
        seen_hex.add(author_hex)

    # t-tags for hashtags
    for ht in re.findall(r'#(\w+)', note_text):
        tags.append(["t", ht.lower()])

    # zap splits — unique npubs that have a lud16, always including author
    guest_hexes = [npub_to_hex(n) for n in mentioned]
    unique_hexes = list(dict.fromkeys(guest_hexes))  # dedupe, preserve order
    # remove author from guest list (added separately with remainder)
    unique_hexes = [h for h in unique_hexes if h != author_hex]

    # filter to those with lud16
    zappable_guests = []
    for hex_pk in unique_hexes:
        lud16 = _eps_cached_lud16(hex_pk)
        if lud16:
            zappable_guests.append(hex_pk)
        else:
            print(f"  [zap] skipping {hex_pk[:16]}... — no lud16 found")

    total_shares   = len(zappable_guests) + 1  # +1 for LB account
    per_guest      = 100 // total_shares
    lb_share       = 100 - (per_guest * len(zappable_guests))

    for hex_pk in zappable_guests:
        tags.append(["zap", hex_pk, "", str(per_guest)])
    tags.append(["zap", author_hex, "", str(lb_share)])

    return tags


def run_episodesats(config, nsec):
    print()
    print("==============================================================")
    print("  1/3  episodesats — top episodes by all-time sats")
    print("==============================================================")

    state    = eps_load_state()
    episodes = state.get("episodes", {})

    # Derive the LB account npub for use as default guest
    pk = PrivateKey.from_nsec(nsec)
    default_npub = hex_to_npub(pk.public_key.hex())

    cutoff = state["last_processed"] or EPS_FETCH_START
    print(f"Fetching transactions since: {cutoff}\n")

    cache        = make_cache()
    guest_cache  = {}
    new_tx_count = 0
    offset       = 0
    limit        = 50
    newest_ts    = state["last_processed"]

    while True:
        txs, total = fetch_page(config, limit, offset)
        if not txs:
            break

        print(f"  Fetched offset {offset} ({len(txs)} txs, total={total})")

        settled_times  = [t.get("settledAt") for t in txs if t.get("settledAt")]
        oldest_on_page = min(settled_times) if settled_times else ""
        last_page      = bool(oldest_on_page) and oldest_on_page <= cutoff

        for tx in txs:
            settled_at = tx.get("settledAt", "")
            if not settled_at or settled_at <= cutoff:
                continue

            info = classify_lb_tx(tx, cache=cache)
            if not info:
                continue

            ep_id, ep_title = eps_episode_bucket(info)
            if not ep_id:
                continue

            sats = info["total_sats"]

            if ep_id not in episodes:
                episodes[ep_id] = {"title": ep_title, "total_sats": 0, "boost_count": 0}

            episodes[ep_id]["total_sats"] += sats
            # boost_count counts only actual boosts (fountain_boost, keysend,
            # website) — streams are passive per-minute drips, not boosts.
            if info["source"] in ("fountain_boost", "keysend", "website"):
                episodes[ep_id]["boost_count"] += 1

            new_tx_count += 1

            if newest_ts is None or settled_at > newest_ts:
                newest_ts = settled_at

        offset += limit

        if last_page or offset >= total:
            break

        time.sleep(0.5)

    print(f"\nProcessed {new_tx_count} new transactions.\n")

    state["episodes"]       = episodes
    state["last_processed"] = newest_ts
    eps_save_state(state)
    print(f"State saved → {EPS_STATE_FILE}\n")

    persist_cache(cache)

    # Resolve guests for any episodes not yet scraped
    print("Resolving episode guests...")
    eps_resolve_guests(episodes, guest_cache)
    print()

    ranked = eps_rank_episodes(episodes)

    note = eps_format_note(ranked, guest_cache, default_npub)
    print("=" * 50)
    print(note)
    print("=" * 50)

    # Build per-episode reply notes (rank 1 first for printing; we publish in reverse).
    replies = []
    for i, (ep_id, ep) in enumerate(ranked):
        reply_text = eps_format_episode_reply(i, ep_id, ep, guest_cache.get(ep_id, []))
        replies.append((i, ep_id, ep, reply_text))
        print(f"\n--- Reply {i + 1} of {len(ranked)} (rank {i + 1}) ---")
        print(reply_text)
        print("-" * 50)

    if not nsec:
        print("\n[warn] No NSEC_LOCAL_BITCOINERS in config — skipping publish")
        return

    author_hex = PrivateKey.from_nsec(nsec).public_key.hex()

    if not DRY_RUN:
        print("\nBuilding tags for main note...")
        extra_tags = eps_build_note_tags(note, nsec)
        print(f"  {len(extra_tags)} tags built")
        print("\nPublishing main leaderboard note...")
        main_event_id = publish_to_nostr(note, nsec, extra_tags=extra_tags)
        if not main_event_id:
            print("[error] Main note publish failed; skipping reply chain.")
            return
        print(f"  Main event id: {main_event_id}")

        record_published_leaderboard(
            "local_bitcoiners_episodesats", main_event_id, author_hex,
        )

        # Post replies in reverse rank order so rank 1 is the latest reply.
        # Sleep between publishes so the prior event has time to propagate —
        # otherwise a reply can land on a relay that hasn't yet seen its root.
        for i, ep_id, ep, reply_text in reversed(replies):
            time.sleep(5)
            print(f"\nPublishing reply for rank {i + 1} ({ep_id})...")
            reply_tags = eps_build_note_tags(reply_text, nsec)
            publish_to_nostr(reply_text, nsec, reply_to_event_id=main_event_id, extra_tags=reply_tags)
    else:
        extra_tags = eps_build_note_tags(note, nsec)
        main_path, main_event_id = write_dry_run_event(
            note, nsec, prefix="episodesats", extra_tags=extra_tags,
        )
        print(f"\n[dry-run] Main event → {main_path}")
        print(f"  Main event id: {main_event_id}")

        # Mirror publish order: reverse rank, so file mtimes match post order.
        for i, ep_id, ep, reply_text in reversed(replies):
            reply_tags = eps_build_note_tags(reply_text, nsec)
            ep_num = get_episode_number(ep["title"]) or "xxx"
            suffix = f"reply-rank{i + 1}-ep{ep_num}"
            reply_path, _ = write_dry_run_event(
                reply_text, nsec, prefix="episodesats",
                extra_tags=reply_tags, reply_to_event_id=main_event_id, suffix=suffix,
            )
            print(f"[dry-run] Rank {i + 1} reply → {reply_path}")


# ============================================================================
# 2/3  boost-leaders — listeners ranked by number of shows boosted
# ============================================================================

BL_STATE_FILE  = SCRIPT_DIR / "state_boostleaders.json"
BL_FETCH_START = "2024-01-01T00:00:00Z"
BL_TOP_TIERS   = 3

# Hosts — excluded from the published leaderboard but still tracked in state
# (so toggling exclusion later doesn't require a backfill).
BL_EXCLUDED_NPUBS = {
    "npub1xgyjasdztryl9sg6nfdm2wcj0j3qjs03sq7a0an32pg0lr5l6yaqxhgu7s",  # reed
    "npub1f5pre6wl6ad87vr4hr5wppqq30sh58m4p33mthnjreh03qadcajs7gwt3z",  # rev
}


def bl_load_state():
    if BL_STATE_FILE.exists():
        raw = json.loads(BL_STATE_FILE.read_text())
        # Convert lists back to sets for in-memory use
        raw["boosters"] = {npub: set(eps) for npub, eps in raw.get("boosters", {}).items()}
        return raw
    return {"last_processed": None, "boosters": {}}


def bl_save_state(state):
    # Convert sets to sorted lists for JSON serialisation
    serialisable = {
        "last_processed": state["last_processed"],
        "boosters": {npub: sorted(eps) for npub, eps in state["boosters"].items()},
    }
    BL_STATE_FILE.write_text(json.dumps(serialisable, indent=2))


def bl_episode_key_for_leader_count(info):
    """Pick the episode-id used to count distinct-episode contributions per
    booster. We deliberately key keysend by its raw boostagram title (matching
    the original inline behavior pre-classifier refactor) rather than the
    Fountain id the classifier can sometimes derive from a Fountain URL —
    changing that key shape mid-flight would split historical state buckets
    against new ones and corrupt the leaderboard counts."""
    # Show-level Fountain boosts (URL `/show/...`) aren't tied to any specific
    # episode — skip so they don't inflate distinct-episode counts. Without
    # this, a show boost would add the show id (e.g. "Q48WBr6nT3mrbwMZ8ydY")
    # to the booster's set as if it were an episode.
    if info["source"] == "fountain_boost" and info.get("show_level"):
        return None

    # Show-level website boosts (description `LocalBitcoinersShow`) — same
    # rationale as fountain_boost show-level: not episode-tied, skip.
    if info["source"] == "website" and info.get("show_level"):
        return None

    # General LB donations aren't episodes — skip.
    if info["source"] == "lb_donation":
        return None

    if info["source"] == "keysend":
        # Defer livestream / unresolvable keysends — the classifier sets
        # episode_id when boostLink resolves to /episode/{id} or RSS title
        # match succeeds; absent both, it's almost certainly a livestream
        # boost (episode_guid → <podcast:liveItem>). Returning None makes the
        # existing skip below catch it without inflating distinct-episode
        # counts via a phantom "keysend_unknown" bucket.
        if not info.get("episode_id"):
            return None
        boostagram = info.get("boostagram") or {}
        return boostagram.get("episode", "") or "keysend_unknown"
    return info.get("episode_id")


def bl_format_booster_display(key):
    """Display string for a boost-leaders booster key. Keys are either
    npubs (most common — npub-attributed boosts) or `name:<senderName>` for
    keysend named-anon boosts (PodcastGuru-style boostagrams that carry a
    senderName but no senderPubkey). Truly anonymous boosts never make it
    into `boosters` so don't need a display path here."""
    if key.startswith("name:"):
        return key[5:]
    return f"nostr:{key}"


def bl_format_note(boosters):
    medals   = ["🥇", "🥈", "🥉"]
    filtered = {k: v for k, v in boosters.items() if k not in BL_EXCLUDED_NPUBS}
    ranked   = sorted(filtered.items(), key=lambda x: -len(x[1]))

    # Find the top BL_TOP_TIERS distinct episode-counts, then include every
    # booster whose count is in one of those tiers — a 10-way tie for 3rd
    # all gets listed.
    distinct_counts = []
    for _, episodes in ranked:
        c = len(episodes)
        if c not in distinct_counts:
            distinct_counts.append(c)
        if len(distinct_counts) >= BL_TOP_TIERS:
            break
    top_counts = set(distinct_counts)
    top        = [(k, eps) for k, eps in ranked if len(eps) in top_counts]
    tier_medal = {c: medals[i] for i, c in enumerate(distinct_counts)}

    lines = ["⚡ Local Bitcoiners Boost Leaders", ""]
    lines.append("Listeners who have boosted the most episodes, all-time:")
    lines.append("")

    for booster_key, episodes in top:
        count = len(episodes)
        medal = tier_medal.get(count, "▪️")
        display = bl_format_booster_display(booster_key)
        lines.append(f"{medal} {display} - {count} episode{'s' if count != 1 else ''}")

    lines.append("")
    lines.append("#LocalBitcoiners #V4V #valuechain")
    lines.append("")
    lines.append("🎧 https://fountain.fm/show/Q48WBr6nT3mrbwMZ8ydY")
    return "\n".join(lines)


def run_boostleaders(config, nsec):
    print()
    print("==============================================================")
    print("  2/3  boost-leaders — most shows boosted")
    print("==============================================================")

    state    = bl_load_state()
    boosters = state.get("boosters", {})

    cutoff = state["last_processed"] or BL_FETCH_START
    print(f"Fetching boosts since: {cutoff}\n")

    cache        = make_cache()
    new_tx_count = 0
    skipped_anon = 0
    offset       = 0
    limit        = 50
    newest_ts    = state["last_processed"]

    while True:
        txs, total = fetch_page(config, limit, offset)
        if not txs:
            break

        print(f"  Fetched offset {offset} ({len(txs)} txs, total={total})")

        settled_times  = [t.get("settledAt") for t in txs if t.get("settledAt")]
        oldest_on_page = min(settled_times) if settled_times else ""
        last_page      = bool(oldest_on_page) and oldest_on_page <= cutoff

        for tx in txs:
            settled_at = tx.get("settledAt", "")
            if not settled_at or settled_at <= cutoff:
                continue

            info = classify_lb_tx(tx, cache=cache)
            if not info:
                continue
            # Leaders is "who boosted" — streams don't count.
            if info["source"] == "fountain_stream":
                continue

            npub        = info["sender_npub"]
            sender_name = info.get("sender_name")
            episode_id  = bl_episode_key_for_leader_count(info)

            # Pick a booster identity. Prefer npub (cryptographic identity);
            # fall back to senderName for keysend named-anon boosts (e.g.
            # PodcastGuru sends a senderName but no senderPubkey). Truly
            # anonymous boosts (no npub, no name) get skipped — without an
            # identifier we can't track distinct-episode contributions.
            if npub:
                booster_key = npub
            elif sender_name:
                booster_key = f"name:{sender_name}"
            else:
                booster_key = None

            if not booster_key or not episode_id:
                skipped_anon += 1
                # Don't advance newest_ts on anon skips — preserves prior
                # behavior. A boost without an identifier or episode can't
                # gain one retroactively, but the cost of leaving last_processed
                # behind is low.
                continue

            if booster_key not in boosters:
                boosters[booster_key] = set()
            boosters[booster_key].add(episode_id)
            new_tx_count += 1

            if newest_ts is None or settled_at > newest_ts:
                newest_ts = settled_at

        offset += limit
        if last_page or offset >= total:
            break

        time.sleep(0.5)

    print(f"\nProcessed {new_tx_count} new identified boosts ({skipped_anon} skipped — anonymous or no npub).\n")

    state["boosters"]       = boosters
    state["last_processed"] = newest_ts
    bl_save_state(state)
    print(f"State saved → {BL_STATE_FILE}\n")

    persist_cache(cache)

    if not boosters:
        print("[warn] No boosters with known npubs found yet — nothing to publish.")
        return

    note = bl_format_note(boosters)
    print("=" * 50)
    print(note)
    print("=" * 50)

    if not nsec:
        print("\n[warn] No NSEC_LOCAL_BITCOINERS in config — skipping publish")
        return

    author_hex = PrivateKey.from_nsec(nsec).public_key.hex()

    print("\nBuilding zap splits...")
    zap_tags = build_zap_splits_for_note(note, nsec)
    if zap_tags:
        print(f"Zap split: {len(zap_tags)} recipients")

    if not DRY_RUN:
        print("\nPublishing standalone note...")
        standalone_id = publish_to_nostr(note, nsec, extra_tags=zap_tags)
        if standalone_id:
            record_published_leaderboard(
                "local_bitcoiners_boostleaders", standalone_id, author_hex,
            )
    else:
        path, _ = write_dry_run_event(
            note, nsec, prefix="boostleaders", extra_tags=zap_tags,
        )
        print(f"[dry-run] standalone → {path}")


# ============================================================================
# 3/3  top-boosts — single largest boosts of all time
# ============================================================================

TB_STATE_FILE  = SCRIPT_DIR / "state_topboosts.json"
TB_FETCH_START = "2024-01-01T00:00:00Z"
TB_TOP_N       = 5

# Manual senderName → npub overrides. Used when a booster has confirmed
# their npub out-of-band but the keysend payload didn't carry a senderPubkey
# TLV. Only consulted when the boost itself has no cryptographically-attested
# npub — an actual TLV pubkey from the booster always wins. The mapping
# itself lives outside the repo at ~/.config/nostr-bots/sender_overrides.json
# so individual booster identities aren't published; if the file is absent,
# the override system is a no-op.
TB_SENDER_OVERRIDES_FILE = Path.home() / ".config/nostr-bots/sender_overrides.json"


def tb_load_state():
    if TB_STATE_FILE.exists():
        return json.loads(TB_STATE_FILE.read_text())
    return {"last_processed": None, "boosts": [], "title_cache": {}}


def tb_save_state(state):
    TB_STATE_FILE.write_text(json.dumps(state, indent=2))


def tb_episode_label(title):
    num = get_episode_number(title)
    return f"Ep. {num}" if num else (title or "unknown")


def tb_episode_id_for_topboost(info):
    """Per-source episode-id key, preserving the prior inline behavior. Keysend
    boosts that arrive without a boostagram.episode title get a synthetic
    `keysend_<paymentHashPrefix>` id (so each one is its own bucket); changing
    that to None or the classifier-derived Fountain id would corrupt prior
    state's id shape."""
    if info["source"] == "keysend":
        # Defer livestream / unresolvable keysends — see boost-leaders'
        # bl_episode_key_for_leader_count for the rationale. Returning None
        # makes the existing skip below catch it, leaving last_processed behind
        # for backfill.
        if not info.get("episode_id"):
            return None
        boostagram = info.get("boostagram") or {}
        ep_from_boostagram = boostagram.get("episode", "")
        if ep_from_boostagram:
            return ep_from_boostagram
        return f"keysend_{info['payment_hash'][:8]}"
    if info["source"] == "lb_donation":
        # Each general donation is its own bucket. The leaderboard ranks by
        # sats so two donations of equal sats from the same npub still show
        # up as separate entries (which is correct — they're separate boosts).
        return f"lb_donation_{info['payment_hash'][:8]}"
    return info.get("episode_id")


def tb_episode_title_for_topboost(info, episode_id):
    """Match prior fallback chain: classifier title → cached title → episode_id."""
    if info["source"] == "keysend":
        boostagram = info.get("boostagram") or {}
        return boostagram.get("episode", "") or episode_id
    if info["source"] == "lb_donation":
        # Always render donations with a clean label — episode_id is the
        # synthetic `lb_donation_{ph}` which would look ugly on the leaderboard.
        return info.get("episode_title") or "localbitcoiners.com"
    return info.get("episode_title") or episode_id


def tb_rank_boosts(boosts):
    return sorted(boosts, key=lambda b: -b["sats"])[:TB_TOP_N]


def tb_load_sender_name_overrides():
    if not TB_SENDER_OVERRIDES_FILE.exists():
        return {}
    return json.loads(TB_SENDER_OVERRIDES_FILE.read_text())

TB_SENDER_NAME_OVERRIDES = tb_load_sender_name_overrides()


def tb_format_sender_display(b):
    """Display string for the sender column of a top-boosts entry. Prefers
    npub (full mention), then a manual senderName override, then bare
    senderName for keysend named-anon boosts (e.g. PodcastGuru — senderName
    set, no senderPubkey), and finally "Anon" for truly anonymous boosts."""
    if b.get("npub"):
        return f"nostr:{b['npub']}"
    name = b.get("sender_name")
    if name and name in TB_SENDER_NAME_OVERRIDES:
        return f"nostr:{TB_SENDER_NAME_OVERRIDES[name]}"
    if name:
        return name
    return "Anon"


def tb_format_note(ranked):
    medals = ["🥇", "🥈", "🥉"]

    lines = ["⚡ Local Bitcoiners Top Boosts of All Time", ""]
    lines.append("The biggest single boosts ever sent to the show:")
    lines.append("")

    for i, b in enumerate(ranked):
        medal = medals[i] if i < 3 else "▪️"
        sats  = f"{b['sats']:,}"
        label = tb_episode_label(b.get("episode_title"))
        sender = tb_format_sender_display(b)
        lines.append(f"{medal} {sender} - {sats} sats on {label}")

    lines.append("")
    lines.append("#LocalBitcoiners #V4V #valuechain")
    lines.append("")
    lines.append("🎧 https://fountain.fm/show/Q48WBr6nT3mrbwMZ8ydY")
    return "\n".join(lines)


def tb_find_txs_by_payment_hash(config, target_hashes, page_limit_safety=200):
    """Paginate Alby Hub transactions oldest-first until each target payment
    hash is found (or we exceed page_limit_safety). Returns a dict of
    payment_hash -> tx for each hit."""
    target = set(target_hashes)
    found  = {}
    offset = 0
    limit  = 50
    while target and offset < page_limit_safety * limit:
        txs, total = fetch_page(config, limit, offset)
        if not txs:
            break
        for tx in txs:
            ph = tx.get("paymentHash", "")
            if ph in target:
                found[ph] = tx
                target.discard(ph)
                if not target:
                    return found
        offset += limit
        if offset >= total:
            break
        time.sleep(0.2)
    return found


def tb_ensure_top_boost_event_ids(ranked, published_events, config, nsec, dry_run):
    """Guarantee a standalone kind-1 event_id exists (or has been published
    in this run) for each ranked boost. Returns payment_hash -> event_id.

    Boosts already tracked in published_events reuse their saved id. Missing
    ones trigger a regen: re-fetch the Alby tx, rebuild the note via the
    shared boost formatter, publish (or dry-run), and record the new id. A
    boost that can't be resolved is simply omitted from the result (its reply
    is skipped)."""
    # Donations are published by the donations bot, which records its event
    # ids in a separate JSON file (avoids concurrent-writer races with
    # boost-publisher on the same file). Check both before falling back to
    # regen.
    donation_events = load_donation_events()

    event_ids = {}
    missing   = []
    for b in ranked:
        ph = b.get("payment_hash", "")
        if not ph:
            continue
        if ph in published_events:
            event_ids[ph] = published_events[ph]["event_id"]
        elif ph in donation_events:
            event_ids[ph] = donation_events[ph]["event_id"]
        else:
            missing.append(b)

    if not missing:
        print(f"  All {len(event_ids)} top boosts already have saved event ids.")
        return event_ids

    print(f"  {len(missing)} of {len(ranked)} top boosts missing event ids; regenerating...\n")

    hashes_needed = [b["payment_hash"] for b in missing]
    found_txs     = tb_find_txs_by_payment_hash(config, hashes_needed)

    regen_cache = make_cache()
    for b in missing:
        ph = b["payment_hash"]
        tx = found_txs.get(ph)
        if not tx:
            print(f"  [warn] Could not locate tx for {ph[:12]}... in Alby; reply will be skipped")
            continue

        result = build_note_from_tx(tx, cache=regen_cache)
        if not result:
            print(f"  [warn] Could not build note for {ph[:12]}...; reply will be skipped")
            continue

        note = result["note_text"]
        print(f"\n  ── Regenerated note for {ph[:12]} ({result['sats']:,} sats) ──")
        print(note)
        print(f"  ──────")

        zap_tags = build_zap_splits_for_note(note, nsec)
        if zap_tags:
            print(f"  Zap split: {len(zap_tags)} recipients")

        if dry_run:
            path, ev_id = write_dry_run_event(
                note, nsec, prefix="regen-boost", extra_tags=zap_tags, suffix=ph[:12],
            )
            print(f"  [dry-run] regen → {path}")
            event_ids[ph] = ev_id
        else:
            time.sleep(2)  # gentle rate-limit across multiple regens
            ev_id = publish_to_nostr(note, nsec, extra_tags=zap_tags)
            if ev_id:
                event_ids[ph] = ev_id
                record_published_event(published_events, ph, ev_id, tx.get("settledAt", ""))
                print(f"  Saved event id: {ev_id[:16]}...")
            else:
                print(f"  [warn] Regen publish failed for {ph[:12]}; reply will be skipped")

    return event_ids


def run_topboosts(config, nsec):
    print()
    print("==============================================================")
    print("  3/3  top-boosts — largest boosts of all time")
    print("==============================================================")

    state       = tb_load_state()
    boosts      = state.get("boosts", [])
    title_cache = state.get("title_cache", {})
    seen_hashes = {b["payment_hash"] for b in boosts if b.get("payment_hash")}

    cutoff = state["last_processed"] or TB_FETCH_START
    print(f"Fetching boosts since: {cutoff}\n")

    cache         = make_cache()
    new_count     = 0
    skipped_anon  = 0
    offset        = 0
    limit         = 50
    newest_ts     = state["last_processed"]

    while True:
        txs, total = fetch_page(config, limit, offset)
        if not txs:
            break

        print(f"  Fetched offset {offset} ({len(txs)} txs, total={total})")

        settled_times  = [t.get("settledAt") for t in txs if t.get("settledAt")]
        oldest_on_page = min(settled_times) if settled_times else ""
        last_page      = bool(oldest_on_page) and oldest_on_page <= cutoff

        for tx in txs:
            settled_at = tx.get("settledAt", "")
            if not settled_at or settled_at <= cutoff:
                continue

            payment_hash = tx.get("paymentHash", "")
            if payment_hash and payment_hash in seen_hashes:
                continue

            info = classify_lb_tx(tx, cache=cache)
            if not info or info["source"] == "fountain_stream":
                continue

            episode_id    = tb_episode_id_for_topboost(info)
            episode_title = tb_episode_title_for_topboost(info, episode_id)
            npub          = info["sender_npub"]
            sender_name   = info.get("sender_name")
            sats          = info["total_sats"]

            # All non-stream boosts that resolve to an episode are eligible —
            # named-anon (senderName but no npub) and truly-anon (neither)
            # both count toward the all-time top-N. Display falls back through
            # nostr:npub → senderName → "Anon" via tb_format_sender_display.
            if not episode_id or sats <= 0:
                skipped_anon += 1
                continue

            # Persist any newly-discovered titles for next run (skip the
            # synthetic keysend_<hash> / lb_donation_<hash> ids — those
            # titles are just the synthetic id or a generic label).
            if episode_title and episode_id and not (
                episode_id.startswith("keysend_") or episode_id.startswith("lb_donation_")
            ):
                title_cache[episode_id] = episode_title

            boosts.append({
                "payment_hash":  payment_hash,
                "npub":          npub,
                "sender_name":   sender_name,
                "sats":          sats,
                "episode_id":    episode_id,
                "episode_title": episode_title,
                "settled_at":    settled_at,
            })
            seen_hashes.add(payment_hash)
            new_count += 1

            if newest_ts is None or settled_at > newest_ts:
                newest_ts = settled_at

        offset += limit
        if last_page or offset >= total:
            break

        time.sleep(0.5)

    print(f"\nProcessed {new_count} new identified boosts ({skipped_anon} skipped — no npub).\n")

    state["boosts"]         = boosts
    state["title_cache"]    = title_cache
    state["last_processed"] = newest_ts
    tb_save_state(state)
    print(f"State saved → {TB_STATE_FILE}\n")

    persist_cache(cache)

    if not boosts:
        print("[warn] No identified boosts found yet — nothing to publish.")
        return

    if not nsec:
        print("[warn] No NSEC_LOCAL_BITCOINERS in config — skipping publish")
        return

    ranked = tb_rank_boosts(boosts)
    note   = tb_format_note(ranked)
    print("=" * 50)
    print(note)
    print("=" * 50)

    # Resolve an event_id for every top-N boost before touching the leaderboard
    # publish — that way the reply chain can be built confidently.
    print("\n─── Resolving event ids for top boosts ───")
    published_events = load_published_events()
    event_ids_by_hash = tb_ensure_top_boost_event_ids(
        ranked, published_events, config, nsec, dry_run=DRY_RUN,
    )
    if not DRY_RUN:
        save_published_events(published_events)

    # Main leaderboard publish
    print("\n─── Leaderboard ───")
    if not DRY_RUN:
        print("Building zap splits...")
        zap_tags = build_zap_splits_for_note(note, nsec)
        if zap_tags:
            print(f"  Zap split: {len(zap_tags)} recipients")
        print("Publishing main leaderboard note...")
        main_event_id = publish_to_nostr(note, nsec, extra_tags=zap_tags)
    else:
        zap_tags = build_zap_splits_for_note(note, nsec)
        path, main_event_id = write_dry_run_event(
            note, nsec, prefix="topboosts", extra_tags=zap_tags,
        )
        print(f"[dry-run] Main event → {path}")

    if not main_event_id:
        print("[error] Main note publish failed; skipping reply chain.")
        return
    print(f"  Main event id: {main_event_id}")

    lb_author_hex = PrivateKey.from_nsec(nsec).public_key.hex()
    if not DRY_RUN:
        record_published_leaderboard(
            "local_bitcoiners_topboosts", main_event_id, lb_author_hex,
        )

    # Reply chain — iterate top-N in reverse so rank 1 is the latest reply.
    print("\n─── Reply chain ───")
    for i in reversed(range(len(ranked))):
        b  = ranked[i]
        ph = b.get("payment_hash", "")
        ev_id = event_ids_by_hash.get(ph)
        if not ev_id:
            print(f"[skip] Rank {i + 1} ({ph[:12]}...) has no event id — no reply")
            continue
        nevent     = event_id_to_nevent(ev_id, author_hex=lb_author_hex)
        reply_text = f"nostr:{nevent}"

        if not DRY_RUN:
            time.sleep(5)  # let the prior publish propagate across relays
            print(f"Publishing reply for rank {i + 1} → nostr:{nevent[:32]}...")
            publish_to_nostr(reply_text, nsec, reply_to_event_id=main_event_id)
        else:
            suffix = f"reply-rank{i + 1}"
            path, _ = write_dry_run_event(
                reply_text, nsec, prefix="topboosts",
                reply_to_event_id=main_event_id, suffix=suffix,
            )
            print(f"[dry-run] Rank {i + 1} reply → {path}")


# ============================================================================
# Entry point
# ============================================================================

def main():
    config = load_config(CREDENTIALS_FILE)
    nsec   = config.get("NSEC_LOCAL_BITCOINERS")

    run_episodesats(config, nsec)
    run_boostleaders(config, nsec)
    run_topboosts(config, nsec)

    print()
    print("All three leaderboards complete.")


if __name__ == "__main__":
    main()
