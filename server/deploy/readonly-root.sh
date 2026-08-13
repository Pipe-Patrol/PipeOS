#!/usr/bin/env bash
#
# Make the Pi survive having its power cut. Run this ON THE PI.
#
#   sudo ~/PipeOS/server/deploy/readonly-root.sh status
#   sudo ~/PipeOS/server/deploy/readonly-root.sh enable --data-device /dev/sda1
#   sudo ~/PipeOS/server/deploy/readonly-root.sh disable
#
# THE PROBLEM
# An SD card corrupts when power is removed mid-write. That is why yanking the
# plug means reflashing. Consumer hardware does not have this problem because
# its root filesystem is read-only, so there is never a write in flight to
# interrupt. This sets the Pi up the same way: root mounts read-only, writes go
# to an overlay in RAM and are discarded at reboot, and pulling the plug is a
# supported way to turn the robot off.
#
# WHAT ABOUT THE RUNS
# Discarded-at-reboot is wrong for recordings, so they do not live on the
# overlay. `enable` wants a device to keep them on -- a USB stick is the usual
# answer -- which it mounts at /var/lib/pipepatrol and points the server at
# through PIPEPATROL_DATA. Without one, runs are RAM-only and vanish on power
# off, which this refuses to do silently; pass --ephemeral-data if that is
# genuinely what you want.
#
# DEPLOYING
# A read-only root cannot be rsynced to. Run `disable`, reboot, deploy, then
# `enable` and reboot again. deploy.sh checks for this and says so rather than
# appearing to succeed and losing the copy at the next reboot.

set -euo pipefail

DATA_MOUNT=/var/lib/pipepatrol
OVERRIDE_DIR=/etc/systemd/system/pipepatrol.service.d
OVERRIDE=$OVERRIDE_DIR/10-data-dir.conf

usage() { awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; }

# Before the raspi-config check, so the instructions are readable from a laptop
# -- which is where you are when you are working out what to run on the Pi.
case "${1:-}" in -h|--help) usage; exit 0 ;; esac

command -v raspi-config >/dev/null 2>&1 || {
  echo "raspi-config not found. Is this actually a Raspberry Pi OS image?" >&2
  exit 1
}

# raspi-config's own query. 0 means the overlay is on.
overlay_on() { raspi-config nonint get_overlay_now; }

# Whether root is read-only RIGHT NOW, which is not the same question: the
# overlay only takes effect at boot, so both states disagree until a reboot.
root_is_ro() { findmnt -no OPTIONS / | grep -qw ro; }

show_status() {
  if overlay_on; then
    echo "overlay filesystem: ENABLED at next boot"
  else
    echo "overlay filesystem: disabled"
  fi
  echo "root right now:     $(findmnt -no FSTYPE,OPTIONS / | cut -c1-60)"
  if root_is_ro; then
    echo "                    read-only -- safe to pull the plug"
  else
    echo "                    WRITABLE -- an unclean power off can corrupt the card"
  fi

  echo -n "runs directory:     "
  if [ -f "$OVERRIDE" ]; then
    sed -n 's/^Environment=PIPEPATROL_DATA=//p' "$OVERRIDE" | tr -d '\n'
    if mountpoint -q "$DATA_MOUNT"; then echo "  (mounted, persistent)"; else echo "  (NOT MOUNTED)"; fi
  else
    echo "default, on the root filesystem"
  fi
}

require_root() {
  [ "$(id -u)" -eq 0 ] || { echo "Needs root. Try: sudo $0 $*" >&2; exit 1; }
}

