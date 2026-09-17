#!/usr/bin/env bash
# Scan user-visible copy for prohibited claims (build prompt §21 / launch gates).
# Fails (exit 1) if any prohibited claim appears in app copy, emails, or seeds.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# Each entry: pattern|why
CHECKS=(
  'reserved|never describe stock as reserved/held/secured/guaranteed'
  'guaranteed[^_]|never describe stock as reserved/held/secured/guaranteed'
  'in stock and ready to ship|use source_check availability, not fake reservations'
  'generally accepted accounting principles|never claim GAAP statements'
  'GAAP financial statements|never claim GAAP statements'
  'we prepare your tax|never claim to prepare tax returns'
  'California corporation|Fanzia is a Delaware corporation'
  '13\.5%.*DDP|unconfirmed King Punch surcharge must not appear in pricing/copy'
)
EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude=package-lock.json)
FOUND=0
for c in "${CHECKS[@]}"; do
  pat="${c%%|*}"; why="${c#*|}"
  if grep -rEI "${EXCLUDES[@]}" "$pat" app components lib/email db/seed.ts 2>/dev/null; then
    echo "  ^-- prohibited: $why"
    FOUND=1
  fi
done
if [ "$FOUND" -eq 1 ]; then
  echo "scan-claims: FAIL — prohibited claims detected"
  exit 1
fi
echo "scan-claims: OK"
