# Hardware

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
