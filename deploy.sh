#!/usr/bin/env bash
#
# Deploy PipeOS to the Raspberry Pi.
#
#   ./deploy.sh                        # pipepatrol@pipepatrol.local
#   ./deploy.sh pipepatrol@10.83.0.112 # by IP, when the name will not resolve
#   ./deploy.sh --no-service           # copy and install, but do not touch systemd
#   ./deploy.sh --appliance            # deploy, then turn it into an appliance
#   ./deploy.sh --stay-unlocked        # leave the card writable afterwards
#
# What it does, in order: checks it can reach the robot, builds the console
# here, copies the repo over, builds the Python environment there, then
# installs and restarts the service.
#
# THE CARD LOCK IS HANDLED FOR YOU. A robot set up as an appliance has a
# read-only root, which cannot be rsynced to. This script unlocks it, reboots,
# deploys, locks it again and reboots back -- so a deploy is still one command
# and the robot is still an appliance at the end of it. --stay-unlocked skips
# the relock, for when you are about to deploy again in a minute.
#
# IT REPLACES THE EXISTING pipepatrol.service. If that unit currently points at
# PipePatrolTesting, this is the step that switches the robot over. The old
# checkout is left on disk untouched, so pointing the unit back is a one-line
# edit if you need to.

set -euo pipefail

TARGET="pipepatrol@pipepatrol.local"
INSTALL_SERVICE=1
MAKE_APPLIANCE=0
RELOCK=1

for arg in "$@"; do
  case "$arg" in
    --no-service) INSTALL_SERVICE=0 ;;
    --appliance) MAKE_APPLIANCE=1 ;;
    --stay-unlocked) RELOCK=0 ;;
    # Print the header block: every comment line after the shebang, stopping at
    # the first line that is not one. A fixed line range drifts as this file
    # gets edited, and a help text that has drifted is worse than none.
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"
      exit 0
      ;;
    -*) echo "unknown option: $arg" >&2; exit 1 ;;
    *) TARGET="$arg" ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_DIR="PipeOS"
HOST="${TARGET#*@}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# This machine's address as the robot would see it -- it is where the defect
# model now runs, so the robot has to be told how to reach it.
#
# Asks the routing table which interface a packet to the Pi would leave by, then
# that interface's address. `route get` wants an IP, and the Pi is usually named
# via mDNS, so the name is resolved first. Falls back to the default route when
# the host cannot be resolved yet, which is the common case on a fresh network.
lan_address_towards() {
  local host="$1" resolved iface

  resolved="$(ping -c1 -t1 "$host" 2>/dev/null | sed -n '1s/.*(\([0-9.]*\)).*/\1/p')"
  [ -z "$resolved" ] && resolved="$host"

  if command -v ipconfig >/dev/null 2>&1; then   # macOS
    iface="$(route -n get "$resolved" 2>/dev/null | awk '/interface:/{print $2}')"
    [ -z "$iface" ] && iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
    [ -n "$iface" ] && ipconfig getifaddr "$iface" 2>/dev/null && return 0
  elif command -v ip >/dev/null 2>&1; then       # Linux, for anyone deploying from one
    ip -4 route get "$resolved" 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1
    return 0
  fi
  return 1
}

# Block until the robot answers ssh again, or give up. Used either side of the
# reboots this script now does on your behalf.
#
# The first few seconds after `reboot` are the trap: sshd is still up on the way
# down, so a probe that starts immediately can succeed against a Pi that is
# about to vanish and then report success. Hence the initial pause -- long
# enough for the socket to actually go away before anything believes an answer.
wait_for_ssh() {
  local deadline=$((SECONDS + ${2:-150}))
  printf '    waiting for %s' "$HOST"
  sleep 12
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ssh -o BatchMode=yes -o ConnectTimeout=5 \
           -o StrictHostKeyChecking=accept-new "$TARGET" true 2>/dev/null; then
      printf ' back.\n'
      return 0
    fi
    printf '.'
    sleep 5
  done
  printf '\n'
  echo "$HOST did not come back within ${2:-150}s." >&2
  return 1
}

