#!/usr/bin/env bash
#
# Make the robot host its own network, so using it is: power on, join the WiFi,
# open the page. Run this ON THE PI.
#
#   sudo ~/PipeOS/server/deploy/hotspot.sh status
#   sudo ~/PipeOS/server/deploy/hotspot.sh enable
#   sudo ~/PipeOS/server/deploy/hotspot.sh enable --ssid PipePatrol --password <8+ chars>
#   sudo ~/PipeOS/server/deploy/hotspot.sh enable --no-portal
#   sudo ~/PipeOS/server/deploy/hotspot.sh disable
#
# WHY
# Joining the robot to a network is the step that keeps failing: the Pi has to
# find the network, the network has to hand it an address, and you have to
# discover what that address turned out to be. At a demo, on someone else's
# WiFi, at least one of those goes wrong. A GoPro does not have this problem
# because the camera is the access point.
#
# WHAT YOU GET
# An always-on access point that comes up at boot, with the console at a fixed
# address that never changes:
#
#     http://192.168.4.1
#
# Joining is usually all it takes -- the console opens by itself. Every name
# resolves to the robot on this network and the console answers on port 80, so
# a phone or laptop making its usual "am I online?" check reaches the console,
# concludes it is behind a captive portal, and opens it. The address above is
# the fallback for anything that does not, and :8000 still works throughout.
#
# The cost of that is real and worth knowing: while joined to the robot, name
# resolution goes to the robot, and the client will report no internet. It has
# none -- see ONE RADIO below -- so this mostly makes an existing fact visible.
# `--no-portal` sets the hotspot up without it.
#
# DEPLOYING STILL WORKS
# Join the robot's network from your laptop and deploy over it:
#
#     ./deploy.sh pipepatrol@192.168.4.1
#
# ONE RADIO
# The Pi's built-in WiFi cannot host a network and be a client on another one
# at the same time. While the hotspot is on, the Pi has no internet -- fine for
# driving, not for `apt install`. Use `disable`, or plug in Ethernet, for that.

set -euo pipefail

CONNECTION=pipepatrol-ap
IFACE=wlan0
ADDRESS=192.168.4.1
SSID_DEFAULT=PipePatrol
PASSWORD_DEFAULT=pipepatrol

usage() { awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; }

# Before the nmcli check, so the instructions are readable from a laptop.
case "${1:-}" in -h|--help) usage; exit 0 ;; esac

command -v nmcli >/dev/null 2>&1 || {
  echo "nmcli not found. This needs NetworkManager, i.e. Pi OS Bookworm or newer." >&2
  exit 1
} >&2

