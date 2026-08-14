# Turning the robot into an appliance

One command, from your laptop:

```bash
./deploy.sh --appliance
```

After it, using the robot is: flip the switch on, join its WiFi, drive, flip
the switch off. No SSH, no laptop on the right network, no shutdown ritual, no
reflashing. Fit a USB stick first — that is where recordings go — and see §2
for why.

It is safe to run twice, and every part of it is reversible. The robot works
without any of it; it just works the way a prototype works.

The rest of this page is what that command does, and how to undo each piece.

## 1. The robot hosts its own network

```bash
sudo ~/PipeOS/server/deploy/hotspot.sh enable
```

The Pi now broadcasts `PipePatrol` and comes back on its own at every boot.
Join it from a laptop or phone and **the console opens by itself**. If it does
not, it is at a fixed address that never changes:

```
http://192.168.4.1
```

This removes the step that fails most often. There is no network to join, no
DHCP lease to wait for, and no address to go looking for — which is what
`pipepatrol.local` not resolving actually was, every time.

### Why it opens by itself

Two things, both installed by `hotspot.sh enable`. Every name on the robot's
network resolves to the robot, and the console answers on port 80 as well as
8000 — `portal-redirect.sh`, run at boot by `pipepatrol-portal.service`, which
is a kernel rule rather than the server running as root to bind port 80.

So when a phone or laptop joins and makes its usual "am I online?" check, that
request reaches the console. The OS concludes it is behind a captive portal and
pops it open. Which is the behaviour we wanted, arrived at from the other
direction.

The cost is that the client will report *no internet* while joined. It has none
— see below — so this mostly makes an existing fact visible. `hotspot.sh enable
--no-portal` sets the network up without it and leaves the console on `:8000`.

The Pi's one radio cannot host a network and be a client on another at the same
time, so while this is on the robot has no internet. That is fine for driving.
For `apt install`, plug in Ethernet or run `hotspot.sh disable`.

Deploying still works — join the robot's network and deploy over it:

```bash
./deploy.sh pipepatrol@192.168.4.1
```

## 2. Pulling the plug stops corrupting the card

```bash
lsblk                                      # find the USB stick, e.g. sda1
sudo mkfs.ext4 -L pipepatrol /dev/sda1     # ERASES it
sudo ~/PipeOS/server/deploy/readonly-root.sh enable --auto-data-device
```

`--auto-data-device` finds the stick itself. It only ever considers removable
drives, so it cannot pick the SD card the system is running from, and it
refuses rather than guessing when there is more than one candidate.

Root now mounts read-only. Writes go to an overlay in RAM and are discarded at
reboot, so there is never a write in flight for a power cut to interrupt. This
is why a GoPro has a power switch and the robot needed a shutdown sequence.

Runs and recordings do not live on the overlay — that is what the USB stick is
for. It is mounted at `/var/lib/pipepatrol`, and the server is pointed at it
through `PIPEPATROL_DATA`. Without a stick the script refuses to proceed rather
than quietly throwing away every recording at reboot; pass `--ephemeral-data`
if losing them is genuinely what you want.

**Deploying still takes one command.** A read-only root cannot be rsynced to —
the copy lands in RAM, the deploy appears to succeed, and it vanishes at the
next reboot. `deploy.sh` handles that itself: it unlocks, reboots, copies,
relocks and reboots back, so the robot is an appliance again at the end of it.
Expect about two extra minutes.

```bash
./deploy.sh                  # unlocks and relocks around the copy
./deploy.sh --stay-unlocked  # leave it writable, for a run of quick iterations
```

After `--stay-unlocked` the robot needs a proper shutdown again until the next
plain `./deploy.sh` puts the lock back. Check where things stand at any time
with `readonly-root.sh status`, or lock it by hand with `readonly-root.sh
relock`.

## 3. Hardware that was not ready at boot comes back on its own

Already done, in the code — nothing to run.

The server can start before the kernel has finished bringing up the GPIO chip.
Claiming a pin then fails, and it used to fail permanently: the motors and the
LED ring stayed dead for the life of the process. Redeploying appeared to fix
them because redeploying restarts the service.

Now the drivetrain and the LED ring retry every 5 seconds until the pins are
theirs, the same way the IMU already recovered from I2C errors. The console
shows the reason while a subsystem is down instead of leaving it to the journal.

Motors that recover come up **stopped**, never at whatever was last commanded —
otherwise a robot that had been sitting dead under a held key would lurch the
moment the GPIO arrived.

The service itself also restarts on any exit, not just a crash, and systemd's
start-limit is off, so a burst of early failures can no longer wedge it into a
permanent dead state.

## Is it actually an appliance?

Unplug it mid-run. Plug it back in. Touch nothing else. If the console is live
again in under a minute and no card needed reflashing, it is.

The stricter version of the test, and the one worth actually running: hand the
robot and a laptop to someone who has never seen either, and say nothing. If
they get to a moving robot without asking you a question, it is done.
