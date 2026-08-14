"""Find the machine serving the defect model, instead of being told its address.

THE PROBLEM THIS REMOVES

The detector's address used to be baked in at deploy time -- deploy.sh worked
out the laptop's address and wrote it into the service file. That is correct
exactly until the laptop is on a different network than it was during the
deploy, at which point the robot posts frames into the void and detection
silently does nothing. Nothing is broken, nothing logs an error the operator
sees, there are simply never any detections. It is the worst kind of failure.

That happens constantly in normal use: deploy over a phone hotspot, then drive
on the robot's own network, and the address is already wrong.

WHY THE ROBOT CAN JUST LOOK

Anything talking to the robot is in its ARP table, which is the kernel's record
of every neighbour it has exchanged a packet with. The laptop serving the model
is necessarily one of them -- it is running the console.

NOT THE DHCP LEASE FILE, which is the obvious answer and does not work. The
robot is the DHCP server on its own network, so NetworkManager's dnsmasq does
write every client to /var/lib/NetworkManager/dnsmasq-wlan0.leases. That
directory is mode 0700 root, and this server runs as `pipepatrol`. Reading it
fails, and it fails by returning nothing rather than by raising, so discovery
quietly found zero clients and every frame went to the stale address anyway --
the exact silent failure this module exists to prevent, reintroduced by the
module itself.

/proc/net/arp is world-readable and needs no privilege at all.

So: read the neighbours, ask each whether it is serving the model, use the one
that says yes. A laptop that joins later is found on the next sweep, and one
that changes address is followed without anyone redeploying.

This runs only when the configured address is not answering, so an explicitly
set detector -- the operator's, or a deploy's -- always wins. Discovery is the
fallback, not the policy.
"""

import json
import logging
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

log = logging.getLogger(__name__)

ARP_TABLE = Path("/proc/net/arp")

DETECT_PORT = 8600
PROBE_TIMEOUT_S = 1.5


def _neighbours():
    """Every machine this robot has exchanged a packet with.

    /proc/net/arp is a header line and then one neighbour per line:

        IP address     HW type  Flags  HW address         Mask  Device
        192.168.4.15   0x1      0x2    aa:bb:cc:dd:ee:ff  *     wlan0

    Flags 0x0 means an incomplete entry -- an address the kernel asked about
    and got no answer for. Those are skipped; they are by definition not
    serving anything.
    """
    try:
        lines = ARP_TABLE.read_text().splitlines()[1:]
    except OSError as exc:
        log.debug("cannot read %s: %s", ARP_TABLE, exc)
        return []

    addresses = []
    for line in lines:
        fields = line.split()
        if len(fields) >= 6 and fields[2] != "0x0" and fields[0].count(".") == 3:
            addresses.append(fields[0])
    return addresses


def _serves_model(url):
    """Is there a detector at this address, and does it actually have a model?

    A host that answers but reports no model is not a usable detector -- taking
    it would mean pointing the robot at something guaranteed to return nothing.
    """
    try:
        with urllib.request.urlopen(f"{url}/api/health", timeout=PROBE_TIMEOUT_S) as response:
            return bool(json.loads(response.read()).get("ok"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return False


def find_detector():
    """The address of a machine serving the model, or None.

    Probed in parallel: the neighbour list is short, but a phone that is
    attached and answering nothing costs the full timeout, and doing those in
    series is the difference between "instant" and "the console hangs at
    startup" on a network with a few devices on it.
    """
    addresses = _neighbours()
    if not addresses:
        return None

    urls = [f"http://{address}:{DETECT_PORT}" for address in addresses]
    with ThreadPoolExecutor(max_workers=min(8, len(urls))) as pool:
        for url, ok in zip(urls, pool.map(_serves_model, urls)):
            if ok:
                log.info("found the defect model on %s", url)
                return url

    log.debug("no detector among %d neighbours", len(addresses))
    return None
