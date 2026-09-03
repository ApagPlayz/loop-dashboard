#!/usr/bin/env bash
# Screenshot a URL to a path we control, so the result can actually be looked at.
#
# Playwright's MCP screenshots report success and then vanish from
# .playwright-mcp/ — its .yml snapshots persist but the PNGs do not. That made
# "verified" mean "returned HTTP 200", which is how a batch of mockups shipped
# with overflowing text and dead links. Drive Chrome directly instead.
#
#   scripts/shot.sh <url> <out.png> [width] [height]
#
# Full-page rather than viewport, so content below the fold is caught too.

set -euo pipefail

URL="${1:?usage: shot.sh <url> <out.png> [width] [height]}"
OUT="${2:?usage: shot.sh <url> <out.png> [width] [height]}"
W="${3:-1440}"
H="${4:-900}"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "shot.sh: Chrome not found at $CHROME" >&2; exit 1; }

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

# Chrome logs mach task_policy noise to stderr on macOS; it is not an error.
"$CHROME" \
  --headless \
  --disable-gpu \
  --hide-scrollbars \
  --run-all-compositor-stages-before-draw \
  --virtual-time-budget=4000 \
  --window-size="${W},${H}" \
  --screenshot="$OUT" \
  "$URL" 2>/dev/null || true

if [ ! -s "$OUT" ]; then
  echo "shot.sh: FAILED — no image written for $URL" >&2
  exit 1
fi

echo "$OUT ($(wc -c < "$OUT" | tr -d ' ') bytes, ${W}x${H})"
