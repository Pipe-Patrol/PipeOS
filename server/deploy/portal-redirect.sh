#!/usr/bin/env bash
#
# Put the console on port 80 of the robot's own network. Run by
# pipepatrol-portal.service at boot; not usually run by hand.
#
#   sudo portal-redirect.sh up
#   sudo portal-redirect.sh down
#
# WHY
# The console listens on 8000, and a port number in a URL is the difference
# between a product and a prototype. Rather than run the server as root so it
# can bind 80, the kernel rewrites the destination on the way in: anything
# arriving at port 80 on the robot's own WiFi goes to 8000 instead.
#
# Paired with the wildcard DNS that hotspot.sh installs, this is also what makes
# a phone or laptop open the console by itself on joining. Both check a known
# URL for a 204 when they associate; here that name resolves to the robot and
# the request is answered by the console, so the OS decides it is behind a
# captive portal and pops it up. Which is exactly the behaviour wanted, arrived
# at from the other direction.
#
# Its own table, so `down` can delete the whole thing without touching whatever
# else may be using nftables.

set -euo pipefail

TABLE=pipepatrol
IFACE=wlan0
FROM_PORT=80
TO_PORT=8000

usage() { awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; }

case "${1:-}" in -h|--help) usage; exit 0 ;; esac

command -v nft >/dev/null 2>&1 || {
  echo "nft not found. Install nftables, or the console stays on :$TO_PORT." >&2
  exit 1
}

case "${1:-up}" in
  up)
    # Idempotent: delete first, so a restart does not stack a second identical
    # rule on top of the first. `|| true` because the first ever run has no
    # table to delete and nft calls that an error.
    nft delete table ip "$TABLE" 2>/dev/null || true
    nft add table ip "$TABLE"
    # dstnat priority, which is where a redirect has to sit to beat routing.
    nft add chain ip "$TABLE" prerouting '{ type nat hook prerouting priority dstnat ; policy accept ; }'
    nft add rule ip "$TABLE" prerouting iifname "$IFACE" tcp dport "$FROM_PORT" redirect to :"$TO_PORT"
    echo "Console is on http://192.168.4.1 (port $FROM_PORT -> $TO_PORT on $IFACE)."
    ;;

  down)
    nft delete table ip "$TABLE" 2>/dev/null || true
    echo "Redirect removed. The console is on :$TO_PORT only."
    ;;

  status)
    nft list table ip "$TABLE" 2>/dev/null || echo "no redirect installed"
    ;;

  *)
    echo "unknown command: $1" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
