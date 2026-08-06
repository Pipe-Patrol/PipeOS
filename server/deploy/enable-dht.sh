#!/usr/bin/env bash
#
# Turn on the kernel driver for the DHT22 on GPIO14. Run this ON THE PI, once.
#
#   sudo ~/PipeOS/server/deploy/enable-dht.sh
#   sudo reboot
#
# The sensor is read by the kernel's dht11 IIO driver rather than from Python --
# see the comment at the top of pipepatrol/hardware/climate.py for why nothing
# else works on a Pi 5. That driver is not loaded by default; it is loaded by a
# device tree overlay, and a device tree overlay is only applied at boot. So
# this edits /boot/firmware/config.txt and then you reboot.
#
# Nothing here touches the sensor itself. If the reading is still absent after
# a reboot it is power or wiring, and `python -m pipepatrol.hardware.climate`
# will say which.

set -euo pipefail

# GPIO14 is where the DATA wire is fitted -- see docs/PINMAP.md.
GPIO="${1:-14}"
CONFIG=/boot/firmware/config.txt
LINE="dtoverlay=dht11,gpiopin=${GPIO}"

# Older images keep it at the pre-bookworm path.
[ -f "$CONFIG" ] || CONFIG=/boot/config.txt

if [ ! -f "$CONFIG" ]; then
  echo "Cannot find config.txt. Is this actually the Pi?" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Needs root to edit $CONFIG. Try: sudo $0 $GPIO" >&2
  exit 1
fi

if grep -qE "^\s*${LINE}\s*$" "$CONFIG"; then
  echo "Already enabled in $CONFIG:"
  grep -nE "^\s*${LINE}\s*$" "$CONFIG" | sed 's/^/    /'
elif grep -qE '^\s*dtoverlay=dht11' "$CONFIG"; then
  # An overlay line exists but names a different pin. Rewrite it rather than
  # reporting success: a wrong pin looks exactly like no sensor fitted, and
  # re-running this script was the obvious thing that used to not fix it.
  echo "Found a dht11 overlay on the wrong pin, correcting it:"
  grep -nE '^\s*dtoverlay=dht11' "$CONFIG" | sed 's/^/    was: /'
  cp -n "$CONFIG" "$CONFIG.pipepatrol.bak" || true
  sed -i -E "s|^\s*dtoverlay=dht11.*|${LINE}|" "$CONFIG"
  grep -nE '^\s*dtoverlay=dht11' "$CONFIG" | sed 's/^/    now: /'
  echo "(previous copy kept at $CONFIG.pipepatrol.bak)"
else
  # Keep a copy. This file is the one that decides whether the Pi boots at all.
  cp -n "$CONFIG" "$CONFIG.pipepatrol.bak" || true
  printf '\n# PipePatrol: DHT22 air temperature/humidity on GPIO%s\n%s\n' \
    "$GPIO" "$LINE" >> "$CONFIG"
  echo "Added to $CONFIG:"
  echo "    $LINE"
  echo "(previous copy kept at $CONFIG.pipepatrol.bak)"
fi

echo
if [ -d /sys/bus/iio/devices ] && \
   grep -rqiE '^(dht11|dht22|am2302)' /sys/bus/iio/devices/iio:device*/name 2>/dev/null; then
  echo "The driver is already loaded -- no reboot needed. Check it reads:"
  echo "    cd ~/PipeOS/server && .venv/bin/python -m pipepatrol.hardware.climate"
else
  echo "Now reboot, then check it reads:"
  echo "    sudo reboot"
  echo "    cd ~/PipeOS/server && .venv/bin/python -m pipepatrol.hardware.climate"
fi
