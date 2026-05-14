#!/usr/bin/env python3
"""Local Bitcoiners — sats log.

Builds the canonical raw log at ``data/sats.csv`` from two data sources:

  1. **Boosts** (one row per payment) — paginated from Alby Hub via the
     existing shared classifier. Covers boosts, website donations, keysend
     boosts, and general LB donations. Each row carries the donor's full
     intent, what the node received, the divisor used, the boost message,
     and the donor's npub/name where recoverable.

  2. **Fountain streams** (one row per ``(episode, Fountain supporter)``) —
     pulled from Fountain's public Firestore ``supporters`` collection. Each
     row is a per-supporter aggregate of *every* stream payment that supporter
     has sent to the episode (lifetime). Sender npub or Fountain username is
     preserved; ``our_sats`` stays blank because Fountain doesn't expose
     per-tx attribution we could split our LN node's receipts against.

  3. **Non-Fountain streams** (keysend + Castamatic) — the shared classifier
     returns None for these (it only dispatches keysend on action=="boost",
     and only handles fountain.fm stream URLs). We classify them here and
     aggregate by ``(episode, sender)`` into the same row shape — but WITH
     ``our_sats`` populated, since these come from our node's per-tx data.
     Crossover-feed streams (Bowl After Bowl, etc.) go to the show bucket,
     except those inside the Ep 009 livestream window.

  Rationale for the grain split: Fountain BOLT11 stream payments carry no TLV
  sender, so per-tx attribution is impossible from our side — Fountain's
  Firestore aggregate is the only attribution source. Keysend/Castamatic
  streams DO carry sender metadata, so we attribute and aggregate them
  ourselves. Boost rows stay per-tx because each carries a message and
  identity we don't want to flatten.

Also writes ``data/fountain-api.csv``: the *full* Fountain Firestore
supporter ledger — one row per (entity, supporter), every supporter (not
just streamers), every stat Fountain exposes (all periods, both
currencies). It's the raw Fountain-side counterpart to sats.csv, kept so
the two views can be diffed (Fountain's accounting vs. our LN node + sat
math). Same Firestore queries already made for the stream aggregates —
no extra API calls.

And ``data/sats.json`` — a faithful, complete JSON mirror of sats.csv
(wrapper object + one object per row, JSON-native types) for the website
to consume. The website does all filtering/bucketing; this is just the
raw data in a second format.

State:
  ``state.json`` (gitignored) carries the Alby Hub ``last_processed`` cursor
  for incremental boost pagination. Stream rows and the Fountain ledger are
  regenerated every run (the Fountain aggregate grows over time), so this
  bot rewrites both CSVs in full each run rather than appending.

This bot does **not** publish anything to Nostr.
"""

import re
import sys
import csv
import json
import time
import requests
import subprocess
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared"))
from boost_formatter import (
    classify_lb_tx, make_cache, persist_cache,
    build_rss_item_index, _extract_episode_number,
)
from nostr_utils import load_config, hex_to_npub

# --- Config ---
CREDENTIALS_FILE = Path.home() / ".config/nostr-bots/credentials.env"
SCRIPT_DIR       = Path(__file__).resolve().parent
STATE_FILE       = SCRIPT_DIR / "state.json"
REPO_ROOT        = Path(__file__).resolve().parent.parent.parent
CSV_FILE         = REPO_ROOT / "data" / "sats.csv"
SATS_JSON        = REPO_ROOT / "data" / "sats.json"
FOUNTAIN_CSV     = REPO_ROOT / "data" / "fountain-api.csv"

# Show launched 2026-02-02 — same backstop the episodesats leaderboard uses.
# Once state.json exists the cursor in there wins.
FETCH_START = "2026-02-02T05:00:00Z"

DRY_RUN  = False  # classify everything but don't write CSV / state / push
AUTOPUSH = True   # git pull/add/commit/push at end of a real run

# Fountain Firestore (anonymous read access — the web client's public api key)
FIRESTORE_PROJECT = "fountain-fm"
FIRESTORE_API_KEY = "AIzaSyDpQs8iMTAn_Bh4uXKBpJPk91iB1JPDs_w"
FIRESTORE_URL     = (
    f"https://firestore.googleapis.com/v1/projects/{FIRESTORE_PROJECT}"
    f"/databases/(default)/documents:runQuery?key={FIRESTORE_API_KEY}"
)
LB_SHOW_FOUNTAIN_ID = "Q48WBr6nT3mrbwMZ8ydY"  # entity._id for the LB show entity
SUPPORTERS_QUERY_LIMIT = 5000  # large enough to dodge pagination at our scale

# Column order is the contract for downstream consumers. Append new columns to
# the end if/when we add fields — existing consumers stay happy.
CSV_COLUMNS = [
    "settled_at",      # ISO timestamp — Alby settledAt for boosts, Fountain lastseen for stream aggregates
    "payment_hash",    # unique boost dedup key; empty for stream-aggregate rows
    "source",          # fountain_boost | fountain_stream | keysend | website | lb_donation
    "app",             # Fountain | PodcastGuru | Castamatic | localbitcoiners.com | ...
    "kind",            # boost | stream
    "sender_npub",     # npub1... when known; empty otherwise
    "sender_name",     # display name (keysend senderName, Fountain username); empty otherwise
    "episode_id",      # Fountain canonical id, or "" / lb_website_NNN for unresolved
    "episode_num",     # zero-padded "008" if derivable
    "episode_title",
    "show_level",      # "true" | "false"
    "total_sats",      # gross sender amount (boost: after divisor; stream: Fountain aggregate)
    "our_sats",        # what the node actually received; blank for stream-aggregate rows
    "divisor",         # 0.98 | 0.49 | 0.33 | 1.0; blank for stream-aggregate rows
    "total_sats_method",  # how total_sats was derived — see derive_total_method()
    "message",         # user-typed boost message; newlines collapsed to literal \n
]

