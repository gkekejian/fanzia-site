#!/usr/bin/env bash
# Scan the platform tree for accidentally committed secrets. Fails (exit 1)
# if any pattern matches. Excludes node_modules, .next, and lockfiles.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PATTERNS=(
  'sk-ant-[A-Za-z0-9_-]{10,}'
  'sk-live-[A-Za-z0-9]{10,}'
  'sk_test_[A-Za-z0-9]{10,}'
  'whsec_[A-Za-z0-9]{10,}'
  'xox[bap]-[A-Za-z0-9-]{10,}'
  'AKIA[0-9A-Z]{16}'
  '-----BEGIN (RSA )?PRIVATE KEY-----'
  'ghp_[A-Za-z0-9]{10,}'
  'github_pat_[A-Za-z0-9_]{10,}'
)
EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude=package-lock.json --exclude='*.snap')
FOUND=0
for p in "${PATTERNS[@]}"; do
  if grep -rEI "${EXCLUDES[@]}" -- "$p" . ; then
    FOUND=1
  fi
done
# .env files must never be committed (only .env.example ships)
if git ls-files | grep -E '(^|/)\.env$' ; then
  echo "ERROR: .env file tracked in git"
  FOUND=1
fi
if [ "$FOUND" -eq 1 ]; then
  echo "scan-secrets: FAIL — possible secrets detected"
  exit 1
fi
echo "scan-secrets: OK"
