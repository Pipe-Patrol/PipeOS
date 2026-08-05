#!/usr/bin/env bash
#
# Deploy PipeOS to the Raspberry Pi.
#
#   ./deploy.sh                        # pipepatrol@pipepatrol.local
#   ./deploy.sh pipepatrol@10.83.0.112 # by IP, when the name will not resolve
#   ./deploy.sh --no-service           # copy and install, but do not touch systemd
#
# What it does, in order: checks it can reach the robot, builds the console
# here, copies the repo over, builds the Python environment there, then
# installs and restarts the service.
#
# IT REPLACES THE EXISTING pipepatrol.service. If that unit currently points at
# PipePatrolTesting, this is the step that switches the robot over. The old
# checkout is left on disk untouched, so pointing the unit back is a one-line
# edit if you need to.

set -euo pipefail

TARGET="pipepatrol@pipepatrol.local"
INSTALL_SERVICE=1

for arg in "$@"; do
  case "$arg" in
    --no-service) INSTALL_SERVICE=0 ;;
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

step "Copying to $TARGET"
cd "$HERE"
rsync -az --delete \
  --exclude '.git' \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude 'node_modules' \
  --exclude 'server/data' \
  --exclude 'web/src' \
  --exclude 'web/node_modules' \
  README.md docs server web deploy.sh \
  "$TARGET:$REMOTE_DIR/"

# --- 4. python environment ----------------------------------------------------
# --system-site-packages is required, not a preference: picamera2, gpiozero and
# lgpio come from apt and are invisible to an isolated venv.

step "Building the Python environment on the Pi"
ssh "$TARGET" bash -se <<'REMOTE'
set -euo pipefail
cd ~/PipeOS/server

if [ ! -d .venv ]; then
  python3 -m venv --system-site-packages .venv
fi
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt

echo "checking the safety limits before anything can drive:"
.venv/bin/python -m pytest tests/test_drive_safety.py -q
REMOTE

# --- 5. service ---------------------------------------------------------------

if [ "$INSTALL_SERVICE" -eq 1 ]; then
  step "Installing and restarting the service"
  # -t and an inline command, NOT a heredoc: these steps need sudo, and sudo
  # cannot prompt for a password without a terminal. Piping the script over
  # stdin looks fine until the account lacks passwordless sudo, and then it
  # fails with nothing useful on screen.
  ssh -t "$TARGET" '
    set -euo pipefail
    # The shipped unit hardcodes /home/pipepatrol. Rewrite it for whichever
    # account this actually deployed to, so a differently-named user does not
    # get a unit pointing at a directory that is not theirs.
    sed -e "s|^User=.*|User=$USER|" \
        -e "s|/home/pipepatrol/PipeOS|$HOME/PipeOS|g" \
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

step "Done"
echo "Open the console at:  http://$HOST:8000"
echo "Logs:                 ssh $TARGET 'journalctl -u pipepatrol -f'"
