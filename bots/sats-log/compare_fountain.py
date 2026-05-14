#!/usr/bin/env python3
"""Compare data/sats.csv (our LN-node + sat-math view) against
data/fountain-api.csv (Fountain's own accounting).

Joins on BOOST sats only, per (episode, supporter-npub). Stream rows in
sats.csv are copied verbatim from fountain-api.csv, so comparing those is
circular — but boosts are two *independent* measurements of the same money
(our node + classifier + divisor math vs. Fountain's ledger), so deltas
surface real signal: wrong divisors, classifier misses, or boosts Fountain
counts that never hit our node.

Join keys:  sats.csv.episode_id  == fountain-api.csv.entity_id
            sats.csv.sender_npub == fountain-api.csv.npub

Name-only and fully-anonymous boosts can't be joined (no shared identifier)
and are reported as excluded totals.

Read-only. Run:  python3 compare_fountain.py
"""
import csv
from pathlib import Path
from collections import defaultdict

REPO_ROOT    = Path(__file__).resolve().parent.parent.parent
SATS_CSV     = REPO_ROOT / "data" / "sats.csv"
FOUNTAIN_CSV = REPO_ROOT / "data" / "fountain-api.csv"


def main():
    # --- our view: boost sats from sats.csv, keyed (episode, npub) ---
    our_npub      = defaultdict(int)
    our_apps      = defaultdict(set)
    ep_num_map    = {}
    our_name_only = 0
    our_anon      = 0
    with SATS_CSV.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r.get("episode_id") and r.get("episode_num"):
                ep_num_map[r["episode_id"]] = r["episode_num"]
            if r["kind"] != "boost":
                continue
            sats = int(r["total_sats"] or 0)
            ep   = r["episode_id"].strip() or (
                "__show__" if r["show_level"] == "true" else "__noep__"
            )
            npub = r["sender_npub"].strip()
            if npub:
                our_npub[(ep, npub)] += sats
                our_apps[(ep, npub)].add(r["app"])
            elif r["sender_name"].strip():
                our_name_only += sats
            else:
                our_anon += sats

    # --- fountain view: btc_alltime_boosts from fountain-api.csv ---
    fountain_npub = defaultdict(int)
    with FOUNTAIN_CSV.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            boosts = int(r["btc_alltime_boosts"] or 0)
            if not boosts:
                continue
            npub = r["npub"].strip()
            if not npub:
                continue
            ep = r["entity_id"].strip() if r["entity_type"] == "EPISODE" else "__show__"
            fountain_npub[(ep, npub)] += boosts

    def ep_label(ep):
        if ep == "__show__":
            return "SHOW"
        if ep == "__noep__":
            return "(no ep)"
        return f"Ep {ep_num_map.get(ep, '???')}"

    # --- partition the joined keyset ---
    mismatches    = []   # in both, different totals
    fountain_only = []   # Fountain has it, we don't
    ours_only     = []   # we have it, Fountain doesn't
    exact         = []   # in both, identical
    for key in set(our_npub) | set(fountain_npub):
        ours = our_npub.get(key, 0)
        fnt  = fountain_npub.get(key, 0)
        if ours and fnt:
            (exact if ours == fnt else mismatches).append((key, ours, fnt))
        elif ours:
            ours_only.append((key, ours))
        else:
            fountain_only.append((key, fnt))

    # --- MISMATCHES ---
    print("=" * 78)
    print("MISMATCHES — joined on (episode, npub), totals disagree")
    print("=" * 78)
    if mismatches:
        mismatches.sort(key=lambda x: -abs(x[1] - x[2]))
        print(f"  {'episode':9s} {'npub':18s} {'ours':>8s} {'fountain':>9s} {'delta':>8s}  apps")
        for (ep, npub), ours, fnt in mismatches:
            apps = ",".join(sorted(our_apps.get((ep, npub), set())))
            print(f"  {ep_label(ep):9s} {npub[:16]+'…':18s} "
                  f"{ours:>8,} {fnt:>9,} {ours-fnt:>+8,}  {apps}")
    else:
        print("  (none — every joined pair agrees to the sat)")

    # --- FOUNTAIN-ONLY ---
    print()
    print("=" * 78)
    print("FOUNTAIN-ONLY — Fountain recorded boost sats our node/classifier didn't")
    print("=" * 78)
    if fountain_only:
        fountain_only.sort(key=lambda x: -x[1])
        for (ep, npub), fnt in fountain_only:
            print(f"  {ep_label(ep):9s} {npub[:16]+'…':18s} {fnt:>8,} sats")
        print(f"  --- {len(fountain_only)} pairs, {sum(v for _, v in fountain_only):,} sats total")
    else:
        print("  (none)")

    # --- OURS-ONLY (grouped by app, since most are non-Fountain apps) ---
    print()
    print("=" * 78)
    print("OURS-ONLY — we recorded it, Fountain has no matching supporter")
    print("(expected for non-Fountain apps: PodcastGuru, Castamatic, website, etc.)")
    print("=" * 78)
    if ours_only:
        by_app = defaultdict(lambda: [0, 0])  # app-set -> [pairs, sats]
        for key, ours in ours_only:
            apps = ",".join(sorted(our_apps.get(key, set()))) or "(unknown)"
            by_app[apps][0] += 1
            by_app[apps][1] += ours
        for apps, (n, sats) in sorted(by_app.items(), key=lambda x: -x[1][1]):
            print(f"  {apps:32s} {n:>3} pairs  {sats:>9,} sats")
        print(f"  --- {len(ours_only)} pairs, {sum(v for _, v in ours_only):,} sats total")
    else:
        print("  (none)")

    # --- SUMMARY ---
    matched_ours = sum(o for _, o, _ in exact) + sum(o for _, o, _ in mismatches)
    matched_fnt  = sum(f for _, _, f in exact) + sum(f for _, _, f in mismatches)
    print()
    print("=" * 78)
    print("SUMMARY")
    print("=" * 78)
    print(f"  joined pairs (episode,npub in BOTH files):  {len(exact) + len(mismatches)}")
    print(f"    exact matches:   {len(exact):>4}  ({sum(o for _, o, _ in exact):,} sats)")
    print(f"    mismatches:      {len(mismatches):>4}")
    print(f"    our sum  on joined pairs:  {matched_ours:>9,}")
    print(f"    fnt sum  on joined pairs:  {matched_fnt:>9,}")
    print(f"    net delta on joined pairs: {matched_ours - matched_fnt:>+9,}")
    print()
    print(f"  ours-only pairs:      {len(ours_only):>4}  ({sum(v for _, v in ours_only):,} sats)")
    print(f"  fountain-only pairs:  {len(fountain_only):>4}  ({sum(v for _, v in fountain_only):,} sats)")
    print()
    print(f"  [not joinable — no npub in sats.csv]")
    print(f"    name-only boosts:  {our_name_only:>9,} sats")
    print(f"    anonymous boosts:  {our_anon:>9,} sats")


if __name__ == "__main__":
    main()
