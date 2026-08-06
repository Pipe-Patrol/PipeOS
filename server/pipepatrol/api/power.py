"""Powering the robot down without hurting the card.

The failure this exists to prevent: the operator flips the switch, the kernel
still holds dirty pages for run.json, a handful of JPEGs and the filesystem's
own journal, and the SD card comes back corrupt.

runs/store.py already writes run.json through a temp file and fsync, but that
protects exactly one file. The snapshot JPEGs are a plain `write_bytes`, the
recording is streamed, and the journal is the kernel's business — none of them
are on the card when the switch opens.

So the order below is fixed, and every step earns its place:

    1. stop the motors    nothing moves once the operator has walked away
    2. close the robot     ends the active run, flushes the path, frees hardware
    3. os.sync()           forces every dirty page out to the card
    4. poweroff            systemd unmounts cleanly on top of all of that

Step 2 has a second effect worth knowing: a run ended this way is a *finished*
run, not an interrupted one. Cutting power mid-run has always left the run
marked interrupted, because nothing was there to close it.

Privileges are probed BEFORE any of it runs. A shutdown that tore the robot down
and then could not power off would leave a live Pi with dead hardware and an
operator who has just been told it is safe to flip the switch — which is the
precise corruption this endpoint exists to prevent.
"""

import asyncio
import logging
import os
import shutil
import subprocess

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from pipepatrol.api.deps import get_robot

log = logging.getLogger(__name__)

router = APIRouter()

# Long enough for the JSON response to reach a browser on the same LAN, short
# enough that nobody watching the robot thinks the button did nothing.
POWEROFF_DELAY_S = 1.5

# A probe must never actually halt the machine, so each candidate is paired with
# the read-only question that decides whether it would work.
_PROBE_TIMEOUT_S = 5


def _succeeds(command):
    """True when `command` exits 0. Used only for probes, never for the halt."""
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=_PROBE_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def poweroff_command():
    """The halt command this account can actually run, or None.

    Two paths, because two very different Pis run this. A stock Raspberry Pi OS
    account has blanket passwordless sudo; a hardened one has only the narrow
    rule deploy.sh installs. `sudo -n -l <cmd>` answers for both without asking
    for a password and without running anything.
    """
    target = shutil.which("poweroff") or "/sbin/poweroff"

    if shutil.which("sudo") and _succeeds(("sudo", "-n", "-l", target)):
        return ("sudo", "-n", target)

    # A logind session may be allowed to do this unprivileged. --dry-run asks
    # systemd whether it would work and halts nothing.
    if shutil.which("systemctl") and _succeeds(("systemctl", "--dry-run", "poweroff")):
        return ("systemctl", "poweroff")

    return None


def _flush_and_release(robot):
    """Steps 1-3. Blocking, so callers hand it to a thread."""
    robot.drive.stop("shutdown")

    # Ends the active run — the reason a shutdown from the console produces a
    # complete run where flipping the switch produced an interrupted one.
    robot.close("operator shutdown")

    # The step that actually saves the card. Everything above wrote through the
    # page cache; this is what puts it on the device.
    os.sync()


def _spawn_poweroff(command):
    try:
        subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        # Nothing left to tell the console — its socket is already gone. The
        # journal is the only place this can be seen, so it goes in loudly.
        log.error("poweroff command failed after teardown: %s", exc)


def _schedule_poweroff(command):
    """Halt after a beat, so the response is on the wire before the kernel goes.

    A separate function because it is the seam the tests hold: they assert the
    halt was scheduled without ever letting a real one run.
    """
    asyncio.get_running_loop().call_later(POWEROFF_DELAY_S, _spawn_poweroff, command)


@router.post("/api/shutdown")
async def post_shutdown(robot=Depends(get_robot)):
    """Halt the Pi properly. The console's shutdown button is the only caller."""
    command = poweroff_command()
    if command is None:
        # Deliberately before any teardown: the robot is untouched and still
        # driveable, so the operator loses nothing by this failing.
        log.warning("shutdown refused: no permitted poweroff command")
        return JSONResponse(
            {
                "ok": False,
                "error": (
                    "this account cannot power the Pi off. Re-run deploy.sh to "
                    "install the sudoers rule, or halt it over ssh with "
                    "`sudo poweroff`."
                ),
            },
            status_code=503,
        )

    log.info("operator shutdown: %s", " ".join(command))
    await asyncio.to_thread(_flush_and_release, robot)

    # Scheduled rather than awaited, so this response is on the wire before the
    # kernel starts killing processes. A console that saw a dropped connection
    # instead could not tell a clean halt from a crash.
    _schedule_poweroff(command)

    return {
        "ok": True,
        "poweroff_in_s": POWEROFF_DELAY_S,
        "detail": "run closed, buffers flushed to the card, powering off",
    }