# Reboot the robot and wait for it. `reboot` kills the connection it was issued
# over, so ssh exits non-zero on success -- which is why the result is ignored.
reboot_and_wait() {
  ssh -t "$TARGET" 'sudo systemctl reboot' >/dev/null 2>&1 || true
  wait_for_ssh
}

root_is_readonly() {
  ssh -o BatchMode=yes "$TARGET" 'findmnt -no OPTIONS / | grep -qw ro' 2>/dev/null
}

# --- 1. can we reach the robot? -----------------------------------------------
# First, before the build, because every step below assumes ssh works and none
# of them say so when it doesn't: rsync reports an unreachable host as
# "unexpected end of file", which reads like a corrupt transfer rather than a
# robot that is switched off or on another network.
#
# BatchMode stops the probe prompting for anything. A password-only Pi still
# gets as far as being asked, and being asked means the host answered — so an
# auth failure counts as reachable, and the real steps prompt as they always did.

step "Checking the robot is reachable"
probe_status=0
probe="$(ssh -o BatchMode=yes -o ConnectTimeout=8 "$TARGET" true 2>&1)" || probe_status=$?

if [ "$probe_status" -eq 0 ]; then
  echo "$HOST answered."
elif grep -qE 'Permission denied|Too many authentication failures' <<<"$probe"; then
  echo "$HOST answered, and will ask you to authenticate."
else
  echo
  echo "Cannot reach $HOST over ssh."
  echo "Nothing was copied, and the robot was not touched. ssh said:"
  echo
  sed 's/^/    /' <<<"$probe"
  echo
  if grep -q 'Host key verification failed' <<<"$probe"; then
    cat <<EOF
That is an unknown or changed host key, not a network problem. Connect once by
hand, check the fingerprint is the robot's, and accept it:

    ssh $TARGET
EOF
  else
    cat <<EOF
Worth checking:

    Is the Pi powered on and finished booting?  give it a minute after plugging in
    Are you both on the same network?
    Does the name resolve?                      ping $HOST
    Name won't resolve? deploy by IP:           ./deploy.sh pipepatrol@10.83.0.112
EOF
  fi
  exit 1
fi

# --- 1b. unlock the card, if it is locked -------------------------------------
# Before the build, for the same reason the reachability probe is: a read-only
# root takes rsync's copy into a RAM overlay, where every step below succeeds,
# the console looks updated, and the next reboot silently throws the whole
# deploy away.
#
# This used to refuse and print the four commands to run by hand. It does them
# instead. The refusal was correct and it was still the wrong behaviour: it made
# every deploy to a finished robot a manual unlock/reboot/deploy/relock/reboot
# cycle, which is exactly the kind of ritual the appliance work exists to
# delete. WAS_LOCKED is what step 7 uses to put it back the way it found it.

step "Checking the robot's filesystem is writable"
WAS_LOCKED=0
if root_is_readonly; then
  WAS_LOCKED=1
  echo "Read-only (the card is locked). Unlocking and rebooting -- about a minute."
  ssh -t "$TARGET" 'sudo ~/PipeOS/server/deploy/readonly-root.sh disable'
  reboot_and_wait

  # The overlay only lifts at boot, so this is the check that it actually did.
  # A Pi that came back still read-only means the reboot did not take, and every
  # step below would land in RAM.
  if root_is_readonly; then
    echo "Still read-only after the reboot. Nothing was copied." >&2
    echo "Check by hand: ssh $TARGET 'sudo ~/PipeOS/server/deploy/readonly-root.sh status'" >&2
    exit 1
  fi
  echo "Writable."
else
  echo "Writable."
fi

# --- 2. the console, built here ------------------------------------------------
# Built on this machine rather than on the Pi: a Pi 5 can run npm, but it takes
# minutes and needs a toolchain the robot has no other use for.

