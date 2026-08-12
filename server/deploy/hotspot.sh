#!/usr/bin/env bash
#
# Make the robot host its own network, so using it is: power on, join the WiFi,
# open the page. Run this ON THE PI.
#
#   sudo ~/PipeOS/server/deploy/hotspot.sh status
#   sudo ~/PipeOS/server/deploy/hotspot.sh enable
#   sudo ~/PipeOS/server/deploy/hotspot.sh enable --ssid PipePatrol --password <8+ chars>
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
#     http://192.168.4.1:8000
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
    ;;

  enable)
    shift
    require_root enable "$@"
    ssid="$SSID_DEFAULT"
    password="$PASSWORD_DEFAULT"
    while [ $# -gt 0 ]; do
      case "$1" in
        --ssid) ssid="${2:-}"; shift 2 ;;
        --password) password="${2:-}"; shift 2 ;;
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

    nmcli con up "$CONNECTION" >/dev/null
    echo "Hotspot is up and will come back on its own at every boot."
    echo
    echo "    network:  $ssid"
    echo "    password: $password"
    echo "    console:  http://$ADDRESS:8000"
    echo
    echo "Deploy over it with:  ./deploy.sh pipepatrol@$ADDRESS"
    ;;

  disable)
    require_root disable
    nmcli con down "$CONNECTION" >/dev/null 2>&1 || true
    nmcli con delete "$CONNECTION" >/dev/null 2>&1 || true
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
