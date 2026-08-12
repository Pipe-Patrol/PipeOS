#!/usr/bin/env bash
# Start everything. One command, one address: http://localhost:5173
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ ! -x "$HERE/server/.venv/bin/python" ]; then
  echo "No server/.venv — run:  cd server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi

"$HERE/server/.venv/bin/python" -m pipepatrol &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

cd "$HERE/web"
[ -d node_modules ] || npm ci
npm run dev