# fountain-api.csv — the *full* Fountain Firestore supporter view, one row per
# (entity, supporter), unfiltered (boosters AND streamers). This is the
# unprocessed counterpart to sats.csv: Fountain's own accounting, kept so we
# can diff it against what our LN node + sat-math actually produced. Stat
# columns mirror Fountain's structure: {currency}_{period}_{stat}. The "TOTAL"
# period is renamed "alltime" so the column isn't "btc_total_total".
_FOUNTAIN_PERIODS = (("D7", "d7"), ("D30", "d30"), ("M3", "m3"), ("TOTAL", "alltime"))
_FOUNTAIN_STATS   = ("total", "boosts", "streams", "zaps", "purchases", "subscriptions")
FOUNTAIN_COLUMNS  = [
    "entity_type",    # EPISODE | SHOW
    "entity_id",      # Fountain episode id or show id
    "episode_num",    # our annotation — zero-padded; blank for SHOW / unmatched
    "episode_title",  # our annotation
    "supporter_id",   # Firestore doc _id
    "user_id",        # Fountain _user_id
    "npub",           # _npub (when the supporter linked Nostr)
    "name",           # info.name
    "username",       # info.username
    "ids",            # the supporter's id array, semicolon-joined
    "firstseen",
    "lastseen",
    "updated",
] + [
    f"{cur}_{period_out}_{stat}"
    for cur in ("btc", "usd")
    for _, period_out in _FOUNTAIN_PERIODS
    for stat in _FOUNTAIN_STATS
]


# ---------------------------------------------------------------------------
# Manual overrides — applied in info_to_row() AFTER classification, so they
# survive every full regenerate. Keep this section narrow: prefer a classifier
# fix for any pattern that's truly general. Listed here are the one-offs and
# the things the shared classifier currently can't reach.
# ---------------------------------------------------------------------------

# Livestream night with Spencer — the 5 boosts that landed on the livestream
# (not yet a Fountain episode at boost time) but pertain to Ep. 009. Classifier
# leaves them unattributed since no Fountain URL resolves. Manual pin.
LIVE_BOOST_HASHES = {
    "e1c3343707511c388abee78d030177301ef70d441e86f9015241806c54d49437",
    "c8866f8ec2a92bf3943a8eb6a28891749022802331aba9ac570434ede3055523",
    "407e457dbbf7a81e20d6a9d13f6d8cf1ddb8751991ac33c289d0902530da2263",
    "0804c80687acba785a4de2e4fcdbd3f8c9f3f6c41bb777b485c8a929294312e5",
    "d7a093f72750d89ce9a5b4a79803ab1f129a29fb914228f5a3e0d149fb716c84",
}
LIVE_EP_FOUNTAIN_ID = "yKaKx7ddLE6lW06ZvGAb"
LIVE_EP_NUM         = "009"
LIVE_EP_TITLE       = "Growing Slow Builds Strong Communities: KC Bitcoiners | Ep. 009"

# Bowl After Bowl crossover — LB received a leg of someone's V4V split while
# they were listening/boosting a BAB episode (Ep. 434 in particular). These
# aren't tied to any LB episode; bucketing them show-level keeps them in the
# dataset without inflating any LB episode's totals. Title-pattern based so
# any future BAB crossovers get the same treatment without a code edit.
BAB_TITLE_PATTERNS = (
    "Bowl After Bowl",
    "Episode 434 ★ Yeah Like",   # the one boost whose title omits the BAB show prefix
)


# Per-tx sender attribution. Use only when the classifier can't recover the
# identity from the boost itself and the user has confirmed an attribution
# out-of-band (or has a preference for which identity to display). Sets the
# sender_npub / sender_name pair explicitly — pick whichever identity the
# leaderboards should bucket under. An override blanks the other field so the
# pair stays in the npub-vs-name convention enforced everywhere else.
SENDER_OVERRIDES = {
    # Sir Spencer's PodcastGuru boost on Ep. 009 — confirmed npub out-of-band.
    "3ea283ab225cb5ad18f66f4030adf00f3fa7dac92d710603eee920bda5bf08be": {
        "sender_npub": "npub1yvscx9vrmpcmwcmydrm8lauqdpngum4ne8xmkgc2d4rcaxrx7tkswdwzdu",
        "sender_name": "",
    },
    # btcwrestle — boost the leaderboard should bucket by name rather than npub.
    "2c080dad8d607e8a531790b2a4d4848f8fdb9c99bdc5a387b8a26bb39372366f": {
        "sender_npub": "",
        "sender_name": "btcwrestle",
    },
}

# Per-tx divisor corrections. The shared classifier picks the RSS-split
# divisor by settledAt against SPLIT_CUTOFF_V2 (2026-03-29T13:10:00Z). A boost
# that settled just after that cutoff but was actually still on the old 98%
# split gets divisor 0.49 and a total_sats computed at ~2x its real value.
# Rather than chase the exact cutoff in the shared classifier, pin the divisor
# here and recompute total_sats from our_sats. Verified against Fountain's
# supporter record: BitcoinJim's boost 0de45faf — our node received 979 sats,
# Fountain says the boost was 999; 979 / 0.98 = 999. ✓
DIVISOR_OVERRIDES = {
    "0de45faf22775d62aebfc685175cb7dd3edce125a109b2b9acd63c033d399d75": 0.98,
}

# Ep 009 was livestreamed on the Bowl After Bowl feed — Spencer hosted it for
# us since we couldn't livestream ourselves. Streamed sats arriving via a
# crossover feed (not LB's own) within this window count toward Ep 009;
# crossover streams outside it fall to the show-level bucket. Adjust the
# window if streams turn up just outside it.
EP9_LIVESTREAM_START = "2026-05-02T00:30:00Z"   # 2026-05-01 8:30pm EDT
EP9_LIVESTREAM_END   = "2026-05-02T03:30:00Z"   # 2026-05-01 11:30pm EDT (padded
                                                # past the ~11pm end to catch
                                                # stragglers)

# LB's own podcast feed identity — used to tell LB-feed streams apart from
# crossover-feed streams (Bowl After Bowl, etc.) in keysend boostagrams and
# Castamatic stream metadata.
LB_FEED_GUID  = "56fbb1aa-da79-5e4b-bebc-3b934ab8914c"
LB_FEED_TITLE = "local bitcoiners"