step "Building the console"
cd "$HERE/web"
[ -d node_modules ] || npm ci
npm run build

# --- 3. copy ------------------------------------------------------------------
# .venv is excluded deliberately: it contains absolute paths and links against
# the host's Python, so a copied one is broken on arrival.

# THE MODEL DOES NOT GO TO THE ROBOT. Not the graph, not onnxruntime, not the
# inference thread. RF-DETR on a Pi 5 is seconds per frame with the cores pinned
# and the board running hot enough to matter over a long inspection, for a graph
# and a runtime that between them cost most of a gigabyte of SD card.
#
# It runs on this machine instead, served by server/detect-host.py, and the
# robot posts frames to it. server/model is excluded unconditionally below --
# nothing decides whether to copy it, because the answer is never.
#
# What the robot needs is the address to post to. A DHCP lease is a guess, so
# this is a starting value the operator can correct from the settings screen
# without a redeploy; see config.detector_url().
DETECT_URL="${PIPEPATROL_DETECTOR_URL:-}"
if [ -z "$DETECT_URL" ]; then
  # The address on the interface that would actually carry a packet to the Pi,
  # rather than the first one ifconfig happens to list. On a laptop with Docker,
  # a VPN, or a phone tethered, those are different answers and only one of them
  # is reachable from the robot.
  LAN_IP="$(lan_address_towards "$HOST" || true)"
  [ -n "$LAN_IP" ] && DETECT_URL="http://$LAN_IP:8600"
fi

if [ -n "$DETECT_URL" ]; then
  echo "defect model: served from this machine at $DETECT_URL"
  echo "  Start it before driving:  cd server && .venv/bin/python detect-host.py"
else
  echo "defect model: NO HOST ADDRESS — could not work out this machine's LAN address."
  echo "  The robot will drive and record normally; nothing will be detected."
  echo "  Set one by hand:  PIPEPATROL_DETECTOR_URL=http://<your-ip>:8600 ./deploy.sh $TARGET"
fi

# Demo day, if it is still installed. Listed conditionally so that deleting the
# folder is genuinely all it takes to ship without it -- an unconditional entry
# here would make rsync fail on a repo that no longer has it. See demoday/README.
EXTRA=()
if [ -d "$HERE/demoday" ]; then
  EXTRA+=(demoday)
  echo "demo day tooling: present — will be copied"
fi

step "Copying to $TARGET"
cd "$HERE"
rsync -az --delete \
  --exclude '.git' \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude 'node_modules' \
  --exclude 'server/data' \
  --exclude 'server/model' \
  --exclude 'web/src' \
  --exclude 'web/node_modules' \
  README.md docs server web deploy.sh "${EXTRA[@]}" \
  "$TARGET:$REMOTE_DIR/"

# --- 4. python environment ----------------------------------------------------
# --system-site-packages is required, not a preference: picamera2, gpiozero and
# lgpio come from apt and are invisible to an isolated venv.

step "Building the Python environment on the Pi"
ssh "$TARGET" DETECT_URL="$DETECT_URL" bash -se <<'REMOTE'
set -euo pipefail
cd ~/PipeOS/server

if [ ! -d .venv ]; then
  python3 -m venv --system-site-packages .venv
fi
.venv/bin/pip install --quiet --upgrade pip
# requirements-pi.txt pulls in requirements.txt, and adds the GPIO and IMU
# drivers that only build on a Pi. A laptop installs requirements.txt alone.
.venv/bin/pip install --quiet -r requirements-pi.txt

# --- get the model off this Pi, and keep it off ---
#
# Excluding server/model from the rsync above is not enough, twice over.
#
# rsync --delete does NOT delete excluded paths on the receiver -- that is the
# point of an exclude, it means "this path is none of my business" rather than
# "this path should not exist". So a robot deployed to before the model moved to
# the laptop keeps its 121 MB graph on the SD card indefinitely, and the same
# goes for onnxruntime in the venv: dropping a line from requirements.txt never
# uninstalls anything.
#
# Both are removed explicitly, every deploy. This is the step that makes the
# claim "the model does not run on the robot" true on hardware rather than only
# in the source, and running it unconditionally means it also fixes a Pi that
# was deployed to by an older checkout.
if [ -d model ]; then
  echo "removing the on-board model: $(du -sh model | cut -f1) — inference is on the laptop now"
  rm -rf model
