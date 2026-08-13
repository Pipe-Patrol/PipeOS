#!/usr/bin/env bash
# Start everything. One command, one address: http://localhost:5173
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ ! -x "$HERE/server/.venv/bin/python" ]; then
  echo "No server/.venv — run:  cd server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi

# From server/, not from here: the package lives at server/pipepatrol and is not
# installed into the venv, so -m only resolves with that directory as the cwd.
# Started from the repo root it fails with "No module named pipepatrol" while
# vite comes up fine, which looks like a console bug rather than a dead API.
(cd "$HERE/server" && exec "$HERE/server/.venv/bin/python" -m pipepatrol) &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

cd "$HERE/web"
[ -d node_modules ] || npm ci
npm run dev
