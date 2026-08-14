#!/usr/bin/env bash
#
# Keep the defect model running on this Mac, always. Run this ON YOUR LAPTOP.
#
#   server/deploy/detect-host-autostart.sh install
#   server/deploy/detect-host-autostart.sh uninstall
#   server/deploy/detect-host-autostart.sh status
#
# WHY
# The model runs here, not on the robot -- see MODEL.md. That means detection
# only works while `detect-host.py` is running, and a step you have to remember
# before every drive is a step that gets forgotten, with no symptom except that
# nothing is ever detected.
#
# This hands it to launchd instead: it starts at login, restarts if it dies, and
# is running before you have finished joining the robot's WiFi. Paired with the
# robot's own discovery (perception/discover.py), that is the whole of what used
# to be "start the host, find your IP, redeploy so the Pi knows it".
#
# It costs nothing while idle. It is a local HTTP server that does no work until
# the robot posts it a frame, and it listens on 8600 rather than 8000 so it
# never fights the dev server.

set -euo pipefail

LABEL=com.pipepatrol.detect-host
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$HERE")"
PYTHON="$SERVER_DIR/.venv/bin/python"
SCRIPT="$SERVER_DIR/detect-host.py"
LOG="$HOME/Library/Logs/pipepatrol-detect-host.log"

usage() { awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; }

case "${1:-}" in -h|--help) usage; exit 0 ;; esac

[ "$(uname)" = "Darwin" ] || {
  echo "This is the macOS version. On Linux, use a systemd --user unit." >&2
  exit 1
}

case "${1:-status}" in
  install)
    [ -x "$PYTHON" ] || {
      echo "No virtualenv at $PYTHON" >&2
      echo "Build it first:  cd $SERVER_DIR && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
      exit 1
    }
    [ -f "$SCRIPT" ] || { echo "No detect-host.py at $SCRIPT" >&2; exit 1; }

    mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"

    # RunAtLoad and KeepAlive together: start at login, and come back if it
    # crashes or is killed. Without KeepAlive a single bad frame that took the
    # process down would silently end detection until the next reboot.
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>$SCRIPT</string>
  </array>
  <key>WorkingDirectory</key><string>$SERVER_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

    # bootout first so `install` is repeatable: bootstrap on an already-loaded
    # label is an error, and "run it twice" should not be a failure mode.
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$UID" "$PLIST"

    echo "Installed. The defect model now runs whenever you are logged in."
    echo
    echo "    health:  curl -s localhost:8600/api/health"
    echo "    log:     $LOG"
    echo "    remove:  $0 uninstall"
    ;;

  uninstall)
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed. Detection now needs detect-host.py started by hand."
    ;;

  status)
    if launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then
      echo "autostart: installed"
    else
      echo "autostart: not installed"
    fi
    echo -n "model host: "
    if curl -fsS --max-time 2 localhost:8600/api/health 2>/dev/null; then
      echo
    else
      echo "not answering on :8600"
    fi
    ;;

  *)
    echo "unknown command: $1" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