fi
if .venv/bin/pip show onnxruntime >/dev/null 2>&1; then
  echo "removing onnxruntime from the robot's venv"
  .venv/bin/pip uninstall --quiet --yes onnxruntime
fi

echo "checking the safety limits before anything can drive:"
.venv/bin/python -m pytest tests/test_drive_safety.py -q

echo "checking the defect model:"
DETECT_URL="${DETECT_URL:-}" .venv/bin/python - <<'CHECK'
import json
import os
import urllib.error
import urllib.request

from pipepatrol.perception.remote import normalise_url

url = normalise_url(os.environ.get("DETECT_URL", ""))
if not url:
    print("  NO HOST — the robot will drive and record normally; nothing will be detected.")
    raise SystemExit(0)

# From the Pi, not from the laptop, and that is the whole point of doing it
# here: the laptop can obviously reach itself. What matters is whether the
# robot can, and finding that out now beats finding it out mid-inspection.
try:
    with urllib.request.urlopen(f"{url}/api/health", timeout=5) as response:
        health = json.loads(response.read())
except (urllib.error.URLError, TimeoutError, OSError) as exc:
    print(f"  UNREACHABLE from the robot — {url}: {exc}")
    print("  Is detect-host.py running?  cd server && .venv/bin/python detect-host.py")
    print("  The robot will drive and record normally; nothing will be detected.")
    raise SystemExit(0)

if health.get("ok"):
    print(f"  ready — {url} serving {health.get('model', '?')} at {health.get('input_size')}px")
else:
    print(f"  HOST UP BUT NO MODEL — {health.get('error')}")
CHECK
REMOTE

# --- 5. the DHT overlay -------------------------------------------------------
# The temperature/humidity sensor is read by a kernel driver that a device tree
# overlay loads, and an overlay is only applied at boot. Doing it here rather
# than leaving it as a step in the README: the script that does the edit only
# arrives on the Pi as part of this deploy, so "run it on the Pi first" is an
# instruction that cannot be followed on a fresh SD card.
#
# Non-fatal on purpose. A robot with no DHT fitted should still deploy.

step "Checking the DHT overlay"
# `sudo bash <script>` rather than executing it: rsync carries the exec bit, but
# only if the checkout it came from still had it, and that is one chmod away
# from being someone else's problem at 2am.
ssh -t "$TARGET" 'sudo bash ~/PipeOS/server/deploy/enable-dht.sh' \
  || echo "Could not set the DHT overlay up. Climate will report absent; nothing else is affected."

# --- 6. service ---------------------------------------------------------------

