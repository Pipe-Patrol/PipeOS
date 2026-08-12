# Turning the robot into an appliance

Three one-time changes on the Pi. After them, using the robot is: flip the
switch on, join its WiFi, open the page, drive, flip the switch off. No SSH, no
laptop on the right network, no shutdown ritual, no reflashing.

Everything here is optional and reversible. The robot works without any of it —
it just works the way a prototype works.

## 1. The robot hosts its own network

```bash
sudo ~/PipeOS/server/deploy/hotspot.sh enable
sudo reboot
```

The Pi now broadcasts `PipePatrol` and comes back on its own at every boot.
Join it from a laptop or phone and the console is at a fixed address that never
changes:

```
http://192.168.4.1:8000
```

This removes the step that fails most often. There is no network to join, no
DHCP lease to wait for, and no address to go looking for — which is what
`pipepatrol.local` not resolving actually was, every time.

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
sudo ~/PipeOS/server/deploy/readonly-root.sh enable --data-device /dev/sda1
sudo reboot
```

Root now mounts read-only. Writes go to an overlay in RAM and are discarded at
reboot, so there is never a write in flight for a power cut to interrupt. This
is why a GoPro has a power switch and the robot needed a shutdown sequence.

Runs and recordings do not live on the overlay — that is what the USB stick is
for. It is mounted at `/var/lib/pipepatrol`, and the server is pointed at it
through `PIPEPATROL_DATA`. Without a stick the script refuses to proceed rather
than quietly throwing away every recording at reboot; pass `--ephemeral-data`
if losing them is genuinely what you want.

**Deploying needs this off.** A read-only root takes rsync's copy into RAM,
where the deploy appears to succeed and vanishes at the next reboot. `deploy.sh`
checks for this and refuses, but the cycle is:

```bash
sudo ~/PipeOS/server/deploy/readonly-root.sh disable && sudo reboot
# deploy from your laptop
sudo ~/PipeOS/server/deploy/readonly-root.sh enable --data-device /dev/sda1 && sudo reboot
```

Check where things stand at any time with `readonly-root.sh status`.

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
