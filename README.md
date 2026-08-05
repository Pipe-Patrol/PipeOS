# PipeOS

![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![Raspberry Pi](https://img.shields.io/badge/Raspberry_Pi-A22846?style=flat-square&logo=raspberrypi&logoColor=white)

### **UMD Cyber-Physical Systems Engineering, Jumpstart Summer Program 2026**

The OS (operator console and control server) for the PipePatrol pipe inspection
robot by team PipePatrol.

### Features

- **Live video** — low-latency MJPEG feed from the robot's camera.
- **Real-time telemetry** — orientation, motion, temperature, humidity.
- **Defect detection** — on-board ML flags cracks, roots, and other defects.
- **Map and flags** — robot path on a map with auto RTH and defect flagging.
- **Runs & reports** — snapshots, defect logs, and video recorded to the Pi.
- **Driving** — keyboard or gamepad.

## 1. Get the code

```bash
gh repo clone Pipe-Patrol/PipeOS
cd PipeOS
```

## 2. Install it on the robot

Builds the console and sets everything up on the Pi over ssh.

```bash
./deploy.sh pipepatrol@pipepatrol.local
```

Name not resolving? Use the Pi's IP instead:

```bash
./deploy.sh pipepatrol@10.83.0.112
```

Run this once to set the Pi up, and again whenever the code changes. It needs
ssh access to the Pi and the Pi's apt packages — see
[docs/HARDWARE.md](docs/HARDWARE.md).

### Coming back from a fresh SD card

`deploy.sh` installs the Python packages but not the apt ones, so a newly
flashed Pi comes up with the server running and every device reported absent.
Run these **on the Pi** once, before deploying:

```bash
sudo apt update
sudo apt install -y python3-opencv python3-picamera2 python3-gpiozero \
                    python3-lgpio i2c-tools

# I2C for the IMU. `do_i2c 0` enables it — 0 is on, which reads backwards.
# The baudrate is the BNO085 clock-stretching workaround; setting it now saves
# a second reboot when the IMU turns out to need it, which it will.
sudo raspi-config nonint do_i2c 0
grep -q i2c_arm_baudrate /boot/firmware/config.txt || \
  echo "dtparam=i2c_arm_baudrate=50000" | sudo tee -a /boot/firmware/config.txt

sudo reboot
```

`python3-opencv` is the one that is easy to miss. It drives **USB cameras and
the optical-flow odometry**, and without it a working USB camera still reports
`no camera` — the CSI backend correctly declines a USB device, and the USB
backend has nothing to open it with. It pulls in ~500 MB of dependencies, so it
looks optional and is not.

Then deploy from your computer and confirm every device came up:

```bash
./deploy.sh pipepatrol@pipepatrol.local
ssh pipepatrol@pipepatrol.local 'journalctl -u pipepatrol -b | grep "robot up"'
```

That line names every subsystem, and is the fastest way to see what is missing:

```
robot up: motors=True imu=absent camera=True leds=True flow=True climate=False
```

`climate=False` is normal unless the DHT is fitted. Anything else `False` or
`absent` means that device did not come up — grep the log for its name to get
the reason.

## 3. Drive the robot

Open this on any device on the same network — laptop, phone, iPad:

```
http://pipepatrol.local:8000
```

Confirm the robot, press **Continue**, and you are in.

---


### Get new changes onto the robot

```bash
cd ~/PipeOS
git pull
./deploy.sh pipepatrol@pipepatrol.local
```

### Work on the console (on your computer, no Pi needed)

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

### Tests

```bash
cd server && .venv/bin/python -m pytest    # safety, watchdog, odometry, camera
cd web && npm run check                    # typecheck, lint, unit tests
```

Run them before you power the motors.

### Troubleshooting

```bash
ping pipepatrol.local                                               # is the Pi on the network?
ssh pipepatrol@pipepatrol.local                                     # can you reach the Pi at all?
./deploy.sh pipepatrol@10.83.0.112                                  # name won't resolve? deploy by IP
ssh pipepatrol@pipepatrol.local hostname -I                         # what is the Pi's IP right now?
ssh pipepatrol@pipepatrol.local 'systemctl status pipepatrol'       # is the server running?
ssh pipepatrol@pipepatrol.local 'sudo systemctl restart pipepatrol' # bounce the server
ssh pipepatrol@pipepatrol.local 'journalctl -u pipepatrol -f'       # watch the logs live
```
```bash
ssh pipepatrol@pipepatrol.local 'journalctl -u pipepatrol -b | grep -i camera'
curl -s http://pipepatrol.local:8000/api/telemetry | python3 -m json.tool | grep -A8 '"camera"'
```

#### `camera=False`

```bash
rpicam-hello --list-cameras     # empty is normal for a USB camera
ls -l /dev/video*               # a USB camera should be here
sudo apt install -y python3-opencv && sudo systemctl restart pipepatrol
```

A USB camera needs `python3-opencv`, not `picamera2`. `No cameras available!`
from `rpicam-hello` is expected and harmless with a USB camera — libcamera only
speaks for the CSI bus.

#### `imu=absent`

**On a freshly flashed card this is I²C being switched off, every time.** The
sensor is fine; the bus does not exist yet. Fix and reboot:

```bash
sudo raspi-config nonint do_i2c 0    # 0 means on, which reads backwards
sudo reboot
```

If it is not that, the BNO085 sits at I²C address `0x4A`. Ask the bus first,
because that separates wiring from software:

```bash
i2cdetect -y 1                  # expect 4a
ssh pipepatrol@pipepatrol.local 'journalctl -u pipepatrol -b | grep -i imu'
```

- **`Could not open file /dev/i2c-1`** — I²C is off; the device node does not
  exist yet. This is the normal state after a fresh flash. Enable it and
  reboot: `sudo raspi-config nonint do_i2c 0` (0 means on), or `raspi-config` →
  Interface Options → I2C → Yes.
- **`4a` present but the log still says absent** — the Python side. The driver
  is pip-installed by `deploy.sh`, so check it imports:
  `~/PipeOS/server/.venv/bin/python -c "import board; print('ok')"`. If that
  fails, the venv lost `--system-site-packages`; `rm -rf ~/PipeOS/server/.venv`
  and deploy again.
- **`4a` present and intermittent `OSError` in the log** — clock stretching.
  This chip needs a slower bus than the Pi's default. Add to
  `/boot/firmware/config.txt` and reboot:

  ```
  dtparam=i2c_arm=on
  dtparam=i2c_arm_baudrate=50000
  ```

- **Still nothing** — it is the Qwiic cable on physical pins 1, 3, 5, 9.

The robot drives fine without the IMU, and **distance is unaffected** — that
comes from duty and optical flow, and IMU acceleration is deliberately not
integrated for it (the error grows with the square of time). What you lose is
the pitch/yaw readout on the video, the tilt reading in the report, and the
odometry's independent check on whether the robot is actually still. See
[docs/HARDWARE.md](docs/HARDWARE.md).

### Project structure

```
PipeOS/
├── server/                  FastAPI control server (runs on the Pi)
│   ├── pipepatrol/
│   │   ├── api/             REST + WebSocket endpoints
│   │   ├── estimation/      odometry, optical flow, obstacle estimates
│   │   ├── hardware/        drive, camera, IMU, lights, host stats
│   │   ├── perception/      defect detector
│   │   ├── runs/            run storage, recording, export
│   │   ├── app.py           app wiring + CORS
│   │   ├── config.py        every environment knob
│   │   ├── robot.py         owns all subsystems + the control loops
│   │   └── telemetry.py     the telemetry envelope
│   ├── tests/               safety, odometry, hazards, runs, api, camera
│   └── deploy/              systemd unit
├── web/                     React + TypeScript operator console
│   └── src/
│       ├── components/      live overlay, map, panels, shell, primitives
│       ├── constants/       defect types, run-state presentation
│       ├── input/           keyboard + gamepad driving
│       ├── lib/             formatting, local save, small hooks
│       ├── robot/           client, discovery, provider, types
│       ├── routes/          connect, live, runs, settings
│       └── App.tsx
├── docs/                    HARDWARE.md, DECISIONS.md
├── deploy.sh                one-command Pi deploy
└── README.md
```

### Safety Disclaimer

Use this code at your own risk. There are built-in safety features, but assume
all of them can fail. Please supervise every run. Further information and details
can be found in [docs/DECISIONS.md](docs/DECISIONS.md).

### Team

Andrew Zhao · Newton Yang · Arav Assija · Leah Wang

### License

[MIT](LICENSE) © 2026 Andrew Zhao, Newton Yang, Arav Assija, Leah Wang.

PipeOS's own code is MIT-licensed. Sewer-ML and any third-party datasets or
model weights remain under their respective licenses.

### Acknowledgments

Built for the **University of Maryland** Cyber-Physical Systems Engineering
2026 Jumpstart Summer Program. Thanks to UMD for the program, the mentorship,
and the lab.

Defect detection draws on **Sewer-ML**, the multi-label sewer defect
classification dataset and benchmark by Joakim Bruslund Haurum and Thomas B.
Moeslund of the Visual Analysis and Perception (VAP) Laboratory at Aalborg
University (CVPR 2021). Credit and thanks to the Sewer-ML team.

- Project page: <https://vap.aau.dk/sewer-ml/>
- Paper: <https://arxiv.org/abs/2103.10895>
