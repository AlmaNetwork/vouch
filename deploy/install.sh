#!/usr/bin/env sh
# vouch node installer (curl | sh). Parameterized by env vars — NO cloud/account values baked in.
#   curl -fsSL https://raw.githubusercontent.com/AlmaNetwork/vouch/main/deploy/install.sh | sh
#
# Env knobs (all optional):
#   VOUCH_REPO_URL  git remote            (default: AlmaNetwork/vouch)
#   VOUCH_REF       branch/tag/sha        (default: main)
#   VOUCH_PREFIX    install dir           (default: /opt/vouch)
set -eu

REPO_URL="${VOUCH_REPO_URL:-https://github.com/AlmaNetwork/vouch.git}"
REF="${VOUCH_REF:-main}"
PREFIX="${VOUCH_PREFIX:-/opt/vouch}"

# 1. bun (Bun-bound runtime). Skip if already present.
if ! command -v bun >/dev/null 2>&1; then
  echo "==> installing bun"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# 2. fetch the repo at REF
echo "==> fetching $REPO_URL@$REF -> $PREFIX"
if [ -d "$PREFIX/.git" ]; then
  git -C "$PREFIX" fetch --depth 1 origin "$REF"
  git -C "$PREFIX" checkout -f "$REF"
else
  git clone --depth 1 --branch "$REF" "$REPO_URL" "$PREFIX"
fi
cd "$PREFIX"

# 3. install deps — vouch-core FIRST (vouch-world resolves it through node_modules)
echo "==> installing dependencies"
( cd vouch-core  && bun install --frozen-lockfile )
( cd vouch-world && bun install --frozen-lockfile )

# 4. host-specific hook (AWS instance metadata, IAM, secrets fetch, …) — optional, no-op by default.
if [ -x "$PREFIX/deploy/host-hook.sh" ]; then
  echo "==> running host hook"
  "$PREFIX/deploy/host-hook.sh"
fi

cat <<EOF

vouch installed at $PREFIX
  run now:        cd $PREFIX && READ_PORT=8787 WRITE_PORT=8788 bun node/main.ts
  or as a service: sudo cp deploy/vouch-node.service /etc/systemd/system/ && sudo systemctl enable --now vouch-node

Config keys + the AWS-deferred design: deploy/DEPLOY.md
EOF