setup_data_device() {
  local device="$1"
  [ -b "$device" ] || { echo "$device is not a block device." >&2; exit 1; }

  local uuid fstype
  uuid="$(blkid -s UUID -o value "$device")"
  fstype="$(blkid -s TYPE -o value "$device")"
  if [ -z "$uuid" ] || [ -z "$fstype" ]; then
    echo "$device has no filesystem on it. Format it first, e.g.:" >&2
    echo "    sudo mkfs.ext4 -L pipepatrol $device" >&2
    exit 1
  fi
  # ext4 keeps ownership and survives an unclean unmount by journal replay.
  # vfat does neither, and a run directory the server cannot chown is a run
  # directory it cannot write to.
  if [ "$fstype" != "ext4" ]; then
    echo "$device is $fstype. Use ext4 -- it journals, and it keeps file ownership:" >&2
    echo "    sudo mkfs.ext4 -L pipepatrol $device" >&2
    exit 1
  fi

  mkdir -p "$DATA_MOUNT"

  # nofail so a missing stick is a robot with no recordings, not a robot that
  # drops to an emergency shell in a pipe. sync because the whole point of this
  # exercise is that power can vanish at any moment.
  if ! grep -q "^UUID=$uuid " /etc/fstab; then
    cp -n /etc/fstab /etc/fstab.pipepatrol.bak || true
    printf 'UUID=%s %s ext4 defaults,sync,nofail,x-systemd.device-timeout=10 0 2\n' \
      "$uuid" "$DATA_MOUNT" >> /etc/fstab
    echo "Added $device to /etc/fstab (previous copy at /etc/fstab.pipepatrol.bak)"
  fi

  systemctl daemon-reload
  mountpoint -q "$DATA_MOUNT" || mount "$DATA_MOUNT"

  local owner="${SUDO_USER:-pipepatrol}"
  install -d -o "$owner" -g "$owner" "$DATA_MOUNT/data"
  write_override "$DATA_MOUNT/data"
  echo "Runs will be written to $DATA_MOUNT/data on $device."
}

write_override() {
  mkdir -p "$OVERRIDE_DIR"
  cat > "$OVERRIDE" <<EOF
# Written by readonly-root.sh. The runs directory has to sit off the overlay,
# or every recording is discarded at the next reboot.
[Service]
Environment=PIPEPATROL_DATA=$1
EOF
  systemctl daemon-reload
}

case "${1:-status}" in
  status)
    show_status
    ;;

  enable)
    shift
    require_root enable "$@"
    device=""
    ephemeral=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --data-device) device="${2:-}"; shift 2 ;;
        --ephemeral-data) ephemeral=1; shift ;;
        *) echo "unknown option: $1" >&2; exit 1 ;;
      esac
    done

    if [ -n "$device" ]; then
      setup_data_device "$device"
    elif [ "$ephemeral" -eq 1 ]; then
      echo "WARNING: no data device. Every run and recording will be lost at reboot."
    else
      echo "Refusing to enable without somewhere to keep the runs." >&2
      echo >&2
      echo "With a USB stick fitted (this ERASES it):" >&2
      echo "    lsblk                                  # find it, e.g. sda1" >&2
      echo "    sudo mkfs.ext4 -L pipepatrol /dev/sda1" >&2
      echo "    sudo $0 enable --data-device /dev/sda1" >&2
      echo >&2
      echo "Or accept that runs do not survive a reboot:" >&2
      echo "    sudo $0 enable --ephemeral-data" >&2
      exit 1
    fi

    raspi-config nonint enable_overlayfs
    # The boot partition separately: it is written far less often, but it is
    # still an unclean-power-off away from a Pi that will not start at all.
    raspi-config nonint enable_bootro || \
      echo "note: could not set /boot read-only; the overlay is still on."

    echo
    echo "Enabled. It takes effect at the next boot:"
    echo "    sudo reboot"
    echo
    echo "After that the card is protected and the power switch is the off switch."
    echo "To deploy again:  sudo $0 disable && sudo reboot"
    ;;

  disable)
    require_root disable
    raspi-config nonint disable_bootro || true
    raspi-config nonint disable_overlayfs
    echo "Disabled. Reboot to get a writable root back:"
    echo "    sudo reboot"
    echo
    echo "The card is unprotected until you re-enable it. Deploy, then:"
    echo "    sudo $0 enable --data-device /dev/sda1 && sudo reboot"
    ;;

  -h|--help)
    usage
    ;;

  *)
    echo "unknown command: $1" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
