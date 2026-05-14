#!/usr/bin/env python3
"""Local Bitcoiners — sats log.

Builds the canonical raw log at ``data/sats.csv`` from two data sources:

  1. **Boosts** (one row per payment) — paginated from Alby Hub via the
     existing shared classifier. Covers boosts, website donations, keysend
     boosts, and general LB donations. Each row carries the donor's full
     intent, what the node received, the divisor used, the boost message,
     and the donor's npub/name where recoverable.

  2. **Streams** (one row per ``(episode, Fountain supporter)``) — pulled
     from Fountain's public Firestore ``supporters`` collection. Each row
     is a per-supporter aggregate of *every* stream payment that supporter
     has sent to the episode (lifetime). Sender npub or Fountain username
     is preserved; ``our_sats`` stays blank because Fountain doesn't expose
     per-tx attribution we could split our LN node's receipts against.

  Rationale for two grains: stream payments are per-minute drips with no
  sender metadata on the LN payment itself (BOLT11 carries no TLV sender),
  so per-tx attribution is impossible from our side. Fountain *does* have
  the attribution since they're the sending wallet, and exposes it as
  aggregate stats per (episode, supporter). Boost rows stay per-tx because
  each one carries a message and identity we don't want to flatten.

State:
  ``state.json`` (gitignored) carries the Alby Hub ``last_processed`` cursor
  for incremental boost pagination. Stream rows are regenerated every run
  (the Fountain aggregate grows over time), so this bot rewrites the CSV in
  full each run rather than appending.

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
from boost_formatter import classify_lb_tx, make_cache, persist_cache
from nostr_utils import load_config

# --- Config ---
CREDENTIALS_FILE = Path.home() / ".config/nostr-bots/credentials.env"
SCRIPT_DIR       = Path(__file__).resolve().parent
STATE_FILE       = SCRIPT_DIR / "state.json"
REPO_ROOT        = Path(__file__).resolve().parent.parent.parent
CSV_FILE         = REPO_ROOT / "data" / "sats.csv"

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


def apply_manual_overrides(row):
    """Mutate `row` in place to apply manual reclassifications. Returns row."""
    ph    = row.get("payment_hash", "") or ""
    title = row.get("episode_title", "") or ""

    if ph in LIVE_BOOST_HASHES:
        row["episode_id"]    = LIVE_EP_FOUNTAIN_ID
        row["episode_num"]   = LIVE_EP_NUM
        row["episode_title"] = LIVE_EP_TITLE
        row["show_level"]    = "false"
        return row

    if any(p in title for p in BAB_TITLE_PATTERNS):
        row["episode_id"]    = ""
        row["episode_num"]   = ""
        row["episode_title"] = ""
        row["show_level"]    = "true"
        return row

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


def run_sats(config, state, existing_boost_hashes):
    """Paginate Alby Hub from the cursor and classify each tx.

    Returns (new_boost_rows, newest_settled_at, stats_dict). fountain_stream
    txs are deliberately skipped — stream attribution comes from Fountain's
    Firestore in run_supporters(), not from per-minute LN payments. The
    cursor still advances past them so we don't reprocess on next run.
    """
    cutoff = state.get("last_processed") or FETCH_START
    print(f"  Cursor: settledAt > {cutoff}")

    cache                 = make_cache()
    new_rows              = []
    skipped_dup           = 0
    skipped_unclassified  = 0
    skipped_streams       = 0
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

        settled_times  = [t.get("settledAt") for t in txs if t.get("settledAt")]
        oldest_on_page = min(settled_times) if settled_times else ""
        last_page      = bool(oldest_on_page) and oldest_on_page <= cutoff

        for tx in txs:
            settled_at = tx.get("settledAt", "")
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

            # Stream txs are handled by Fountain Firestore (run_supporters).
            # Advance the cursor past them so they're not reprocessed, but
            # don't emit a row.
            if info["source"] == "fountain_stream":
                skipped_streams += 1
                if newest_ts is None or settled_at > newest_ts:
                    newest_ts = settled_at
                continue

            new_rows.append(info_to_row(info))
            if payment_hash:
                existing_boost_hashes.add(payment_hash)

            if newest_ts is None or settled_at > newest_ts:
                newest_ts = settled_at

        offset += limit
        if last_page or offset >= total:
            break
        time.sleep(0.5)

    persist_cache(cache)

    stats = {
        "new_boost_rows":      len(new_rows),
        "skipped_dup":         skipped_dup,
        "skipped_unclassified": skipped_unclassified,
        "skipped_streams":     skipped_streams,
    }
    return new_rows, newest_ts, stats


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

    stream_rows = []
    for ep_id in sorted(episode_ids):
        ep_num, ep_title = episode_meta[ep_id]
        supporters = fetch_supporters_for(ep_id)
        rows_for_ep = 0
        for s in supporters:
            row = supporter_to_row(s, ep_id, ep_num, ep_title, show_level=False)
            if row:
                stream_rows.append(row)
                rows_for_ep += 1
        if rows_for_ep:
            print(f"    Ep {ep_num or '???'} ({ep_id}): {rows_for_ep} streamer(s)")
        time.sleep(0.2)  # polite gap between Firestore queries

    # Show-level supporters (sats streamed to the show entity, not an episode)
    show_supporters = fetch_supporters_for(LB_SHOW_FOUNTAIN_ID)
    show_rows = 0
    for s in show_supporters:
        row = supporter_to_row(s, "", "", "", show_level=True)
        if row:
            stream_rows.append(row)
            show_rows += 1
    if show_rows:
        print(f"    Show-level: {show_rows} streamer(s)")

    return stream_rows


# ---------------------------------------------------------------------------
# git autopush
# ---------------------------------------------------------------------------

def git_autopush():
    """Best-effort commit + push of data/sats.csv. Failures log and return —
    the local CSV is the source of truth; a missed push just means the next
    run picks up where this one left off."""
    try:
        subprocess.run(
            ["git", "pull", "--rebase", "--autostash"],
            cwd=REPO_ROOT, check=True, capture_output=True,
        )
        status = subprocess.run(
            ["git", "status", "--porcelain", "data/sats.csv"],
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        )
        if not status.stdout.strip():
            print("  [autopush] no changes to commit")
            return
        subprocess.run(["git", "add", "data/sats.csv"], cwd=REPO_ROOT, check=True)
        subprocess.run(
            ["git", "commit", "-m", "Update sats log"],
            cwd=REPO_ROOT, check=True, capture_output=True,
        )
        subprocess.run(["git", "push"], cwd=REPO_ROOT, check=True, capture_output=True)
        print("  [autopush] pushed sats.csv")
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
    existing_hashes     = {r["payment_hash"] for r in existing_boost_rows if r.get("payment_hash")}
    print(f"Existing CSV: {len(existing_rows)} rows total → "
          f"{len(existing_boost_rows)} boost rows kept, "
          f"{len(existing_rows) - len(existing_boost_rows)} stream rows dropped (will regen)\n")

    # ── Pass 1: Alby Hub for boost rows ──
    print("─── Pass 1/2: Alby Hub (boost ingestion) ───")
    new_boost_rows, newest_ts, sats_stats = run_sats(config, state, existing_hashes)
    print()
    print(f"  New boost rows:                {sats_stats['new_boost_rows']}")
    print(f"  Duplicates skipped:            {sats_stats['skipped_dup']}")
    print(f"  Stream txs skipped (→Fountain): {sats_stats['skipped_streams']}")
    print(f"  Non-LB txs (unclassified):     {sats_stats['skipped_unclassified']}")

    all_boost_rows = existing_boost_rows + new_boost_rows

    # ── Pass 2: Fountain Firestore for stream aggregates ──
    print()
    print("─── Pass 2/2: Fountain Firestore (stream aggregates) ───")
    stream_rows = run_supporters(all_boost_rows)
    print(f"\n  Stream-aggregate rows: {len(stream_rows)}")

    # ── Combine + stats ──
    all_rows = all_boost_rows + stream_rows
    print()
    print(f"Total rows in regenerated CSV: {len(all_rows)} "
          f"({len(all_boost_rows)} boosts + {len(stream_rows)} stream aggregates)")

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
        print("\n[dry-run] First few new stream rows:")
        for r in stream_rows[:5]:
            print(f"  {r}")
        print("\n[dry-run] not writing CSV, not advancing state, not pushing.")
        return

    write_csv_full(all_rows)
    print(f"\nWrote {len(all_rows)} rows → {CSV_FILE}")

    if newest_ts and newest_ts != state.get("last_processed"):
        state["last_processed"] = newest_ts
        save_state(state)
        print(f"State updated → {newest_ts}")

    if AUTOPUSH:
        print("\n─── git autopush ───")
        git_autopush()


if __name__ == "__main__":
    main()
