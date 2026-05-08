#!/bin/bash
# Manually publish all three Local Bitcoiners leaderboards, in order.
# Run ~1 hour before recording the next episode.
#
# Order (handled inside local_bitcoiners_leaderboards.py):
#   1. episodesats     — top episodes by all-time sats
#   2. boost-leaders   — listeners ranked by number of shows boosted
#   3. top-boosts      — single largest boosts of all time
#
# No systemd, no sudo. Every successful publish appends a row to
# ../data/leaderboards.csv via record_published_leaderboard().

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

python3 "$DIR/leaderboards/local_bitcoiners_leaderboards.py"
