# Hardware

The full pin reference, including where each number is defined and what happens
when one is wrong, is in [PINMAP.md](PINMAP.md). The summary below is wiring
context.

## Pin map

**Drive** — Cytron MDD10A, sign-magnitude mode

| Signal | BCM | Physical | Side |
|---|---|---|---|
| PWM1 | GPIO12 | 32 | LEFT |
| DIR1 | GPIO5 | 29 | LEFT |
| PWM2 | GPIO13 | 33 | RIGHT |
| DIR2 | GPIO6 | 31 | RIGHT |
| GND | — | 6 | — |

2× ServoCity 43 RPM Econ Gear Motor, 12 V, 226:1 spur. 90 mm wheels → ~20 cm/s
top speed. **Stall current 3.85 A each** — see the safety note in the README.

**LED ring** — MOSFET gate on GPIO18 (pin 12), module GND on pin 14. Capped at
50 % duty in `hardware/lights.py`.

**IMU** — BNO085 over I²C at `0x4A`, Qwiic on pins 1/3/5/9.

**Air temperature / humidity** — DFRobot Gravity DHT22 (AM2302), one wire.

As fitted:

| Signal | BCM | Physical |
|---|---|---|
| VCC (red) | — | 4 (**5V**) |
| GND (black) | — | 6 |
| DATA (green) | GPIO14 | 8 |

Pins 4, 6, 8 are three in a row, so a 3-way female housing plugs straight on
without splitting it. GPIO14 is UART TX, so the serial console has to be off
(`sudo raspi-config nonint do_serial_hw 1`) or it fights the driver.

The module has its own pull-up, so no resistor is needed on the Pi side. That
pull-up goes to whatever VCC is fed, so on 5 V the data line idles at 5 V into
the data pin, which is not 5 V tolerant. 3V3 (pin 1 or 17) is also in spec for this
module and avoids that.

**Camera** — CSI ribbon via `picamera2`, or any USB camera via V4L2. CSI is tried
first: a ribbon camera also appears as `/dev/video*` but delivers raw Bayer
there, so letting OpenCV grab it produces garbage.

**Power** — 3S LiPo → kill switch → buck converter. **No voltage sensor is
wired**, so there is no battery telemetry. See below.

## Setup

```bash
sudo apt update
sudo apt install -y python3-picamera2 python3-gpiozero python3-lgpio \
                    python3-opencv python3-venv i2c-tools git
sudo raspi-config nonint do_i2c 0   # I2C on, for the IMU. 0 means on.
sudo reboot
```

`python3-opencv` is needed for USB cameras *and* for the optical-flow odometry.
Without it the server still runs; distance falls back to duty integration alone
and says so.

### The I²C baudrate change you will probably need

The BNO085 uses clock stretching and the Pi's hardware I²C has a known bug with
it. Intermittent `OSError` during reads is normal. Add to
`/boot/firmware/config.txt` and reboot:

```
dtparam=i2c_arm=on
dtparam=i2c_arm_baudrate=50000
```

Confirm with `i2cdetect -y 1` — expect `4a`.

### The overlay the DHT22 needs

The DHT is read by the kernel's `dht11` IIO driver, not from Python — the
protocol's pulses are 26–70 µs apart and no userspace library times that
reliably on a Pi 5 (the reasoning, and what was tried, is at the top of
`hardware/climate.py`). That driver is loaded by a device tree overlay, and an
overlay is only applied at boot:

`deploy.sh` does this for you — the script lives on the Pi only once a deploy has
put it there, so it cannot be a prerequisite step. To do it by hand, on the Pi
and after at least one deploy:

```bash
sudo bash ~/PipeOS/server/deploy/enable-dht.sh 14   # adds dtoverlay=dht11,gpiopin=14
sudo reboot
```

The overlay is named for the DHT11 but decodes the DHT22/AM2302 frame too —
there is no separate `dht22` overlay to look for. After the reboot:

```bash
cd ~/PipeOS/server && .venv/bin/python -m pipepatrol.hardware.climate
```

That prints a live reading every few seconds, or says which of the overlay, the
power and the wire is the problem. Failed reads are normal — a healthy DHT
times out regularly, and the console only blanks after 30 s of silence.

## The two sensors that are not fitted

Both are load-bearing for features the console currently marks estimated or
unavailable.

### Voltage and current — Adafruit INA260 (~$15)

Integrated 2 mΩ shunt rated ±15 A, so the ~8 A worst-case stall of both motors
fits without sizing a shunt. 36 V bus limit, default address `0x40` (no conflict
with the IMU at `0x4A`), and a STEMMA QT connector that chains onto the existing
Qwiic run.

Fit it **in the pack's positive lead, downstream of the kill switch**, feeding
both the MDD10A and the buck converter.

Two notes for whoever wires it:

- Sample pack voltage for the percentage **only while the motors are stopped**.
  A 3S pack sags more than a volt under drive current, so a fuel gauge read
  under load reads low and jumps back up when you release the throttle.
- The current channel is the more valuable half. Idle draw is ~1 A; a jammed
  motor pins near 3.85 A with the wheel stationary. That measurement would
  replace the flow-based stall heuristic in `estimation/obstacle.py` and would
  make `MAX_CONTINUOUS_RUN_S` genuinely protective.

The INA219 named in the old `TODO` also works but ships with a 0.1 Ω shunt good
for only ±3.2 A — at 8 A it drops 0.8 V and burns ~6 W, so it needs the shunt
replaced and the current LSB recomputed.

### Distance — 2× AS5600 + a TCA9548A mux (~$17)

12-bit absolute magnetic encoders on the wheel axles, polled over I²C rather
than counted on interrupts. At 43 RPM output the sample rate is trivial, so
Python keeps up comfortably. The mux is required: the AS5600's address (`0x36`)
is fixed, so two of them cannot share a bus.

Each needs a diametrically-magnetised magnet on the axle end, 1–3 mm from the
board, coaxial.

Motor-shaft encoders were considered and rejected: at 226:1 they produce roughly
15,000 edges per second across both motors, well past what Python GPIO callbacks
count reliably. Dropped counts read as under-travel, silently.

**Wheels slip in wet pipe.** Encoders make distance *possible*, not *accurate*.
If the robot is ever tethered, count the cable at the reel instead — that is how
commercial crawlers measure chainage, and it is what a defensible report wants.