def apply_manual_overrides(row):
    """Mutate `row` in place to apply manual reclassifications. Returns row.

    Episode and sender overrides are independent — a row can hit both if its
    payment hash matches in SENDER_OVERRIDES *and* it matches an episode
    override condition. Idempotent on already-overridden rows so it's safe
    to re-apply on every CSV reload.
    """
    ph    = row.get("payment_hash", "") or ""
    title = row.get("episode_title", "") or ""

    # Episode re-attribution
    if ph in LIVE_BOOST_HASHES:
        row["episode_id"]    = LIVE_EP_FOUNTAIN_ID
        row["episode_num"]   = LIVE_EP_NUM
        row["episode_title"] = LIVE_EP_TITLE
        row["show_level"]    = "false"
    elif any(p in title for p in BAB_TITLE_PATTERNS):
        row["episode_id"]    = ""
        row["episode_num"]   = ""
        row["episode_title"] = ""
        row["show_level"]    = "true"

    # Sender re-attribution
    if ph in SENDER_OVERRIDES:
        ov = SENDER_OVERRIDES[ph]
        row["sender_npub"] = ov.get("sender_npub", "")
        row["sender_name"] = ov.get("sender_name", "")

    # Divisor re-attribution — recompute total_sats from our_sats at the
    # corrected divisor. our_sats is the ground truth (what the node received);
    # total_sats is derived, so it's the one to fix.
    if ph in DIVISOR_OVERRIDES:
        new_div = DIVISOR_OVERRIDES[ph]
        our     = int(row.get("our_sats") or 0)
        row["divisor"]           = new_div
        row["total_sats"]        = round(our / new_div) if new_div else our
        row["total_sats_method"] = f"sat math {new_div:g} (manual override)"

    return row


# Fallback for the classifier's Ep. NNN detection. The shared
# `_extract_episode_number` only catches "001." at the very start of the
# title or "Ep. NNN" anywhere. Fountain prefixes Ep. 001's title with
# "Local Bitcoiners • 001. ..." so neither pattern hits, and every Ep. 001
# row comes back with a blank episode_num. Real fix belongs in
# boost_formatter.py; this is the local workaround.
_EP_NUM_FALLBACK_RE = re.compile(r'(?<!\d)(\d{1,3})\.\s+[A-Z]')


def fallback_episode_num(title):
    if not title:
        return ""
    m = _EP_NUM_FALLBACK_RE.search(title)
    if m:
        return m.group(1).zfill(3)
    return ""


def derive_total_method(info):
    """Audit string explaining how info['total_sats'] was computed.

    Mirrors the classifier's per-source logic in boost_formatter.py. Lives
    here (not in the classifier) so the shared module stays untouched — if
    classifier branching changes, update this function to match.
    """
    source  = info["source"]
    divisor = info.get("divisor") or 0
    app     = (info.get("app_name") or "").lower()
    total   = info.get("total_sats", 0)
    our     = info.get("our_sats", 0)

    if source == "fountain_stream":
        return f"sat math {divisor:g}"

    if source == "fountain_boost":
        if divisor == 1.0:
            if "castamatic" in app:
                return "castamatic api"
            return "tardbox"
        label = f"sat math {divisor:g}"
        if "castamatic" in app or "tardbox" in app or "boostme" in app:
            label += " (fallback)"
        return label

    if source == "keysend":
        if total == our:
            return "full amount received"
        return "keysend boostagram"

    if source == "website":
        if info.get("show_level"):
            return "kind 30078 + show split"
        return f"kind 30078 + sat math {divisor:g}"

    if source == "lb_donation":
        return "full amount received"

    return "unknown"


# ---------------------------------------------------------------------------
# State + CSV I/O
# ---------------------------------------------------------------------------