require_root() {
  [ "$(id -u)" -eq 0 ] || { echo "Needs root. Try: sudo $0 $*" >&2; exit 1; }
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DNSMASQ_CONF=/etc/NetworkManager/dnsmasq-shared.d/pipepatrol.conf
PORTAL_UNIT=pipepatrol-portal.service

# Point every name at the robot, and put the console on port 80. Together these
# are what makes joining the network enough on its own; see the header.
enable_portal() {
  # NetworkManager runs its own dnsmasq for a `shared` connection and reads this
  # directory into it. Editing dnsmasq's main config instead would be ignored,
  # because that is a different dnsmasq that is not running.
  mkdir -p "$(dirname "$DNSMASQ_CONF")"
  cat > "$DNSMASQ_CONF" <<EOF
# Written by hotspot.sh. Every name resolves to the robot, so a client's
# connectivity check lands on the console and the console opens by itself.
address=/#/$ADDRESS
EOF

  sed "s|/home/pipepatrol/PipeOS|$(dirname "$(dirname "$HERE")")|g" \
    "$HERE/$PORTAL_UNIT" > "/etc/systemd/system/$PORTAL_UNIT"
  chmod 644 "/etc/systemd/system/$PORTAL_UNIT"
  systemctl daemon-reload
  systemctl enable --now "$PORTAL_UNIT"
}

disable_portal() {
  rm -f "$DNSMASQ_CONF"
  systemctl disable --now "$PORTAL_UNIT" 2>/dev/null || true
  rm -f "/etc/systemd/system/$PORTAL_UNIT"
  systemctl daemon-reload
}

case "${1:-status}" in
  status)
    if nmcli -t -f NAME con show | grep -qx "$CONNECTION"; then
      echo "hotspot profile: installed"
      nmcli -t -f connection.autoconnect,802-11-wireless.ssid,ipv4.addresses \
        con show "$CONNECTION" | sed 's/^/    /'
    else
      echo "hotspot profile: not installed"
    fi
    echo -n "active on $IFACE: "
    nmcli -t -f GENERAL.CONNECTION dev show "$IFACE" 2>/dev/null | cut -d: -f2- || echo "unknown"
    echo -n "console on port 80: "
    if [ -f "$DNSMASQ_CONF" ] && systemctl is-enabled --quiet "$PORTAL_UNIT" 2>/dev/null; then
      echo "yes -- joining opens it"
    else
      echo "no -- console is at :8000"
    fi
    ;;

  enable)
    shift
    require_root enable "$@"
    ssid="$SSID_DEFAULT"
    password="$PASSWORD_DEFAULT"
    portal=1
    while [ $# -gt 0 ]; do
      case "$1" in
        --ssid) ssid="${2:-}"; shift 2 ;;
        --password) password="${2:-}"; shift 2 ;;
        --no-portal) portal=0; shift ;;
        *) echo "unknown option: $1" >&2; exit 1 ;;
      esac
    done

    # WPA2 will accept the profile and then silently refuse to let anything
    # associate. Better to fail here than at the demo.
    if [ "${#password}" -lt 8 ]; then
      echo "The password must be at least 8 characters (WPA2 requires it)." >&2
      exit 1
    fi

    nmcli con delete "$CONNECTION" >/dev/null 2>&1 || true
    nmcli con add type wifi ifname "$IFACE" con-name "$CONNECTION" ssid "$ssid" >/dev/null

    # `shared` is what makes NetworkManager run the DHCP server and hand the
    # laptop an address. Without it the AP appears in the WiFi list, accepts the
    # password, and gives out nothing -- which looks exactly like a broken robot.
    nmcli con modify "$CONNECTION" \
      802-11-wireless.mode ap \
      802-11-wireless.band bg \
      ipv4.method shared \
      ipv4.addresses "$ADDRESS/24" \
      wifi-sec.key-mgmt wpa-psk \
      wifi-sec.psk "$password" \
      connection.autoconnect yes \
      connection.autoconnect-priority 100

    # The portal before the connection comes up: dnsmasq is started as part of
    # bringing a shared connection up and reads its config once, so writing the
    # file afterwards would not take effect until something restarted it.
    if [ "$portal" -eq 1 ]; then
      enable_portal
    else
      disable_portal
    fi

    nmcli con up "$CONNECTION" >/dev/null
    echo "Hotspot is up and will come back on its own at every boot."
    echo
    echo "    network:  $ssid"
    echo "    password: $password"
    if [ "$portal" -eq 1 ]; then
      echo "    console:  opens on joining, or http://$ADDRESS"
    else
      echo "    console:  http://$ADDRESS:8000"
    fi
    echo
    echo "Deploy over it with:  ./deploy.sh pipepatrol@$ADDRESS"
    ;;

  disable)
    require_root disable
    nmcli con down "$CONNECTION" >/dev/null 2>&1 || true
    nmcli con delete "$CONNECTION" >/dev/null 2>&1 || true
    # The wildcard DNS goes too. Left behind on a Pi that has rejoined a real
    # network it would be inert -- it only applies to a shared connection -- but
    # "inert" is a thing to have to work out at 2am.
    disable_portal
    echo "Hotspot removed. The Pi will rejoin whatever WiFi it knows about."
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