if [ "$INSTALL_SERVICE" -eq 1 ]; then
  step "Installing and restarting the service"
  # -t and an inline command, NOT a heredoc: these steps need sudo, and sudo
  # cannot prompt for a password without a terminal. Piping the script over
  # stdin looks fine until the account lacks passwordless sudo, and then it
  # fails with nothing useful on screen.
  # The assignment is spliced in from here; the body stays single-quoted so that
  # $USER and $HOME are still the robot's, not this laptop's.
  ssh -t "$TARGET" "DETECT_URL='$DETECT_URL'"'
    set -euo pipefail
    # The shipped unit hardcodes /home/pipepatrol. Rewrite it for whichever
    # account this actually deployed to, so a differently-named user does not
    # get a unit pointing at a directory that is not theirs.
    #
    # The detector URL is rewritten the same way: the unit ships with it empty
    # and the deploy fills in the address of the machine serving the model.
    sed -e "s|^User=.*|User=$USER|" \
        -e "s|/home/pipepatrol/PipeOS|$HOME/PipeOS|g" \
        -e "s|^Environment=PIPEPATROL_DETECTOR_URL=.*|Environment=PIPEPATROL_DETECTOR_URL=$DETECT_URL|" \
        ~/PipeOS/server/deploy/pipepatrol.service > /tmp/pipepatrol.service
    sudo install -m 644 /tmp/pipepatrol.service /etc/systemd/system/pipepatrol.service
    rm -f /tmp/pipepatrol.service

    # The one privilege the server gets: halting the Pi, so the console can shut
    # it down properly instead of the operator flipping the switch and taking
    # the SD card with it. visudo -c first — a malformed sudoers file locks
    # every account on the Pi out of sudo, including the one fixing it.
    sed -e "s|^pipepatrol |$USER |" \
        ~/PipeOS/server/deploy/pipepatrol-poweroff.sudoers > /tmp/pipepatrol-poweroff
    if sudo visudo -c -f /tmp/pipepatrol-poweroff >/dev/null; then
      sudo install -m 440 -o root -g root \
        /tmp/pipepatrol-poweroff /etc/sudoers.d/pipepatrol-poweroff
    else
      echo "WARNING: the poweroff sudoers rule did not validate; not installing it."
      echo "         The shutdown button will report that it cannot halt the Pi."
    fi
    rm -f /tmp/pipepatrol-poweroff

    sudo systemctl daemon-reload
    sudo systemctl enable pipepatrol
    sudo systemctl restart pipepatrol
    sleep 2
    systemctl --no-pager --lines=0 status pipepatrol || true
  '
else
  step "Skipping systemd (--no-service)"
  echo "Start it by hand with:"
  echo "  ssh $TARGET 'cd PipeOS/server && .venv/bin/python -m pipepatrol'"
fi

# --- 7. appliance ------------------------------------------------------------
# The one-time conversion, driven from here rather than left as two scripts to
# run on the Pi over SSH. Both are idempotent, so running --appliance against a
# robot that is already one is a no-op that reports the state.

if [ "$MAKE_APPLIANCE" -eq 1 ]; then
  step "Turning the robot into an appliance"
  ssh -t "$TARGET" '
    set -euo pipefail
    sudo ~/PipeOS/server/deploy/hotspot.sh enable
    echo
    # Picks the data device itself when there is exactly one candidate. Asking
    # from here is not possible -- this is running down an ssh pipe -- and
    # guessing between two sticks is worse than saying so.
    sudo ~/PipeOS/server/deploy/readonly-root.sh enable --auto-data-device
  '
  WAS_LOCKED=1
fi

# --- 8. lock the card back ----------------------------------------------------
# Whatever state the card was in at step 1b, it is in again now. Without this,
# one deploy quietly demotes a finished robot back to a prototype that has to be
# shut down properly -- and nothing would say so until the card corrupted.

if [ "$WAS_LOCKED" -eq 1 ] && [ "$RELOCK" -eq 1 ]; then
  step "Locking the card and rebooting"
  ssh -t "$TARGET" 'sudo ~/PipeOS/server/deploy/readonly-root.sh relock'
  reboot_and_wait

  if root_is_readonly; then
    echo "Locked. The power switch is the off switch again."
  else
    echo "WARNING: the robot came back WRITABLE. Shut it down properly until this is"
    echo "         sorted: ssh $TARGET 'sudo poweroff'"
    echo "         Check with: readonly-root.sh status"
  fi
elif [ "$WAS_LOCKED" -eq 1 ]; then
  step "Leaving the card unlocked (--stay-unlocked)"
  echo "The robot needs a proper shutdown until it is locked again."
  echo "Lock it with:  ./deploy.sh $TARGET   (any deploy puts it back)"
fi

step "Done"
echo "Open the console at:  http://$HOST:8000"
echo "Logs:                 ssh $TARGET 'journalctl -u pipepatrol -f'"