def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"last_processed": None}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def load_existing_rows():
    """Return all rows from data/sats.csv (or empty list if missing)."""
    if not CSV_FILE.exists():
        return []
    with CSV_FILE.open("r", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv_full(rows):
    """Full rewrite of data/sats.csv. Sorted by settled_at desc (then by
    payment_hash for stability on ties / empty timestamps)."""
    CSV_FILE.parent.mkdir(parents=True, exist_ok=True)
    sorted_rows = sorted(
        rows,
        key=lambda r: (r.get("settled_at") or "", r.get("payment_hash") or ""),
        reverse=True,
    )
    with CSV_FILE.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(sorted_rows)


def _coerce_json_value(col, raw):
    """Coerce one CSV cell (always a string on read-back) to its JSON type.

    The blank→null check runs first, so every empty cell becomes null
    regardless of column — one consistent rule. episode_num deliberately
    stays a string: the leading zeros ("001", "011") are load-bearing for
    episode matching and must not be cast to int."""
    if raw == "" or raw is None:
        return None
    if col in ("total_sats", "our_sats"):
        return int(raw)
    if col == "divisor":
        return float(raw)
    if col == "show_level":
        return raw == "true"
    return raw  # episode_num + everything else stay strings


def write_sats_json():
    """Mirror data/sats.csv as data/sats.json for the website to consume.

    Reads the CSV back (rather than re-using in-memory rows) so the JSON is
    guaranteed to match it exactly — same rows, same order, same columns —
    and so any future CSV schema change flows through automatically. Values
    get JSON-native types via _coerce_json_value; blanks become null. No
    filtering, no business logic — the website does all of that.

    Each row object is written on its own line to keep git diffs readable
    (this file is committed + autopushed daily)."""
    rows = []
    with CSV_FILE.open("r", newline="", encoding="utf-8") as f:
        for raw in csv.DictReader(f):
            rows.append({col: _coerce_json_value(col, raw.get(col, "")) for col in CSV_COLUMNS})

    generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    body = (
        "{\n"
        f'  "generated_at": {json.dumps(generated_at)},\n'
        '  "source": "sats.csv",\n'
        f'  "row_count": {len(rows)},\n'
        '  "rows": [\n'
        + ",\n".join("    " + json.dumps(r, ensure_ascii=False) for r in rows)
        + "\n  ]\n}\n"
    )
    SATS_JSON.write_text(body, encoding="utf-8")


# ---------------------------------------------------------------------------
# Alby Hub: boost ingestion
# ---------------------------------------------------------------------------

def fetch_page(config, limit, offset):
    url     = config["ALBY_HUB_URL"]
    token   = config["ALBY_TOKEN"]
    headers = {"Authorization": f"Bearer {token}"}
    resp    = requests.get(
        f"{url}/api/transactions?limit={limit}&offset={offset}",
        headers=headers, timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("transactions", []), data.get("totalCount", 0)


def info_to_row(info):
    """Project a classifier info dict into a CSV row.

    Boost messages can legally contain commas, quotes, and newlines. CSV
    quoting handles all three, but embedded real newlines make ``wc -l`` and
    ``grep`` confusing — collapse to a literal ``\\n`` so the file stays one
    tx per physical line on disk."""
    msg  = (info.get("message") or "").replace("\r\n", "\n").replace("\n", "\\n")
    kind = "stream" if info["source"] == "fountain_stream" else "boost"

    title  = info.get("episode_title") or ""
    ep_num = info.get("episode_number") or fallback_episode_num(title)

    row = {
        "settled_at":         info.get("settled_at", "") or "",
        "payment_hash":       info.get("payment_hash", "") or "",
        "source":             info.get("source", "") or "",
        "app":                info.get("app_name", "") or "",
        "kind":               kind,
        "sender_npub":        info.get("sender_npub") or "",
        "sender_name":        info.get("sender_name") or "",
        "episode_id":         info.get("episode_id") or "",
        "episode_num":        ep_num,
        "episode_title":      title,
        "show_level":         "true" if info.get("show_level") else "false",
        "total_sats":         info.get("total_sats", 0),
        "our_sats":           info.get("our_sats", 0),
        "divisor":            info.get("divisor", ""),
        "total_sats_method":  derive_total_method(info),
        "message":            msg,
    }
    return apply_manual_overrides(row)


def _is_keysend_stream(tx):
    bg = tx.get("boostagram") or {}
    return bg.get("action") == "stream"


def _is_castamatic_stream(tx):
    desc = tx.get("description", "") or ""
    return desc.startswith("rss::payment::stream") and "castamatic.com" in desc


def run_sats(config, state, existing_boost_hashes):
    """Paginate Alby Hub and classify each tx.

    Boosts are processed incrementally (cursor-gated — skip txs at/below the
    last_processed cursor) and emitted as per-tx rows.

    Stream txs the shared classifier doesn't handle — keysend streams
    (boostagram action == "stream") and Castamatic streams (rss::payment::stream
    with a castamatic.com URL) — are collected on EVERY page regardless of the
    cursor, because their rows are re-aggregated from scratch each run (like the
    Fountain Firestore stream rows). Fountain BOLT11 streams are still skipped
    here — those come from Firestore in run_supporters().

    Returns (new_boost_rows, keysend_stream_txs, castamatic_stream_txs,
    newest_settled_at, stats_dict).
    """
    cutoff = state.get("last_processed") or FETCH_START
    print(f"  Cursor (boosts only): settledAt > {cutoff}")

    cache                 = make_cache()
    new_rows              = []
    keysend_stream_txs    = []
    castamatic_stream_txs = []
    skipped_dup           = 0
    skipped_unclassified  = 0
    skipped_fountain_strm = 0
    offset                = 0
    limit                 = 50
    newest_ts             = state.get("last_processed")

    while True:
        try:
            txs, total = fetch_page(config, limit, offset)
        except Exception as e:
            print(f"[error] Could not reach Alby Hub: {e}")
            break

        if not txs:
            break

        print(f"    Fetched offset {offset} ({len(txs)} txs, total={total})")

        for tx in txs:
            if tx.get("type") != "incoming" or tx.get("state") != "settled":
                continue
            settled_at = tx.get("settledAt", "") or ""

            # Non-Fountain streams — collected on every page (not cursor-gated)
            # since the stream rows are fully re-aggregated each run.
            if _is_keysend_stream(tx):
                keysend_stream_txs.append(tx)
                continue
            if _is_castamatic_stream(tx):
                castamatic_stream_txs.append(tx)
                continue

            # Boost path — cursor-gated for incremental processing.
            if not settled_at or settled_at <= cutoff:
                continue

            payment_hash = tx.get("paymentHash", "") or ""
            if payment_hash and payment_hash in existing_boost_hashes:
                skipped_dup += 1
                if newest_ts is None or settled_at > newest_ts:
                    newest_ts = settled_at
                continue

            info = classify_lb_tx(tx, cache=cache)
            if not info:
                skipped_unclassified += 1
                continue

            # Fountain BOLT11 streams come from Firestore (run_supporters).
            # Advance the cursor past them but don't emit a row.
            if info["source"] == "fountain_stream":
                skipped_fountain_strm += 1
                if newest_ts is None or settled_at > newest_ts:
                    newest_ts = settled_at
                continue

            new_rows.append(info_to_row(info))
            if payment_hash:
                existing_boost_hashes.add(payment_hash)

            if newest_ts is None or settled_at > newest_ts:
                newest_ts = settled_at

        offset += limit
        if offset >= total:
            break
        time.sleep(0.5)

    persist_cache(cache)

    stats = {
        "new_boost_rows":         len(new_rows),
        "skipped_dup":            skipped_dup,
        "skipped_unclassified":   skipped_unclassified,
        "skipped_fountain_strm":  skipped_fountain_strm,
        "keysend_stream_txs":     len(keysend_stream_txs),
        "castamatic_stream_txs":  len(castamatic_stream_txs),
    }
    return new_rows, keysend_stream_txs, castamatic_stream_txs, newest_ts, stats


# ---------------------------------------------------------------------------
# Non-Fountain streams: keysend (CurioCaster/PodcastGuru/...) + Castamatic
#
# The shared classifier returns None for both — it only dispatches keysend on
# action=="boost", and _classify_fountain_stream only handles fountain.fm
# URLs. We handle them here, in sats-log only, rather than touching the shared
# classifier (which would ripple into the leaderboards + boost-publisher). Both
# carry enough metadata to attribute sender + episode; we aggregate them by
# (episode, sender) into the same row shape as the Fountain stream rows — but
# WITH our_sats populated, since these come from our node's per-tx data.
# ---------------------------------------------------------------------------

def classify_keysend_stream(tx):
    """Normalize a keysend stream tx (boostagram action == "stream"). The
    boostagram is inline — no network call. Returns a stream record dict."""
    bg = tx.get("boostagram") or {}

    our_sats   = round(int(tx.get("amount", 0) or 0) / 1000)
    gross_msat = bg.get("valueMsatTotal") or bg.get("value_msat_total") or 0
    total_sats = round(int(gross_msat) / 1000) if gross_msat else our_sats

    pubkey = bg.get("senderPubkey") or bg.get("sender_pub_key") or bg.get("pubkey")
    npub = ""
    if pubkey:
        try:
            npub = hex_to_npub(pubkey)
        except Exception:
            npub = ""
    sender_name = "" if npub else (bg.get("senderName") or bg.get("sender_name") or "")

    return {
        "source":      "keysend_stream",
        "app":         bg.get("appName") or bg.get("app_name") or "keysend",
        "settled_at":  tx.get("settledAt", "") or "",
        "our_sats":    our_sats,
        "total_sats":  total_sats,
        "sender_npub": npub,
        "sender_name": sender_name,
        "feed_title":  bg.get("podcast") or "",
        "feed_guid":   "",
        "ep_title":    bg.get("episode") or "",
        "item_guid":   "",
    }


def classify_castamatic_stream(tx, castamatic_cache):
    """Normalize a Castamatic stream tx. Fetches the boost-metadata JSON,
    persistently cached (the data is immutable). Returns a stream record dict,
    or None if the fetch failed and we have nothing to work with."""
    desc  = tx.get("description", "") or ""
    parts = desc.split()
    url   = parts[-1] if parts else ""
    if not url.startswith("http"):
        return None

    data = castamatic_cache.get(url)
    if data is None:
        try:
            data = requests.get(url, timeout=10).json()
        except Exception as e:
            print(f"  [warn] Castamatic stream fetch failed {url}: {e}")
            data = {}
        castamatic_cache[url] = data
    if not data:
        return None

    our_sats   = round(int(tx.get("amount", 0) or 0) / 1000)
    gross_msat = data.get("value_msat_total") or 0
    total_sats = round(int(gross_msat) / 1000) if gross_msat else our_sats

    return {
        "source":      "castamatic_stream",
        "app":         data.get("app_name") or "Castamatic",
        "settled_at":  tx.get("settledAt", "") or "",
        "our_sats":    our_sats,
        "total_sats":  total_sats,
        "sender_npub": "",                          # Castamatic carries no npub
        "sender_name": data.get("sender_name") or "",
        "feed_title":  data.get("feed_title") or "",
        "feed_guid":   data.get("feed_guid") or "",
        "ep_title":    data.get("item_title") or "",
        "item_guid":   data.get("item_guid") or "",
    }


def _is_lb_feed(rec):
    """True if a stream record came in on the Local Bitcoiners feed rather than
    a crossover feed (Bowl After Bowl, etc.)."""
    if rec.get("feed_guid") and rec["feed_guid"] == LB_FEED_GUID:
        return True
    return (rec.get("feed_title") or "").strip().lower() == LB_FEED_TITLE


def resolve_stream_episode(rec, rss_index, ep_num_to_meta):
    """Resolve a stream record to (episode_id, episode_num, episode_title,
    show_level).

    - Crossover-feed streams → show-level, EXCEPT those inside the Ep 009
      livestream window (BAB hosted that stream for us) → Ep 009.
    - LB-feed streams → episode-attributed: Castamatic via item_guid against
      the RSS index, keysend via the episode number parsed from its title.
      LB-feed streams that don't resolve to a known episode fall to show-level.
    """
    if not _is_lb_feed(rec):
        s = rec.get("settled_at", "")
        if EP9_LIVESTREAM_START <= s <= EP9_LIVESTREAM_END:
            return LIVE_EP_FOUNTAIN_ID, LIVE_EP_NUM, LIVE_EP_TITLE, False
        return "", "", "", True

    # Castamatic: item_guid → fountain id via the RSS index.
    item_guid = rec.get("item_guid")
    if item_guid:
        fid = (rss_index.get(item_guid) or {}).get("fountain_id")
        if fid:
            num = _extract_episode_number(rec.get("ep_title") or "") or ""
            return fid, num, rec.get("ep_title") or "", False

    # keysend (or Castamatic without a usable guid): episode-number title match.
    num = _extract_episode_number(rec.get("ep_title") or "")
    if num and num in ep_num_to_meta:
        eid, title = ep_num_to_meta[num]
        return eid, num, title, False

    # LB feed but unresolvable — keep it in the dataset at show level.
    return "", "", "", True


def build_node_stream_rows(stream_recs, ep_num_to_meta):
    """Aggregate normalized keysend/Castamatic stream records into one row per
    (episode-bucket, sender, source) — the same row shape as the Fountain
    stream rows, but with our_sats populated."""
    rss_index = build_rss_item_index(make_cache())

    agg = {}
    for rec in stream_recs:
        eid, num, title, show_level = resolve_stream_episode(rec, rss_index, ep_num_to_meta)
        bucket = "__show__" if show_level else eid
        npub, name = rec["sender_npub"], rec["sender_name"]
        sender_key = ("npub", npub) if npub else (("name", name) if name else ("anon", ""))
        key = (bucket, sender_key, rec["source"])

        a = agg.get(key)
        if a is None:
            a = {
                "source": rec["source"], "apps": set(),
                "sender_npub": npub, "sender_name": name,
                "episode_id": eid, "episode_num": num, "episode_title": title,
                "show_level": show_level,
                "total_sats": 0, "our_sats": 0, "last_settled": "",
            }
            agg[key] = a
        a["total_sats"] += rec["total_sats"]
        a["our_sats"]   += rec["our_sats"]
        a["apps"].add(rec["app"])
        if rec["settled_at"] > a["last_settled"]:
            a["last_settled"] = rec["settled_at"]

    rows = []
    for a in agg.values():
        rows.append({
            "settled_at":        a["last_settled"],
            "payment_hash":      "",
            "source":            a["source"],
            "app":               ",".join(sorted(x for x in a["apps"] if x)),
            "kind":              "stream",
            "sender_npub":       a["sender_npub"],
            "sender_name":       a["sender_name"],
            "episode_id":        a["episode_id"],
            "episode_num":       a["episode_num"],
            "episode_title":     a["episode_title"],
            "show_level":        "true" if a["show_level"] else "false",
            "total_sats":        a["total_sats"],
            "our_sats":          a["our_sats"],
            "divisor":           "",
            "total_sats_method": a["source"].replace("_", " ") + " aggregate",
            "message":           "",
        })
    return rows


# ---------------------------------------------------------------------------
# Fountain Firestore: supporter (stream) ingestion
# ---------------------------------------------------------------------------

def _unwrap(val):
    """Recursively unwrap a Firestore-typed JSON value into Python primitives."""
    if val is None:
        return None
    if "stringValue"    in val: return val["stringValue"]
    if "integerValue"   in val: return int(val["integerValue"])
    if "doubleValue"    in val: return float(val["doubleValue"])
    if "booleanValue"   in val: return val["booleanValue"]
    if "timestampValue" in val: return val["timestampValue"]
    if "nullValue"      in val: return None
    if "mapValue"       in val:
        return {k: _unwrap(v) for k, v in val["mapValue"].get("fields", {}).items()}
    if "arrayValue"     in val:
        return [_unwrap(v) for v in val["arrayValue"].get("values", [])]
    return None


def parse_supporter(doc):
    return {k: _unwrap(v) for k, v in doc.get("fields", {}).items()}


def fetch_supporters_for(entity_id, limit=SUPPORTERS_QUERY_LIMIT):
    """Query Fountain's Firestore for all supporters of a given entity_id.

    Single-filter ``entity._id == X`` because the composite filter
    (entity.type + entity._id) requires a Firestore index Fountain hasn't
    provisioned. Episode ids and show ids don't collide in this collection,
    so the type filter isn't needed — the response carries entity.type and
    we trust it.
    """
    query = {
        "structuredQuery": {
            "from": [{"collectionId": "supporters"}],
            "where": {
                "fieldFilter": {
                    "field": {"fieldPath": "entity._id"},
                    "op":    "EQUAL",
                    "value": {"stringValue": entity_id},
                }
            },
            "orderBy": [{
                "field":     {"fieldPath": "stats.btc.TOTAL.total"},
                "direction": "DESCENDING",
            }],
            "limit": limit,
        }
    }
    resp = requests.post(FIRESTORE_URL, json=query, timeout=30)
    resp.raise_for_status()
    parsed = [parse_supporter(d["document"]) for d in resp.json() if "document" in d]
    if len(parsed) >= limit:
        print(f"  [warn] hit query limit {limit} for {entity_id} — may be truncated")
    return parsed


def supporter_to_row(supporter, ep_id, ep_num, ep_title, show_level):
    """Build a stream-aggregate sats.csv row from a parsed Fountain supporter.

    Returns None if the supporter has no stream sats — we only emit one row
    per (episode, supporter) when there are actual stream payments to
    aggregate. Boost / zap / subscription totals from Fountain are ignored
    here; boost rows come from the per-tx Alby pipeline.

    Identity rules (matches the established sats.csv convention):
      - has _npub                  → sender_npub set, sender_name blank
      - info.name == "Anonymous"   → both blank (Fountain's anon label)
      - info.username | info.name  → sender_name set, sender_npub blank
      - otherwise                  → both blank (truly anonymous)
    """
    info_block   = supporter.get("info") or {}
    stats_block  = supporter.get("stats") or {}
    btc_block    = stats_block.get("btc") or {}
    total_block  = btc_block.get("TOTAL") or {}
    streams_sats = int(total_block.get("streams") or 0)
    if streams_sats <= 0:
        return None

    npub     = supporter.get("_npub") or ""
    username = info_block.get("username") or ""
    name     = info_block.get("name") or ""

    if npub:
        sender_npub, sender_name = npub, ""
    elif name == "Anonymous":
        sender_npub, sender_name = "", ""
    elif username:
        sender_npub, sender_name = "", username
    elif name:
        sender_npub, sender_name = "", name
    else:
        sender_npub, sender_name = "", ""

    meta     = supporter.get("meta") or {}
    lastseen = meta.get("lastseen") or ""

    return {
        "settled_at":        lastseen,
        "payment_hash":      "",
        "source":            "fountain_stream",
        "app":               "Fountain",
        "kind":              "stream",
        "sender_npub":       sender_npub,
        "sender_name":       sender_name,
        "episode_id":        ep_id if not show_level else "",
        "episode_num":       ep_num,
        "episode_title":     ep_title,
        "show_level":        "true" if show_level else "false",
        "total_sats":        streams_sats,
        "our_sats":          "",
        "divisor":           "",
        "total_sats_method": "fountain supporters firestore",
        "message":           "",
    }


def supporter_to_fountain_row(supporter, ep_num, ep_title):
    """Flatten a parsed Fountain supporter doc into a fountain-api.csv row.

    Unlike supporter_to_row(), this keeps EVERY supporter (boosters too, not
    just streamers) and EVERY stat Fountain exposes — all four periods, both
    currencies. It's the raw Fountain-side ledger for cross-referencing
    against sats.csv. entity type/id come straight from the doc."""
    entity = supporter.get("entity") or {}
    info   = supporter.get("info") or {}
    meta   = supporter.get("meta") or {}
    stats  = supporter.get("stats") or {}
    ids    = supporter.get("ids") or []

    row = {
        "entity_type":   entity.get("type") or "",
        "entity_id":     entity.get("_id") or "",
        "episode_num":   ep_num,
        "episode_title": ep_title,
        "supporter_id":  supporter.get("_id") or "",
        "user_id":       supporter.get("_user_id") or "",
        "npub":          supporter.get("_npub") or "",
        "name":          info.get("name") or "",
        "username":      info.get("username") or "",
        "ids":           ";".join(ids) if isinstance(ids, list) else "",
        "firstseen":     meta.get("firstseen") or "",
        "lastseen":      meta.get("lastseen") or "",
        "updated":       meta.get("updated") or "",
    }
    for cur in ("btc", "usd"):
        cur_block = stats.get(cur) or {}
        for period_in, period_out in _FOUNTAIN_PERIODS:
            period_block = cur_block.get(period_in) or {}
            for stat in _FOUNTAIN_STATS:
                row[f"{cur}_{period_out}_{stat}"] = period_block.get(stat) or 0
    return row


def write_fountain_csv(rows):
    """Full rewrite of data/fountain-api.csv. Sorted by entity_id then
    btc all-time total desc — keeps an entity's supporters grouped and ranked."""
    FOUNTAIN_CSV.parent.mkdir(parents=True, exist_ok=True)
    sorted_rows = sorted(
        rows,
        key=lambda r: (r.get("entity_id") or "", -int(r.get("btc_alltime_total") or 0)),
    )
    with FOUNTAIN_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FOUNTAIN_COLUMNS)
        writer.writeheader()
        writer.writerows(sorted_rows)


def run_supporters(all_boost_rows):
    """Fetch per-(episode, supporter) stream aggregates from Fountain.

    Distinct Fountain episode_ids come from the boost rows (any non-empty
    real Fountain id — synthetic keysend_/lb_website_/lb_donation_ ids are
    skipped because Fountain doesn't have supporter records under them).
    Plus a show-level pass for sats streamed to the LB show entity rather
    than a specific episode.
    """
    episode_ids  = set()
    episode_meta = {}  # ep_id -> (ep_num, ep_title)

    for row in all_boost_rows:
        ep_id = row.get("episode_id", "") or ""
        if not ep_id:
            continue
        if row.get("show_level") == "true":
            continue
        if (ep_id.startswith("lb_website_")
                or ep_id.startswith("keysend_")
                or ep_id.startswith("lb_donation_")):
            continue
        episode_ids.add(ep_id)
        if ep_id not in episode_meta:
            episode_meta[ep_id] = (row.get("episode_num", ""), row.get("episode_title", ""))

    print(f"  Querying Firestore for {len(episode_ids)} episodes + show-level...")

    stream_rows   = []  # streamers only → merged into sats.csv
    fountain_rows = []  # every supporter → dumped to fountain-api.csv

    for ep_id in sorted(episode_ids):
        ep_num, ep_title = episode_meta[ep_id]
        supporters = fetch_supporters_for(ep_id)
        rows_for_ep = 0
        for s in supporters:
            fountain_rows.append(supporter_to_fountain_row(s, ep_num, ep_title))
            row = supporter_to_row(s, ep_id, ep_num, ep_title, show_level=False)
            if row:
                stream_rows.append(row)
                rows_for_ep += 1
        if rows_for_ep:
            print(f"    Ep {ep_num or '???'} ({ep_id}): {rows_for_ep} streamer(s) "
                  f"of {len(supporters)} supporter(s)")
        time.sleep(0.2)  # polite gap between Firestore queries

    # Show-level supporters: still pulled so fountain-api.csv carries the
    # complete Fountain ledger, but deliberately NOT emitted as sats.csv stream
    # rows. Verified against the LN node on 2026-05-14: Fountain's show-level
    # stream figure is a pure rollup of every episode's streams — episode-sum
    # and show-sum matched to the sat (16,278 == 16,278), and both lined up
    # with the node's per-episode stream receipts. Emitting show-level stream
    # rows on top of episode-level ones double-counts every streamed sat.
    # Fountain doesn't expose a rollup-vs-direct split, and direct-to-show
    # streaming appears to be zero on this platform, so there's nothing to
    # recover by keeping them.
    show_supporters = fetch_supporters_for(LB_SHOW_FOUNTAIN_ID)
    for s in show_supporters:
        fountain_rows.append(supporter_to_fountain_row(s, "", ""))
    print(f"    Show-level: {len(show_supporters)} supporter(s) "
          f"(→ fountain-api.csv only; streams are an episode rollup)")

    return stream_rows, fountain_rows


# ---------------------------------------------------------------------------
# git autopush
# ---------------------------------------------------------------------------

def git_autopush():
    """Best-effort commit + push of the data CSVs. Failures log and return —
    the local CSVs are the source of truth; a missed push just means the next
    run picks up where this one left off."""
    files = ["data/sats.csv", "data/sats.json", "data/fountain-api.csv"]
    try:
        subprocess.run(
            ["git", "pull", "--rebase", "--autostash"],
            cwd=REPO_ROOT, check=True, capture_output=True,
        )
        status = subprocess.run(
            ["git", "status", "--porcelain"] + files,
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        )
        if not status.stdout.strip():
            print("  [autopush] no changes to commit")
            return
        subprocess.run(["git", "add"] + files, cwd=REPO_ROOT, check=True)
        subprocess.run(
            ["git", "commit", "-m", "Update sats log"],
            cwd=REPO_ROOT, check=True, capture_output=True,
        )
        subprocess.run(["git", "push"], cwd=REPO_ROOT, check=True, capture_output=True)
        print("  [autopush] pushed sats.csv + sats.json + fountain-api.csv")
    except subprocess.CalledProcessError as e:
        err = e.stderr.decode() if e.stderr else ""
        print(f"  [autopush] failed: {e}\n  {err}")


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def main():
    config = load_config(CREDENTIALS_FILE)
    state  = load_state()

    if DRY_RUN:
        print("[dry-run] — will NOT write CSV / advance state / push\n")

    # Load existing CSV. We keep the boost rows (per-tx, append-only by hash)
    # and discard any pre-existing stream rows (regenerated from Firestore
    # every run). On the very first new-shape run this implicitly purges the
    # old per-minute stream rows from sats.csv.
    existing_rows       = load_existing_rows()
    existing_boost_rows = [r for r in existing_rows if r.get("kind") != "stream"]
    # Re-run overrides on every reload so edits to LIVE_BOOST_HASHES /
    # BAB_TITLE_PATTERNS / SENDER_OVERRIDES take effect on the next run
    # without a full CSV regen.
    for r in existing_boost_rows:
        apply_manual_overrides(r)
    existing_hashes     = {r["payment_hash"] for r in existing_boost_rows if r.get("payment_hash")}
    print(f"Existing CSV: {len(existing_rows)} rows total → "
          f"{len(existing_boost_rows)} boost rows kept, "
          f"{len(existing_rows) - len(existing_boost_rows)} stream rows dropped (will regen)\n")

    # ── Pass 1: Alby Hub — boost rows + raw non-Fountain stream txs ──
    print("─── Pass 1/3: Alby Hub (boosts + non-Fountain stream txs) ───")
    (new_boost_rows, keysend_stream_txs, castamatic_stream_txs,
     newest_ts, sats_stats) = run_sats(config, state, existing_hashes)
    print()
    print(f"  New boost rows:                  {sats_stats['new_boost_rows']}")
    print(f"  Duplicates skipped:              {sats_stats['skipped_dup']}")
    print(f"  Fountain stream txs skipped:     {sats_stats['skipped_fountain_strm']}  (→ Firestore)")
    print(f"  Keysend stream txs collected:    {sats_stats['keysend_stream_txs']}")
    print(f"  Castamatic stream txs collected: {sats_stats['castamatic_stream_txs']}")
    print(f"  Non-LB txs (unclassified):       {sats_stats['skipped_unclassified']}")

    all_boost_rows = existing_boost_rows + new_boost_rows

    # episode_num → (episode_id, episode_title), used to resolve keysend stream
    # episode titles to a Fountain episode id.
    ep_num_to_meta = {}
    for r in all_boost_rows:
        num, eid = r.get("episode_num"), r.get("episode_id")
        if num and eid and num not in ep_num_to_meta:
            ep_num_to_meta[num] = (eid, r.get("episode_title", ""))

    # ── Pass 2: non-Fountain streams (keysend + Castamatic) ──
    print()
    print("─── Pass 2/3: non-Fountain streams (keysend + Castamatic) ───")
    castamatic_cache = state.get("castamatic_cache", {})
    stream_recs = [classify_keysend_stream(tx) for tx in keysend_stream_txs]
    for tx in castamatic_stream_txs:
        rec = classify_castamatic_stream(tx, castamatic_cache)
        if rec:
            stream_recs.append(rec)
    node_stream_rows = build_node_stream_rows(stream_recs, ep_num_to_meta)
    state["castamatic_cache"] = castamatic_cache
    print(f"  Node stream rows (→sats.csv): {len(node_stream_rows)} "
          f"(from {len(stream_recs)} stream payments)")

    # ── Pass 3: Fountain Firestore for stream aggregates + full ledger ──
    print()
    print("─── Pass 3/3: Fountain Firestore (stream aggregates + full ledger) ───")
    stream_rows, fountain_rows = run_supporters(all_boost_rows)
    print(f"\n  Fountain stream-aggregate rows (→sats.csv): {len(stream_rows)}")
    print(f"  Full supporter rows (→fountain-api.csv):    {len(fountain_rows)}")

    # ── Combine + stats ──
    all_rows = all_boost_rows + stream_rows + node_stream_rows
    print()
    print(f"Total rows in regenerated CSV: {len(all_rows)} "
          f"({len(all_boost_rows)} boosts + {len(stream_rows)} Fountain streams "
          f"+ {len(node_stream_rows)} node streams)")

    by_source = Counter(r["source"]            for r in all_rows)
    by_kind   = Counter(r["kind"]              for r in all_rows)
    by_method = Counter(r["total_sats_method"] for r in all_rows)
    by_app    = Counter(r["app"]               for r in all_rows)
    sats_total = sum(int(r.get("total_sats") or 0) for r in all_rows)

    print("\nBy source:")
    for s, c in by_source.most_common():
        print(f"  {s:20s} {c}")
    print("By kind:")
    for k, c in by_kind.most_common():
        print(f"  {k:20s} {c}")
    print("By app:")
    for a, c in by_app.most_common():
        print(f"  {a or '<empty>':22s} {c}")
    print("By total_sats_method:")
    for m, c in by_method.most_common():
        print(f"  {m:34s} {c}")
    print(f"\nGross sat intent (sum of total_sats across all rows): {sats_total:,}")

    if DRY_RUN:
        print("\n[dry-run] First few node stream rows (keysend / Castamatic):")
        for r in node_stream_rows[:5]:
            print(f"  {r}")
        print("\n[dry-run] First few Fountain stream rows:")
        for r in stream_rows[:3]:
            print(f"  {r}")
        print("\n[dry-run] not writing CSVs, not advancing state, not pushing.")
        return

    write_csv_full(all_rows)
    print(f"\nWrote {len(all_rows)} rows → {CSV_FILE}")

    write_sats_json()
    print(f"Wrote {len(all_rows)} rows → {SATS_JSON}")

    write_fountain_csv(fountain_rows)
    print(f"Wrote {len(fountain_rows)} rows → {FOUNTAIN_CSV}")

    # Persist state: the Alby cursor (if it advanced) and the Castamatic
    # stream cache (which may have grown even when the cursor didn't).
    if newest_ts:
        state["last_processed"] = newest_ts
    save_state(state)
    print(f"State saved (cursor: {state.get('last_processed')}, "
          f"castamatic cache: {len(state.get('castamatic_cache', {}))} entries)")

    if AUTOPUSH:
        print("\n─── git autopush ───")
        git_autopush()


if __name__ == "__main__":
    main()
